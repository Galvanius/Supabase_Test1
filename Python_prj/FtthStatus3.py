import requests

# --- INCOLLA QUI IL TUO COOKIE COMPLETO ---
# Esempio: "_TESTCOOKIESUPPORT=1; SID=xxxxxxxx"
MY_COOKIE = '_TESTCOOKIESUPPORT=1; SID=492d04d3f706f53429b608b4d5f95711815cfe7ccfd7b1990f949955da3a9c4e'

MODEM_IP = "192.168.1.1"

headers = {
    "Host": MODEM_IP,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.8,en-US;q=0.5,en;q=0.3",
    "Connection": "keep-alive",
    "Cookie": MY_COOKIE,
    "Upgrade-Insecure-Requests": "1",
    "Referer": f"http://{MODEM_IP}/inst/index.html"
}

def check_wan():
    # Proviamo l'endpoint specifico per la configurazione WAN
    url = f"http://{MODEM_IP}/common_page/net_wan_conf_lua.lua?_type=menuData"
    
    try:
        r = requests.get(url, headers=headers, timeout=5)
        
        if "SessionTimeout" in r.text:
            print("❌ ERRORE: Sessione scaduta. Devi ricaricare la pagina nel browser e copiare il nuovo SID.")
        elif "Connected" in r.text:
            print("✅ INTERNET: Connesso")
            if "Up" in r.text:
                print("✅ LINK ONT: Attivo")
        else:
            print("--- RISPOSTA RICEVUTA ---")
            print(r.text) # Stampiamo tutto per capire cosa risponde se non trova 'Connected'
            
    except Exception as e:
        print(f"Errore: {e}")

if __name__ == "__main__":
    check_wan()
