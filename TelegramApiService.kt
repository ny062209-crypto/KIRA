package com.kiragaming.kiraautopost.engine.remote

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

data class SendCodeRequest(
    val api_id: Int,
    val api_hash: String,
    val phone: String
)

data class SendCodeApiResponse(
    val status: String,
    val phone_code_hash: String?,
    val delivery_type: String?,
    val timeout: Int?,
    val error: String?,
    val error_code: String?
)

data class VerifyCodeRequest(
    val phone: String,
    val phone_code_hash: String,
    val code: String
)

data class Verify2FaRequest(
    val phone: String,
    val password: String
)

data class AuthApiResponse(
    val status: String,
    val user_id: Long?,
    val first_name: String?,
    val username: String?,
    val session_string: String?,
    val error: String?,
    val error_code: String?
)

data class LoadChatsRequest(
    val session_string: String
)

data class RemoteChatDto(
    val id: Long,
    val title: String,
    val username: String?,
    val type: String,
    val can_post: Boolean,
    val member_count: Int,
    val photo: String? = null
)

data class LoadChatsApiResponse(
    val status: String,
    val chats: List<RemoteChatDto>?,
    val error: String?,
    val error_code: String?
)

data class SendMessageApiResponse(
    val status: String,
    val message_id: Long?,
    val message_ids: List<Long>? = null,
    val error: String?,
    val error_code: String?
)

data class ForwardRequest(
    val session_string: String,
    val to_chat_id: Long,
    val message_ids: List<Long>,
    val from_chat_id: Long = 0L,
    val hide_author: Boolean = true
)

data class HealthResponse(
    val status: String,
    val engine: String
)

interface TelegramApiService {
    @GET("health")
    suspend fun healthCheck(): Response<HealthResponse>

    @POST("login/send-code")
    suspend fun sendCode(
        @Header("X-Kira-Token") token: String,
        @Body request: SendCodeRequest
    ): Response<SendCodeApiResponse>

    @POST("login/verify")
    suspend fun verifyCode(
        @Header("X-Kira-Token") token: String,
        @Body request: VerifyCodeRequest
    ): Response<AuthApiResponse>

    @POST("login/2fa")
    suspend fun verify2FA(
        @Header("X-Kira-Token") token: String,
        @Body request: Verify2FaRequest
    ): Response<AuthApiResponse>

    @POST("chats")
    suspend fun loadChats(
        @Header("X-Kira-Token") token: String,
        @Body request: LoadChatsRequest
    ): Response<LoadChatsApiResponse>

    @Multipart
    @POST("send")
    suspend fun sendMessage(
        @Header("X-Kira-Token") token: String,
        @Part("session_string") sessionString: RequestBody,
        @Part("chat_id") chatId: RequestBody,
        @Part("text") text: RequestBody,
        @Part media: List<MultipartBody.Part>
    ): Response<SendMessageApiResponse>

    @POST("forward")
    suspend fun forwardMessages(
        @Header("X-Kira-Token") token: String,
        @Body request: ForwardRequest
    ): Response<SendMessageApiResponse>
}
