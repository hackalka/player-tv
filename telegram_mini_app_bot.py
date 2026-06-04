import os
import asyncio
from telethon import TelegramClient, events, functions, types

# --- CONFIGURACIÓN ---
API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
APP_URL = "TU_URL_AQUI" # Ejemplo: https://tu-usuario.github.io/player-tv-main/

async def main():
    async with TelegramClient('bot_mini_app', int(API_ID), API_HASH).start(bot_token=BOT_TOKEN) as client:
        print("🤖 Bot iniciado para Telegram Mini App")

        # Configurar el botón de menú para abrir la Web App
        await client(functions.bots.SetBotMenuButtonRequest(
            button=types.BotMenuButtonWebApp(
                text="Abrir Player TV",
                url=APP_URL
            )
        ))
        print(f"✅ Botón de menú configurado para: {APP_URL}")

        @client.on(events.NewMessage(pattern='/start'))
        async def start(event):
            await event.respond(
                "¡Bienvenido a Player TV! 📺\n\nPresiona el botón de abajo para empezar a ver.",
                buttons=[[types.KeyboardButtonWebApp("Ver TV", APP_URL)]]
            )

        print("📡 Esperando mensajes...")
        await client.run_until_disconnected()

if __name__ == "__main__":
    if not all([API_ID, API_HASH, BOT_TOKEN]):
        print("❌ ERROR: Faltan variables de entorno (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_BOT_TOKEN)")
    else:
        asyncio.run(main())
