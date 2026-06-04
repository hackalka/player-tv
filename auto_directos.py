import requests
import json
import re

# CONFIGURACIÓN
JSON_URL = "https://k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr.ipns.dweb.link/hashes.json"
FIREBASE_URL = "https://playertv-9449c-default-rtdb.europe-west1.firebasedatabase.app/directos.json"

# DICCIONARIO DE LOGOS OFICIALES
LOGOS = {
    "DAZN LALIGA": "https://img.asmedia.epimg.net/resizer/v2/https%3A%2F%2Fas01.epimg.net%2Fvideos%2Fimagenes%2F2022%2F03%2F29%2Fportada%2F1648550217_341641_1648550302_noticia_normal.jpg?auth=76383794e7747e94e7747e94e7747e94&width=1200&height=675&smart=true",
    "M+ LALIGA": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Movistar_LaLiga_2020.png/640px-Movistar_LaLiga_2020.png",
    "MOVISTAR PLUS": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Movistar_Plus%2B_2023.svg/1200px-Movistar_Plus%2B_2023.svg.png",
    "DAZN 1": "https://s1.eestatic.com/2021/01/20/actualidad/552705973_171120008_1706x960.jpg",
    "DAZN 2": "https://s1.eestatic.com/2021/01/20/actualidad/552705973_171120008_1706x960.jpg",
    "EUROSPORT": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Eurosport_logo_2015.svg/1200px-Eurosport_logo_2015.svg.png",
    "LALIGA TV": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/LaLiga_TV_logo_2023.svg/1200px-LaLiga_TV_logo_2023.svg.png",
    "DEFAULT": "https://cdn-icons-png.flaticon.com/512/5721/5721478.png"
}

def limpiar_nombre(nombre):
    """Limpia nombres para que el HTML los agrupe bien (quita HD, 4K, etc)"""
    n = nombre.upper()
    n = re.sub(r'\(.*?\)', '', n) # Quita paréntesis
    n = n.replace('HD', '').replace('SD', '').replace('1080P', '').replace('V.O.', '')
    return n.strip()

def sincronizar():
    print("🚀 Sincronizando canales...")
    try:
        r = requests.get(JSON_URL, timeout=10)
        canales_raw = r.json()
        datos_finales = {}

        for i, item in enumerate(canales_raw):
            nombre_sucio = item.get("name", "Canal")
            nombre_limpio = limpiar_nombre(nombre_sucio)
            acestream_id = item.get("acestream")

            if acestream_id:
                # Buscamos logo por nombre limpio o el de por defecto
                logo = LOGOS.get("DEFAULT")
                for clave in LOGOS:
                    if clave in nombre_limpio:
                        logo = LOGOS[clave]
                        break

                datos_finales[f"ch_{i}"] = {
                    "titulo": nombre_limpio,
                    "link": f"acestream://{acestream_id}",
                    "portada": logo,
                    "categoria": "#directos"
                }

        # Subimos a Firebase (sobrescribe lo viejo)
        res = requests.put(FIREBASE_URL, data=json.dumps(datos_finales))
        if res.status_code == 200:
            print(f"✅ ¡Hecho! {len(datos_finales)} señales en tu App.")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    sincronizar()
