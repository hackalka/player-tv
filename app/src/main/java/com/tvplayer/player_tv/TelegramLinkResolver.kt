package com.tvplayer.player_tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup

object TelegramLinkResolver {
    private val client = OkHttpClient()

    suspend fun resolve(telegramUrl: String): String? = withContext(Dispatchers.IO) {
        try {
            // Convert t.me/channel/123 to t.me/s/channel/123 for public view
            val sUrl = if (!telegramUrl.contains("/s/")) {
                telegramUrl.replace("t.me/", "t.me/s/")
            } else {
                telegramUrl
            }

            val request = Request.Builder()
                .url(sUrl)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val html = response.body.string()
                val doc = Jsoup.parse(html)
                
                // Look for video tag
                val videoElement = doc.select("video").first()
                videoElement?.attr("src")
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}
