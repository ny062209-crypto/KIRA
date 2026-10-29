package com.kiragaming.kiraautopost.engine.remote

import android.content.Context
import com.kiragaming.kiraautopost.engine.*
import com.kiragaming.kiraautopost.model.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.File
import java.util.concurrent.TimeUnit

class TelethonEngine(
    private val context: Context,
    private val serverUrlProvider: () -> String,
    private val serverTokenProvider: () -> String
) : TelegramEngine {

    private fun getRetrofit(): Retrofit {
        var base = serverUrlProvider().trim()
        if (!base.endsWith("/")) {
            base = "$base/"
        }
        val client = OkHttpClient.Builder()
            .connectTimeout(90, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.NONE
            })
            .build()

        return Retrofit.Builder()
            .baseUrl(base)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    private fun getService(): TelegramApiService {
        return getRetrofit().create(TelegramApiService::class.java)
    }

    override suspend fun sendLoginCode(account: TelegramAccount): EngineResult<SendCodeResponse> {
        return try {
            val apiIdInt = account.apiId.trim().toIntOrNull()
                ?: return EngineResult.Error("API_ID_INVALID", "API ID ត្រូវតែជាលេខ (ឧ. 1234567)")

            val resp = getService().sendCode(
                token = serverTokenProvider(),
                request = SendCodeRequest(
                    api_id = apiIdInt,
                    api_hash = account.apiHash.trim(),
                    phone = account.phone.trim()
                )
            )

            if (resp.isSuccessful) {
                val body = resp.body()
                if (body != null && body.status == "ok" && body.phone_code_hash != null) {
                    EngineResult.Success(
                        SendCodeResponse(
                            phoneCodeHash = body.phone_code_hash,
                            deliveryType = body.delivery_type ?: "Telegram App",
                            timeout = body.timeout ?: 60
                        )
                    )
                } else {
                    mapError(body?.error_code ?: "UNKNOWN", body?.error ?: "Unknown error")
                }
            } else {
                mapHttpError(resp.code())
            }
        } catch (e: Exception) {
            EngineResult.Error(
                code = "CONNECT_ERROR",
                messageKhmer = "មិនអាចភ្ជាប់ទៅកាន់ Telegram Server បានទេ សូមពិនិត្យមើល URL របស់ Server ក្នុងការកំណត់ (${e.localizedMessage ?: "No connection"})",
                rawMessage = e.message ?: ""
            )
        }
    }

    override suspend fun verifyCode(
        account: TelegramAccount,
        phoneCodeHash: String,
        code: String
    ): EngineResult<AuthResponse> {
        return try {
            val resp = getService().verifyCode(
                token = serverTokenProvider(),
                request = VerifyCodeRequest(
                    phone = account.phone.trim(),
                    phone_code_hash = phoneCodeHash,
                    code = code.trim()
                )
            )

            if (resp.isSuccessful) {
                val body = resp.body()
                if (body != null && body.status == "ok") {
                    EngineResult.Success(
                        AuthResponse(
                            success = true,
                            userId = body.user_id ?: 0L,
                            firstName = body.first_name ?: "",
                            username = body.username ?: "",
                            sessionString = body.session_string ?: ""
                        )
                    )
                } else if (body != null && body.status == "2fa_required") {
                    EngineResult.Error("2FA_REQUIRED", "គណនីនេះមានបើក 2FA សូមបញ្ចូលពាក្យសម្ងាត់ 2FA")
                } else {
                    mapError(body?.error_code ?: "UNKNOWN", body?.error ?: "Verification failed")
                }
            } else {
                mapHttpError(resp.code())
            }
        } catch (e: Exception) {
            EngineResult.Error("CONNECT_ERROR", "កំហុសក្នុងការតភ្ជាប់: ${e.localizedMessage}")
        }
    }

    override suspend fun verify2FA(
        account: TelegramAccount,
        password: String
    ): EngineResult<AuthResponse> {
        return try {
            val resp = getService().verify2FA(
                token = serverTokenProvider(),
                request = Verify2FaRequest(
                    phone = account.phone.trim(),
                    password = password
                )
            )

            if (resp.isSuccessful) {
                val body = resp.body()
                if (body != null && body.status == "ok") {
                    EngineResult.Success(
                        AuthResponse(
                            success = true,
                            userId = body.user_id ?: 0L,
                            firstName = body.first_name ?: "",
                            username = body.username ?: "",
                            sessionString = body.session_string ?: ""
                        )
                    )
                } else {
                    mapError(body?.error_code ?: "PASSWORD_HASH_INVALID", body?.error ?: "Invalid 2FA password")
                }
            } else {
                mapHttpError(resp.code())
            }
        } catch (e: Exception) {
            EngineResult.Error("CONNECT_ERROR", "កំហុសក្នុងការតភ្ជាប់: ${e.localizedMessage}")
        }
    }

    override suspend fun loadChats(account: TelegramAccount): EngineResult<List<ChatGroup>> {
        return try {
            val resp = getService().loadChats(
                token = serverTokenProvider(),
                request = LoadChatsRequest(session_string = account.sessionString)
            )

            if (resp.isSuccessful) {
                val body = resp.body()
                if (body != null && body.status == "ok" && body.chats != null) {
                    val groups = body.chats.map { dto ->
                        ChatGroup(
                            id = dto.id,
                            title = dto.title,
                            username = dto.username ?: "",
                            type = when (dto.type.lowercase()) {
                                "channel" -> ChatType.CHANNEL
                                "supergroup" -> ChatType.SUPERGROUP
                                else -> ChatType.GROUP
                            },
                            canPost = dto.can_post,
                            memberCount = dto.member_count,
                            isSelected = false,
                            avatarPath = saveAvatar(account.phone, dto.id, dto.photo)
                        )
                    }
                    EngineResult.Success(groups)
                } else {
                    mapError(body?.error_code ?: "UNKNOWN", body?.error ?: "Failed to load chats")
                }
            } else {
                mapHttpError(resp.code())
            }
        } catch (e: Exception) {
            EngineResult.Error("CONNECT_ERROR", "មិនអាចទាញយកក្រុមបានទេ: ${e.localizedMessage}")
        }
    }

    private fun saveAvatar(phone: String, chatId: Long, photoB64: String?): String {
        if (photoB64.isNullOrBlank()) return ""
        return try {
            val dir = File(context.filesDir, "avatars/" + phone.filter { it.isLetterOrDigit() })
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, "${chatId}.jpg")
            file.writeBytes(android.util.Base64.decode(photoB64, android.util.Base64.DEFAULT))
            file.absolutePath
        } catch (e: Exception) {
            ""
        }
    }

    override suspend fun sendMessage(
        account: TelegramAccount,
        chatId: Long,
        text: String,
        mediaFiles: List<File>
    ): EngineResult<List<Long>> {
        return try {
            val sessionPart = account.sessionString.toRequestBody("text/plain".toMediaTypeOrNull())
            val chatPart = chatId.toString().toRequestBody("text/plain".toMediaTypeOrNull())
            val textPart = text.toRequestBody("text/plain".toMediaTypeOrNull())

            val fileParts = mediaFiles.map { file ->
                val requestFile = file.asRequestBody("application/octet-stream".toMediaTypeOrNull())
                MultipartBody.Part.createFormData("media", file.name, requestFile)
            }

            val resp = getService().sendMessage(
                token = serverTokenProvider(),
                sessionString = sessionPart,
                chatId = chatPart,
                text = textPart,
                media = fileParts
            )

            val body = resp.body()
            if (resp.isSuccessful && body?.status == "ok") {
                val ids = body.message_ids?.takeIf { it.isNotEmpty() }
                    ?: listOfNotNull(body.message_id)
                EngineResult.Success(ids)
            } else if (!resp.isSuccessful && body == null) {
                mapHttpError(resp.code())
            } else {
                mapError(body?.error_code ?: "SEND_FAILED", body?.error ?: "Could not deliver message")
            }
        } catch (e: Exception) {
            EngineResult.Error("CONNECT_ERROR", "កំហុសពេលផ្ញើសារ: ${e.localizedMessage}", e.message ?: "")
        }
    }

    override suspend fun forwardMessages(
        account: TelegramAccount,
        toChatId: Long,
        messageIds: List<Long>
    ): EngineResult<Boolean> {
        return try {
            val resp = getService().forwardMessages(
                token = serverTokenProvider(),
                request = ForwardRequest(
                    session_string = account.sessionString,
                    to_chat_id = toChatId,
                    message_ids = messageIds
                )
            )
            val body = resp.body()
            if (resp.isSuccessful && body?.status == "ok") {
                EngineResult.Success(true)
            } else if (!resp.isSuccessful && body == null) {
                mapHttpError(resp.code())
            } else {
                mapError(body?.error_code ?: "FORWARD_FAILED", body?.error ?: "Could not forward message")
            }
        } catch (e: Exception) {
            EngineResult.Error("CONNECT_ERROR", "កំហុសពេល Forward: ${e.localizedMessage}", e.message ?: "")
        }
    }

    override suspend fun checkServerHealth(): Boolean {
        return try {
            val resp = getService().healthCheck()
            resp.isSuccessful && resp.body()?.status == "ok"
        } catch (e: Exception) {
            false
        }
    }

    private fun <T> mapHttpError(code: Int): EngineResult<T> {
        val msg = when (code) {
            401 -> "លេខកូដសម្ងាត់ Token របស់ Server មិនត្រឹមត្រូវទេ"
            404 -> "រកមិនឃើញ Endpoint លើ Server ទេ"
            500 -> "Server Telegram Engine ជួបបញ្ហាខាងក្នុង (Internal Server Error)"
            else -> "កំហុសពី Server HTTP $code"
        }
        return EngineResult.Error("HTTP_$code", msg)
    }

    private fun <T> mapError(code: String, raw: String): EngineResult<T> {
        val khmerMsg = when {
            code.contains("PHONE_NUMBER_INVALID", ignoreCase = true) ->
                "លេខទូរស័ព្ទមិនត្រឹមត្រូវទេ សូមបញ្ចូលលេខកូដប្រទេស (+855...)"
            code.contains("PHONE_CODE_INVALID", ignoreCase = true) ->
                "លេខកូដបញ្ជាក់ Telegram មិនត្រឹមត្រូវទេ"
            code.contains("PHONE_CODE_EXPIRED", ignoreCase = true) ->
                "លេខកូដបញ្ជាក់បានផុតកំណត់ហើយ សូមស្នើសុំម្តងទៀត"
            code.contains("PASSWORD_HASH_INVALID", ignoreCase = true) ->
                "ពាក្យសម្ងាត់ 2FA មិនត្រឹមត្រូវទេ"
            code.contains("API_ID_INVALID", ignoreCase = true) ->
                "API ID ឬ API Hash មិនត្រឹមត្រូវទេ"
            code.contains("PHONE_NUMBER_BANNED", ignoreCase = true) ->
                "គណនី Telegram នេះត្រូវបាន Telegram Banned"
            code.contains("FLOOD_WAIT", ignoreCase = true) ->
                "Telegram តម្រូវឱ្យរង់ចាំមុនពេលបន្ត (FLOOD_WAIT: $raw)"
            code.contains("CHAT_WRITE_FORBIDDEN", ignoreCase = true) ->
                "អ្នកគ្មានសិទ្ធិផុសសារក្នុងក្រុមនេះទេ (Admin Only/Muted)"
            else -> "កំហុស Telegram: $raw"
        }
        return EngineResult.Error(code, khmerMsg, raw)
    }
}
