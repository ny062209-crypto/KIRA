package com.kiragaming.kiraautopost.engine

import android.content.Context
import android.util.Log
import com.kiragaming.kiraautopost.data.PreferencesManager
import com.kiragaming.kiraautopost.data.ReportStore
import com.kiragaming.kiraautopost.model.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import kotlin.random.Random

class PostingManager(
    private val context: Context,
    private val telegramEngine: TelegramEngine,
    private val reportStore: ReportStore,
    private val prefs: PreferencesManager
) {
    private val _progress = MutableStateFlow(CampaignProgress())
    val progress: StateFlow<CampaignProgress> = _progress.asStateFlow()

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var campaignJob: Job? = null
    private var isPaused = false

    fun startCampaign(
        account: TelegramAccount,
        groups: List<ChatGroup>,
        messageText: String,
        mediaFiles: List<File>,
        delaySeconds: Int,
        enableRandom: Boolean,
        isTestMode: Boolean,
        coroutineScope: CoroutineScope
    ) {
        if (_progress.value.isRunning) return

        campaignJob?.cancel()
        isPaused = false

        campaignJob = appScope.launch(Dispatchers.IO) {
            val validGroups = if (isTestMode) {
                // Test mode: Send to Saved Messages only (chatId 0 or user's self)
                listOf(ChatGroup(id = 0L, title = "Saved Messages (Test Mode)", canPost = true, isSelected = true))
            } else {
                groups.filter { it.isSelected }
            }

            if (validGroups.isEmpty()) return@launch

            val effectiveBaseDelay = if (delaySeconds < 10) 10 else delaySeconds

            _progress.value = CampaignProgress(
                total = validGroups.size,
                current = 0,
                success = 0,
                failed = 0,
                skipped = 0,
                isRunning = true,
                isPaused = false,
                currentChatTitle = "",
                countdownSeconds = 0,
                activeAccountPhone = account.phone,
                startTime = System.currentTimeMillis()
            )

            // ===== ជំហានទី 1: ផុសចូល Saved Messages (កន្លែងសេវ) ជាមុន =====
            _progress.value = _progress.value.copy(
                currentChatTitle = "ជំហាន 1: ផុសចូល Saved Messages"
            )
            val savedResult = telegramEngine.sendMessage(
                account = account,
                chatId = 0L,
                text = messageText,
                mediaFiles = mediaFiles
            )

            val savedIds: List<Long> = when (savedResult) {
                is EngineResult.Success -> savedResult.data
                is EngineResult.Error -> {
                    reportStore.addLog(
                        SendLogItem(
                            chatTitle = "Saved Messages",
                            chatId = 0L,
                            accountPhone = account.phone,
                            status = SendStatus.FAILED,
                            reason = "ជំហាន 1 បរាជ័យ (ផុសចូល Saved Messages): ${savedResult.messageKhmer}"
                        )
                    )
                    _progress.value = _progress.value.copy(
                        failed = validGroups.size,
                        current = validGroups.size,
                        isRunning = false,
                        isPaused = false,
                        countdownSeconds = 0
                    )
                    return@launch
                }
            }

            if (isTestMode) {
                reportStore.addLog(
                    SendLogItem(
                        chatTitle = "Saved Messages (Test Mode)",
                        chatId = 0L,
                        accountPhone = account.phone,
                        status = SendStatus.SUCCESS,
                        reason = "ជោគជ័យ (Sent to Saved Messages)"
                    )
                )
                _progress.value = _progress.value.copy(
                    current = 1,
                    success = 1,
                    isRunning = false,
                    isPaused = false,
                    countdownSeconds = 0
                )
                return@launch
            }

            // ===== ជំហានទី 2: Forward ពី Saved Messages ទៅគ្រុបដែលបានជ្រើសរើស =====
            for ((index, group) in validGroups.withIndex()) {
                if (!isActive) break

                // Check paused state
                while (isPaused && isActive) {
                    delay(500)
                }

                // Check permissions to post
                if (!group.canPost && !isTestMode) {
                    val log = SendLogItem(
                        chatTitle = group.title,
                        chatId = group.id,
                        accountPhone = account.phone,
                        status = SendStatus.SKIPPED,
                        reason = "រំលង: គ្មានសិទ្ធិផុសក្នុងក្រុមនេះ (Admin-Only/Muted)"
                    )
                    reportStore.addLog(log)
                    _progress.value = _progress.value.copy(
                        current = index + 1,
                        skipped = _progress.value.skipped + 1,
                        currentChatTitle = group.title
                    )
                    continue
                }

                _progress.value = _progress.value.copy(
                    current = index + 1,
                    currentChatTitle = group.title
                )

                // Perform Forward (from Saved Messages)
                val result = telegramEngine.forwardMessages(
                    account = account,
                    toChatId = group.id,
                    messageIds = savedIds
                )

                when (result) {
                    is EngineResult.Success -> {
                        val log = SendLogItem(
                            chatTitle = group.title,
                            chatId = group.id,
                            accountPhone = account.phone,
                            status = SendStatus.SUCCESS,
                            reason = "ជោគជ័យ (Forwarded successfully)"
                        )
                        reportStore.addLog(log)
                        _progress.value = _progress.value.copy(
                            success = _progress.value.success + 1
                        )
                    }
                    is EngineResult.Error -> {
                        val isFloodWait = result.code.contains("FLOOD_WAIT", ignoreCase = true)
                        val log = SendLogItem(
                            chatTitle = group.title,
                            chatId = group.id,
                            accountPhone = account.phone,
                            status = SendStatus.FAILED,
                            reason = result.messageKhmer
                        )
                        reportStore.addLog(log)
                        _progress.value = _progress.value.copy(
                            failed = _progress.value.failed + 1
                        )

                        // If FLOOD_WAIT, extract seconds and pause countdown
                        if (isFloodWait) {
                            val waitSec = extractFloodWaitSeconds(result.rawMessage)
                            Log.w("PostingManager", "FLOOD_WAIT detected: waiting $waitSec seconds")
                            countdownWait(waitSec, "រង់ចាំ Telegram FLOOD_WAIT")
                        }
                    }
                }

                // Delay before next group (if not last item)
                if (index < validGroups.size - 1 && isActive) {
                    var waitSec = effectiveBaseDelay
                    if (enableRandom) {
                        val variance = Random.nextInt(-5, 6)
                        waitSec = (waitSec + variance).coerceAtLeast(10)
                    }
                    countdownWait(waitSec, "ផុសក្រុមបន្ទាប់ក្នុង")
                }
            }

            _progress.value = _progress.value.copy(
                isRunning = false,
                isPaused = false,
                countdownSeconds = 0
            )
        }
    }

    private suspend fun countdownWait(seconds: Int, label: String) {
        var remaining = seconds
        while (remaining > 0) {
            _progress.value = _progress.value.copy(countdownSeconds = remaining)
            delay(1000)
            while (isPaused) {
                delay(500)
            }
            remaining--
        }
        _progress.value = _progress.value.copy(countdownSeconds = 0)
    }

    private fun extractFloodWaitSeconds(msg: String): Int {
        val regex = Regex("""\d+""")
        val match = regex.find(msg)
        return match?.value?.toIntOrNull() ?: 60
    }

    fun pause() {
        isPaused = true
        _progress.value = _progress.value.copy(isPaused = true)
    }

    fun resume() {
        isPaused = false
        _progress.value = _progress.value.copy(isPaused = false)
    }

    fun stop() {
        campaignJob?.cancel()
        isPaused = false
        _progress.value = _progress.value.copy(
            isRunning = false,
            isPaused = false,
            countdownSeconds = 0
        )
    }
}
