import os, re, json, asyncio, requests
from telethon import TelegramClient

# --- CONFIGURACIÓN ---
API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
TMDB_KEY = os.getenv('TMDB_API_KEY') # Nueva clave para las portadas
FIREBASE_URL = "https://playertv-9449c-default-rtdb.europe-west1.firebasedatabase.app/"
CANAL_PROPIO = 'Y_Y_y7o'

# --- FUNCIÓN PARA BUSCAR PORTADA ---
def buscar_portada(titulo, categoria):
    if not TMDB_KEY or categoria == "directos":
        return "https://via.placeholder.com/300x450/000/f5c518?text=TV+LIVE"
    
    tipo = "movie" if categoria == "peliculas" else "tv"
    url = f"https://api.themoviedb.org/3/search/{tipo}?api_key={TMDB_KEY}&query={titulo}&language=es-ES"
    
    try:
        res = requests.get(url).json()
        if res.get('results'):
            path = res['results'][0].get('poster_path')
            if path:
                return f"https://image.tmdb.org/t/p/w500{path}"
    except:
        pass
    return "https://via.placeholder.com/300x450/000/f5c518?text=SIN+IMAGEN"

# --- PROCESO PRINCIPAL ---
async def extraer_y_subir():
    async with TelegramClient('sesion_tv', int(API_ID), API_HASH) as client:
        print("📡 Escaneando canal...")
        datos = {"peliculas": {}, "series": {}, "directos": {}}

        async for m in client.iter_messages(CANAL_PROPIO, limit=50):
            texto_raw = (m.text or m.caption or "")
            texto = texto_raw.lower()
            
            # Detectar Categoría
            cat = None
            if "#pelicula" in texto: cat = "peliculas"
            elif "#serie" in texto: cat = "series"
            elif "#directo" in texto: cat = "directos"

            if cat:
                # Extraer Link
                ace = re.search(r'[a-f0-9]{40}', texto)
                urls = re.findall(r'https?://[^\s]+', texto)
                link = f"acestream://{ace.group(0)}" if ace else (urls[0] if urls else None)

                if link:
                    # Limpiar Título (Quitamos hashtags y símbolos)
                    titulo = texto_raw.split('\n')[0]
                    titulo = re.sub(r'#\w+', '', titulo).strip()

                    # Buscar Portada Automática
                    portada = buscar_portada(titulo, cat)

                    datos[cat][str(m.id)] = {
                        "titulo": titulo,
                        "link": link,
                        "portada": portada,
                        "categoria": "#" + cat,
                        "timestamp": m.date.timestamp()
                    }

        # Subir a Firebase (PATCH no borra lo anterior, solo añade/actualiza)
        for c, items in datos.items():
            if items:
                requests.patch(f"{FIREBASE_URL}{c}.json", json=items)
                print(f"✅ Sincronizado: {c}")

if __name__ == "__main__":
    asyncio.run(extraer_y_subir())
