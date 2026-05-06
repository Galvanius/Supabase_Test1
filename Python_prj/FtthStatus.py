import requests
import json

from modem_config import MODEM_IP, PASSWORD

session = requests.Session()

def check_wan_status():
    try:
        # 1. Login (Semplificato per ZTE brandizzati)
        login_url = f"http://{MODEM_IP}/common_page/login_lua.lua"
        login_data = {
            "Username": "admin",
            "Password": PASSWORD,
            "action": "login"
        }
        
        print(f"Tentativo di login a {MODEM_IP}...")
        login_res = session.post(login_url, data=login_data, timeout=5)
        
        # 2. Richiesta dati WAN
        # Usiamo l'endpoint che contiene i dettagli della connessione FTTH
        status_url = f"http://{MODEM_IP}/common_page/net_wan_conf_lua.lua?_type=menuData"
        
        response = session.get(status_url, timeout=5)
        
        if response.status_code == 200:
            # Analisi grezza della risposta (spesso il modem risponde con testo strutturato)
            data = response.text
            
            print("\n--- STATO CONNESSIONE ---")
            if "Connected" in data:
                print("Internet: ✅ CONNESSO")
            else:
                print("Internet: ❌ DISCONNESSO")
            
            if "Up" in data:
                print("Link Fisico (ONT): ✅ ATTIVO (Link Up)")
            else:
                print("Link Fisico (ONT): ❌ DISCONNESSO (Controlla cavo WAN)")
            
            # Opzionale: stampa tutto per debug se vuoi vedere i dettagli tecnici
            # print("\nDati completi:", data)
            
        else:
            print(f"Errore nella lettura dati: {response.status_code}")

    except Exception as e:
        print(f"Errore di connessione: {e}")

if __name__ == "__main__":
    check_wan_status()
