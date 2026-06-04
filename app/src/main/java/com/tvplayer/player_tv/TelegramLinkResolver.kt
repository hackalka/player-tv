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
            // Clean URL: Convert t.me/channel/topic/id or t.me/channel/id to t.me/s/channel/id
            val uri = telegramUrl.trim().removeSuffix("/")
            val parts = uri.split("/")
            
            val sUrl = if (parts.size >= 5 && !uri.contains("/s/")) {
                // Format: https://t.me/channel/topic/id -> https://t.me/s/channel/id
                val channel = parts[3]
                val msgId = parts.last()
                "https://t.me/s/$channel/$msgId"
            } else if (!uri.contains("/s/")) {
                uri.replace("t.me/", "t.me/s/")
            } else {
                uri
            }

            val request = Request.Builder()
                .url(sUrl)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val html = response.body.string()
                val doc = Jsoup.parse(html)
                
                // 1. Try to find the <video> tag directly (common in /s/ preview)
                val videoElement = doc.select("video").first()
                val videoUrl = videoElement?.attr("src")
                if (!videoUrl.isNullOrEmpty()) return@withContext videoUrl

                // 2. Try to find meta tags (og:video)
                val ogVideo = doc.select("meta[property=og:video]").first()?.attr("content")
                if (!ogVideo.isNullOrEmpty()) return@withContext ogVideo

                // 3. Try to find twitter:player:stream
                val twitterVideo = doc.select("meta[name=twitter:player:stream]").first()?.attr("content")
                if (!twitterVideo.isNullOrEmpty()) return@withContext twitterVideo
                
                null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}
