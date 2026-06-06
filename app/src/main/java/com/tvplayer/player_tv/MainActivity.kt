package com.tvplayer.player_tv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.tvplayer.player_tv.ui.theme.PlayertvTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.json.JSONArray

// Configuración de Colores Premium
val NetRed = Color(0xFFE50914)
val NetBlack = Color(0xFF0B0B0B)
val NetSurface = Color(0xFF181818)
val NetGray = Color(0xFFB3B3B3)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PlayertvTheme {
                Surface(color = NetBlack, modifier = Modifier.fillMaxSize()) {
                    PlayerTVHome()
                }
            }
        }
    }
}

data class MediaItem(
    val id: Int,
    val titulo: String,
    val sinopsis: String,
    val portada: String,
    val categoria: String
)

@Composable
fun PlayerTVHome() {
    var peliculas by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var series by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    val apiBase = "https://player-tv-a8f4.onrender.com"

    LaunchedEffect(Unit) {
        val data = fetchCatalog(apiBase)
        peliculas = data["peliculas"] ?: emptyList()
        series = data["series"] ?: emptyList()
        isLoading = false
    }

    if (isLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = NetRed)
        }
    } else {
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            // 1. Hero Banner
            item {
                if (peliculas.isNotEmpty()) {
                    HeroBanner(peliculas[0], apiBase)
                }
            }

            // 2. Carrusel Películas
            item { MediaRow("PELÍCULAS", peliculas, apiBase) }

            // 3. Carrusel Series
            item { MediaRow("SERIES", series, apiBase) }
        }
    }
}

@Composable
fun HeroBanner(item: MediaItem, apiBase: String) {
    val context = LocalContext.current
    Box(modifier = Modifier.fillMaxWidth().height(550.dp)) {
        AsyncImage(
            model = "$apiBase${item.portada}",
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Cover
        )
        Box(modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color.Transparent, NetBlack), startY = 600f)
        ))
        Column(modifier = Modifier.align(Alignment.BottomStart).padding(24.dp)) {
            Text(item.titulo, fontSize = 40.sp, fontWeight = FontWeight.ExtraBold)
            Text(item.sinopsis, color = NetGray, maxLines = 2, modifier = Modifier.padding(vertical = 12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = { /* Lógica de Play */ },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.Black)
                    Text("Reproducir", color = Color.Black, fontWeight = FontWeight.Bold)
                }
                Button(
                    onClick = { /* Info */ },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.DarkGray.copy(alpha = 0.6f)),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = Color.White)
                    Text("Información", color = Color.White)
                }
            }
        }
    }
}

@Composable
fun MediaRow(title: String, items: List<MediaItem>, apiBase: String) {
    Column(modifier = Modifier.padding(vertical = 16.dp)) {
        Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp, 
            modifier = Modifier.padding(start = 16.dp, bottom = 12.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(items) { item ->
                MediaCard(item, apiBase)
            }
        }
    }
}

@Composable
fun MediaCard(item: MediaItem, apiBase: String) {
    var isFocused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (isFocused) 1.1f else 1f)

    Card(
        modifier = Modifier.width(160.dp).height(240.dp).scale(scale).clickable { /* Play */ },
        shape = RoundedCornerShape(8.dp)
    ) {
        AsyncImage(
            model = "$apiBase${item.portada}",
            contentDescription = item.titulo,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Cover
        )
    }
}

suspend fun fetchCatalog(apiBase: String): Map<String, List<MediaItem>> = withContext(Dispatchers.IO) {
    val client = OkHttpClient()
    val request = Request.Builder().url("$apiBase/api/catalogo").build()
    try {
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return@withContext emptyMap()
            val json = JSONObject(response.body?.string() ?: "")
            val result = mutableMapOf<String, List<MediaItem>>()
            
            val cats = listOf("peliculas", "series")
            cats.forEach { cat ->
                val arr = json.optJSONArray(cat) ?: JSONArray()
                val list = mutableListOf<MediaItem>()
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    list.add(MediaItem(
                        id = obj.getInt("id"),
                        titulo = obj.getString("titulo"),
                        sinopsis = obj.getString("sinopsis"),
                        portada = obj.getString("portada"),
                        categoria = cat
                    ))
                }
                result[cat] = list
            }
            result
        }
    } catch (e: Exception) { emptyMap() }
}
