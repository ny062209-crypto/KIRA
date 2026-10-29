package com.kiragaming.kiraautopost.data

import android.content.Context
import android.content.SharedPreferences

class PreferencesManager(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("kira_autopost_prefs", Context.MODE_PRIVATE)

    var hasAcceptedTerms: Boolean
        get() = prefs.getBoolean("has_accepted_terms", false)
        set(value) = prefs.edit().putBoolean("has_accepted_terms", value).apply()

    var serverUrl: String
        get() = prefs.getString("server_url", "https://kira-server-f7vr.onrender.com") ?: "https://kira-server-f7vr.onrender.com"
        set(value) = prefs.edit().putString("server_url", value).apply()

    var serverToken: String
        get() = prefs.getString("server_token", "") ?: ""
        set(value) = prefs.edit().putString("server_token", value).apply()

    var postDelaySeconds: Int
        get() = prefs.getInt("post_delay_seconds", 40)
        set(value) {
            val safe = if (value < 10) 10 else value
            prefs.edit().putInt("post_delay_seconds", safe).apply()
        }

    var enableRandomDelay: Boolean
        get() = prefs.getBoolean("enable_random_delay", true)
        set(value) = prefs.edit().putBoolean("enable_random_delay", value).apply()

    var maxPerHour: Int
        get() = prefs.getInt("max_per_hour", 50)
        set(value) = prefs.edit().putInt("max_per_hour", value).apply()

    var dailyLimit: Int
        get() = prefs.getInt("daily_limit", 200)
        set(value) = prefs.edit().putInt("daily_limit", value).apply()

    var quietHoursEnabled: Boolean
        get() = prefs.getBoolean("quiet_hours_enabled", false)
        set(value) = prefs.edit().putBoolean("quiet_hours_enabled", value).apply()

    var appLockEnabled: Boolean
        get() = prefs.getBoolean("app_lock_enabled", false)
        set(value) = prefs.edit().putBoolean("app_lock_enabled", value).apply()

    var appLockPin: String
        get() = prefs.getString("app_lock_pin", "") ?: ""
        set(value) = prefs.edit().putString("app_lock_pin", value).apply()

    var isTestMode: Boolean
        get() = prefs.getBoolean("is_test_mode", false)
        set(value) = prefs.edit().putBoolean("is_test_mode", value).apply()

    // Draft of the post text, kept so it survives switching tabs / closing the app
    var draftText: String
        get() = prefs.getString("draft_text", "") ?: ""
        set(value) = prefs.edit().putString("draft_text", value).apply()
}
