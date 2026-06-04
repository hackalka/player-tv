package com.tvplayer.player_tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tvplayer.player_tv.ui.theme.PlayertvTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PlayertvTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    TelegramPlayerScreen(Modifier.padding(innerPadding))
                }
            }
        }
    }
}

@Composable
fun TelegramPlayerScreen(modifier: Modifier = Modifier) {
    var inputUrl by remember { mutableStateOf("https://t.me/durov/248") }
    var resolvedUrl by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (resolvedUrl == null) {
            Text(text = "Enter Telegram Video Link (t.me/channel/id)", modifier = Modifier.padding(bottom = 8.dp))
            TextField(
                value = inputUrl,
                onValueChange = { inputUrl = it },
                label = { Text("Telegram URL") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    isLoading = true
                    error = null
                    scope.launch {
                        val result = TelegramLinkResolver.resolve(inputUrl)
                        if (result != null) {
                            resolvedUrl = result
                        } else {
                            error = "Could not resolve video URL. Make sure it is a public channel link."
                        }
                        isLoading = false
                    }
                },
                modifier = Modifier.padding(top = 8.dp)
            ) {
                Text(if (isLoading) "Resolving..." else "Play Video")
            }
            error?.let {
                Text(text = it, color = androidx.compose.ui.graphics.Color.Red, modifier = Modifier.padding(top = 8.dp))
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                Button(onClick = { resolvedUrl = null }, modifier = Modifier.padding(8.dp)) {
                    Text("Back")
                }
                VideoPlayer(videoUrl = resolvedUrl!!, modifier = Modifier.fillMaxSize())
            }
        }
    }
}
