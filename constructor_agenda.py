import cloudscraper
import json
import requests
import re
from bs4 import BeautifulSoup
from datetime import datetime
import pytz

# === CONFIGURACIÓN ===
FIREBASE_URL_BASE = "https://playertv-9449c-default-rtdb.europe-west1.firebasedatabase.app/agenda"
URL_LALIGA = "https://vidat57t.o87wscoreqwj62jkey.sbs/es/football/tournament-spanish-la-liga-4400/matches.html"

def ejecutar_constructor_agenda():
    spain_tz = pytz.timezone('Europe/Madrid')
    hoy_dt = datetime.now(spain_tz)
    hoy_str = hoy_dt.strftime("%d.%m.%y")
    
    scraper = cloudscraper.create_scraper(browser={'browser': 'chrome','platform': 'windows'})
    
    try:
        # 1. Obtener lo que ya hay en Firebase para no borrar tus links manuales
        try:
            agenda_actual = requests.get(f"{FIREBASE_URL_BASE}.json").json() or {}
        except:
            agenda_actual = {}

        print("🌐 Extrayendo partidos y escudos oficiales...")
        res = scraper.get(URL_LALIGA, timeout=15)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        eventos = soup.select('.event-list-item') 
        nueva_agenda = {}

        for i, item in enumerate(eventos):
            try:
                # Filtrar por fecha
                time_text = item.select_one('.event-time').text.strip()
                if hoy_str not in time_text and "Hoy" not in time_text:
                    continue
                
                hora = re.search(r'\d{2}:\d{2}', time_text).group()
                
                # Datos visuales
                nombres = item.select('.team-name')
                logos = item.select('.team-logo')
                local = nombres[0].text.strip()
                visita = nombres[1].text.strip()
                titulo_full = f"{local} - {visita}".upper()
                
                # ID único basado en el nombre para no duplicar
                partido_id = re.sub(r'\W+', '', titulo_full)

                # 2. Lógica de Respeto: Si tú ya pusiste un link, lo mantenemos
                link_existente = ""
                if partido_id in agenda_actual:
                    link_existente = agenda_actual[partido_id].get("link", "")

                nueva_agenda[partido_id] = {
                    "titulo": titulo_full,
                    "hora": hora,
                    "logo1": logos[0]['src'],
                    "logo2": logos[1]['src'],
                    "categoria": "agenda",
                    "link": link_existente  # Mantiene tu enlace si ya lo editaste
                }
                print(f"✅ Preparado: {titulo_full} ({hora})")
                
            except Exception as e: continue

        # 3. Actualizar Firebase
        if nueva_agenda:
            # Usamos PUT en la raíz de agenda para que limpie partidos de días pasados
            # pero nueva_agenda ya contiene los links que rescatamos en el paso 2
            requests.put(f"{FIREBASE_URL_BASE}.json", data=json.dumps(nueva_agenda))
            print(f"\n🚀 Agenda lista. Ahora puedes entrar a Firebase/Panel y añadir los links.")
        else:
            print("⚠️ No hay partidos para hoy.")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    ejecutar_constructor_agenda()
