import requests
import json
import pytz
from datetime import datetime, timedelta

# === CONFIGURACIÓN ===
API_KEY = "0e962a69b34843a99b5a18ae6467f390" 
FIREBASE_URL = "https://playertv-9449c-default-rtdb.europe-west1.firebasedatabase.app/agenda"

def ejecutar_constructor():
    spain_tz = pytz.timezone('Europe/Madrid')
    ahora = datetime.now(spain_tz)
    
    fecha_inicio = ahora.strftime("%Y-%m-%d")
    fecha_fin = (ahora + timedelta(days=7)).strftime("%Y-%m-%d")

    # Solo Liga Española (PD)
    competiciones = ["PD"] 
    headers = { 'X-Auth-Token': API_KEY }

    try:
        # Obtenemos lo que ya hay en la DB para no borrar nada
        resp_old = requests.get(f"{FIREBASE_URL}.json").json() or {}
        
        for comp in competiciones:
            URL_API = f"https://api.football-data.org/v4/competitions/{comp}/matches?dateFrom={fecha_inicio}&dateTo={fecha_fin}"
            res = requests.get(URL_API, headers=headers)

            if res.status_code == 200:
                partidos = res.json().get('matches', [])
                dias_semana = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"]

                for partido in partidos:
                    eq1 = partido['homeTeam']['shortName'] or partido['homeTeam']['name']
                    eq2 = partido['awayTeam']['shortName'] or partido['awayTeam']['name']
                    
                    utc_date = datetime.strptime(partido['utcDate'], "%Y-%m-%dT%H:%M:%SZ")
                    obj_fecha = pytz.utc.localize(utc_date).astimezone(spain_tz)
                    
                    # Filtro: No subir partidos que ya pasaron hace más de 3 horas
                    if obj_fecha < (ahora - timedelta(hours=3)): continue

                    id_partido = obj_fecha.strftime("%Y%m%d%H%M") + "PD"
                    
                    # CREACIÓN DEL CAMPO EXTRA (Día y Hora)
                    # Formato: "DOM 25 - 21:00"
                    texto_dia = dias_semana[obj_fecha.weekday()]
                    texto_hora = obj_fecha.strftime("%H:%M")
                    dia_num = obj_fecha.strftime("%d")
                    
                    campo_extra = f"{texto_dia} {dia_num} - {texto_hora}"

                    datos_partido = {
                        "titulo": f"{eq1} - {eq2}".upper(),
                        "extra": campo_extra, # <--- ESTO ES LO QUE SALE EN LA TARJETA
                        "logo1": partido['homeTeam']['crest'],
                        "logo2": partido['awayTeam']['crest'],
                        "categoria": "agenda",
                        "timestamp": int(obj_fecha.timestamp())
                    }

                    # Si el partido ya existe, mantenemos los links que tú hayas puesto
                    if id_partido in resp_old:
                        for k, v in resp_old[id_partido].items():
                            if k.startswith('link'): datos_partido[k] = v

                    # PATCH para no borrar el resto de ligas que metas a mano
                    requests.patch(f"{FIREBASE_URL}/{id_partido}.json", data=json.dumps(datos_partido))
                    print(f"✅ Guardado: {eq1}-{eq2} ({campo_extra})")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    ejecutar_constructor()
