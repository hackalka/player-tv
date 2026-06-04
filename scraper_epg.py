import os
import requests
import gspread
from bs4 import BeautifulSoup
from google.oauth2.service_account import Credentials

# CONFIGURACIÓN DE GOOGLE SHEETS
# Asegúrate de tener el archivo 'credentials.json' en la misma carpeta
# O configurar las variables de entorno si usas GitHub Actions
SCOPE = ["https://www.googleapis.com/auth/spreadsheets"]
SHEET_ID = "1-hVWGKVRvwERFxGTWtd_rAnsVbzTbhQn3ocF72m9l3A"

def scrape_movistar():
    url = "https://www.movistarplus.es/programacion-tv"
    try:
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        eventos = []
        
        # Seleccionamos los elementos de la programación
        # Nota: Las clases CSS de Movistar cambian a menudo, hay que revisarlas
        for programa in soup.find_all('li', class_='program-item'):
            try:
                titulo_el = programa.find('span', class_='title')
                hora_el = programa.find('span', class_='hour')
                
                if titulo_el and hora_el:
                    titulo = titulo_el.text.strip()
                    hora = hora_el.text.strip()
                    
                    # Filtramos deportes
                    if any(x in titulo.lower() for x in ['fútbol', 'liga', 'baloncesto', 'tenis', 'f1', 'motogp']):
                        # Formato para la fila de Google Sheets
                        eventos.append([hora, titulo, "Movistar+", "Movistar"])
            except Exception:
                continue
                
        return eventos
    except Exception as e:
        print(f"❌ Error en scraping: {e}")
        return []

def actualizar_google_sheets():
    # 1. Autenticación
    # Si usas archivo local: 'credentials.json'. Si usas GitHub: usar Service Account info
    creds = Credentials.from_service_account_file('credentials.json', scopes=SCOPE)
    client = gspread.authorize(creds)
    
    # 2. Abrir la hoja y la pestaña específica
    try:
        spreadsheet = client.open_by_key(SHEET_ID)
        # Intentamos abrir la pestaña 'epg', si no existe la crea
        try:
            worksheet = spreadsheet.worksheet("epg")
        except gspread.exceptions.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(title="epg", rows="100", cols="5")
        
        datos = scrape_movistar()
        
        if datos:
            # 3. Limpiar la hoja y añadir encabezados
            worksheet.clear()
            headers = ["HORA", "EVENTO", "CANAL", "PLATAFORMA"]
            worksheet.append_row(headers)
            
            # 4. Insertar los nuevos datos
            worksheet.append_rows(datos)
            print(f"✅ Google Sheets EPG Actualizado: {len(datos)} eventos encontrados.")
        else:
            print("⚠️ No se encontraron eventos para subir.")
            
    except Exception as e:
        print(f"❌ Error conectando a Google Sheets: {e}")

if __name__ == "__main__":
    actualizar_google_sheets()
