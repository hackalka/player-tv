import os, re, asyncio
from telethon import TelegramClient
from supabase import create_client

# Carga de variables
API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
CANAL_PROPIO = 'Y_Y_y7o'

async def sincronizar():
    print("🚀 Iniciando sincronización...")
    
    # Verificación de seguridad
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ ERROR: No se encontraron las credenciales de Supabase en GitHub Secrets.")
        return

    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"❌ ERROR al conectar con Supabase: {e}")
        return
    
    async with TelegramClient('bot_session', int(API_ID), API_HASH).start(bot_token=BOT_TOKEN) as client:
        print(f"📡 Conectado a Telegram. Escaneando @{CANAL_PROPIO}...")
        
        async for m in client.iter_messages(CANAL_PROPIO, limit=30):
            texto = (m.text or m.caption or "").strip()
            if not texto: continue
            
            t_lower = texto.lower()
            cat = None
            if "#directo" in t_lower: cat = "#directos"
            elif "#series" in t_lower: cat = "#series"
            elif "#peliculas" in t_lower: cat = "#peliculas"
            
            if cat:
                ace = re.search(r'[a-f0-9]{40}', t_lower)
                urls = re.findall(r'https?://[^\s]+', texto)
                link = f"acestream://{ace.group(0)}" if ace else (urls[0] if urls else None)
                
                if link:
                    titulo = texto.split('\n')[0].replace('#directo','').replace('#peliculas','').replace('#series','').strip()
                    datos = {
                        "titulo": titulo,
                        "link": link,
                        "categoria": cat,
                        "portada": f"https://via.placeholder.com/300x450/000/f5c518?text={cat[1:].upper()}"
                    }
                    
                    try:
                        # Usamos link como ID único para evitar duplicados
                        supabase.table("contenidos").upsert(datos, on_conflict="link").execute()
                        print(f"✅ Guardado: {titulo}")
                    except Exception as e:
                        print(f"❌ Error en Supabase: {e}")

if __name__ == "__main__":
    asyncio.run(sincronizar())
