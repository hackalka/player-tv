import os, re, json, asyncio
from telethon import TelegramClient

API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
# Dirección pública de tu canal
CANAL_VIDEOS = 'Y_Y_y7o' 
ESTADO_FILE = 'estado.txt'

async def scan():
    if not API_ID or not API_HASH:
        print("ERROR: Configura los Secrets en GitHub")
        return

    async with TelegramClient('bot_pelis', int(API_ID), API_HASH) as client:
        db = []
        if os.path.exists('peliculas.json'):
            with open('peliculas.json', 'r', encoding='utf-8') as f:
                try: db = json.load(f)
                except: db = []

        modo_actual = "#peliculas"
        if os.path.exists(ESTADO_FILE):
            with open(ESTADO_FILE, 'r') as f:
                modo_actual = f.read().strip()

        links_vistos = [item.get('link', '') for item in db]
        nuevos_en_esta_ronda = []

        print(f"Escaneando canal: {CANAL_VIDEOS}")
        messages = await client.get_messages(CANAL_VIDEOS, limit=30)
        
        # Invertimos para leer del más viejo al más nuevo y detectar cambios de #modo
        for m in reversed(messages):
            if not m.text: continue
            
            texto = m.text.strip().lower()
            if texto == "#series": modo_actual = "#series"; continue
            if texto == "#peliculas": modo_actual = "#peliculas"; continue

            # Busca ID de Acestream o enlaces HTTP
            urls = re.findall(r'(https?://[^\s]+|[a-fA-F0-9]{40})', m.text)
            if urls:
                link_raw = urls[0]
                titulo = m.text.split('\n')[0].strip()[:50]
                
                if len(link_raw) == 40:
                    final_link = f"acestream://{link_raw}"
                else:
                    final_link = link_raw if link_raw.startswith("tvgram") else f"tvgram://play?url={link_raw}"

                if final_link not in links_vistos:
                    # Insertar al principio de la lista de nuevos
                    nuevos_en_esta_ronda.insert(0, {
                        "titulo": titulo,
                        "portada": "https://via.placeholder.com/300x450/000/f5c518?text=" + ("SERIE" if modo_actual == "#series" else "PELI"),
                        "categoria": modo_actual,
                        "anio": "2026",
                        "link": final_link,
                        "id": str(m.id)
                    })

        with open(ESTADO_FILE, 'w') as f: f.write(modo_actual)

        if nuevos_en_esta_ronda:
            # NUEVOS ARRIBA DE LOS VIEJOS
            with open('peliculas.json', 'w', encoding='utf-8') as f:
                json.dump(nuevos_en_esta_ronda + db, f, indent=4, ensure_ascii=False)
            print(f"✅ {len(nuevos_en_esta_ronda)} nuevos añadidos arriba.")

if __name__ == "__main__":
    asyncio.run(scan())
