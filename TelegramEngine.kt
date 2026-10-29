package com.kiragaming.kiraautopost.engine

import com.kiragaming.kiraautopost.model.ChatGroup
import com.kiragaming.kiraautopost.model.TelegramAccount
import java.io.File

sealed class EngineResult<out T> {
    data class Success<out T>(val data: T) : EngineResult<T>()
    data class Error(
        val code: String,
        val messageKhmer: String,
        val rawMessage: String = ""
    ) : EngineResult<Nothing>()
}

data class SendCodeResponse(
    val phoneCodeHash: String,
    val deliveryType: String,
    val timeout: Int
)

data class AuthResponse(
    val success: Boolean,
    val userId: Long,
    val firstName: String,
    val username: String,
    val sessionString: String
)

interface TelegramEngine {
    suspend fun sendLoginCode(account: TelegramAccount): EngineResult<SendCodeResponse>
    suspend fun verifyCode(account: TelegramAccount, phoneCodeHash: String, code: String): EngineResult<AuthResponse>
    suspend fun verify2FA(account: TelegramAccount, password: String): EngineResult<AuthResponse>
    suspend fun loadChats(account: TelegramAccount): EngineResult<List<ChatGroup>>
    suspend fun sendMessage(
        account: TelegramAccount,
        chatId: Long,
        text: String,
        mediaFiles: List<File> = emptyList()
    ): EngineResult<List<Long>>
    suspend fun forwardMessages(
        account: TelegramAccount,
        toChatId: Long,
        messageIds: List<Long>
    ): EngineResult<Boolean>
    suspend fun checkServerHealth(): Boolean
}
