import requests

from modem_config import MODEM_IP

# --- DATI DA INCOLLARE ---
# Incolla qui l'intera stringa del Cookie che hai copiato dal browser
COOKIE_STRINGA = "_TESTCOOKIESUPPORT=1; SID=492d04d3f706f53429b608b4d5f95711815cfe7ccfd7b1990f949955da3a9c4e"
REFERER_URL = f"http://{'.'.join(MODEM_IP.split('.')[:3])}"

headers = {
    "Cookie": COOKIE_STRINGA,
    "Referer": REFERER_URL,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0"
}

def get_real_status():
    # Questo endpoint contiene i dati della WAN/ONT
    url = f"http://{MODEM_IP}/common_page/net_wan_conf_lua.lua?_type=menuData"
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        
        if response.status_code == 200:
            content = response.text
            print("--- ANALISI CONNESSIONE REALE ---")
            
            # Controllo Stato Internet
            if 'ConnStatus = "Connected"' in content:
                print("Internet: ✅ CONNESSO (Sessione PPPoE attiva)")
            else:
                print("Internet: ❌ DISCONNESSO (Controlla parametri TIM)")

            # Controllo Link Fisico con ONT
            if 'LinkStatus = "Up"' in content:
                print("Link ONT: ✅ ATTIVO (Il cavo Ethernet tra ONT e Modem funziona)")
            else:
                print("Link ONT: ❌ DOWN (Cavo WAN scollegato o ONT spento)")
                
            # Mostra IP Pubblico se presente
            if "ExternalIPAddress" in content:
                # Estrazione rozza dell'IP per conferma
                import re
                ip = re.search(r'ExternalIPAddress = "([\d\.]+)"', content)
                if ip: print(f"Indirizzo IP: {ip.group(1)}")
                
        else:
            print(f"Errore: Il modem ha risposto con codice {response.status_code}. Sessione scaduta?")

    except Exception as e:
        print(f"Errore di connessione: {e}")

if __name__ == "__main__":
    get_real_status()