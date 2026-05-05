import argparse
import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _require_requests():
    try:
        import requests  # type: ignore

        return requests
    except Exception as e:
        raise RuntimeError(
            "Modulo 'requests' non trovato. Installa con: pip install requests\n"
            f"Dettagli: {e}"
        ) from e


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_instances(xml_text: str, root_element: str) -> List[Dict[str, str]]:
    root = ET.fromstring(xml_text)
    out: List[Dict[str, str]] = []
    for instance in root.findall(f".//{root_element}/Instance"):
        item: Dict[str, str] = {}
        names = instance.findall("ParaName")
        values = instance.findall("ParaValue")
        for n, v in zip(names, values):
            key = (n.text or "").strip()
            val = (v.text or "").strip()
            if key:
                item[key] = val
        if item:
            out.append(item)
    return out


def _pick_internet_eth(instances: List[Dict[str, str]]) -> Optional[Dict[str, str]]:
    # Priorita' 1: WANCName = INTERNET_ETH
    for it in instances:
        if it.get("WANCName", "").upper() == "INTERNET_ETH":
            return it

    # Priorita' 2: qualunque valore contiene INTERNET_ETH
    for it in instances:
        if any("INTERNET_ETH" in str(v).upper() for v in it.values()):
            return it

    # Priorita' 3: fallback su profilo INTERNET con uplink ETH
    for it in instances:
        serv = it.get("strServList", "").upper()
        uplink = it.get("TypeUplink", it.get("Uplink", "")).strip()
        if "INTERNET" in serv and uplink in ("2", "ETH", "ETHERNET", ""):
            return it

    return None


def _pick_voip_instance(instances: List[Dict[str, str]]) -> Optional[Dict[str, str]]:
    for it in instances:
        if "VOIP" in it.get("WANCName", "").upper():
            return it
    for it in instances:
        if any("VOIP" in str(v).upper() for v in it.values()):
            return it
    return None


def _voip_led_status_from_instance(voip: Optional[Dict[str, str]]) -> Dict[str, Any]:
    if not voip:
        return {
            "voip_led_on": None,
            "voip_led": "UNKNOWN",
            "reason": "istanza VOIP non trovata in ID_WAN_COMFIG",
        }

    conn = (voip.get("ConnStatus") or voip.get("ConnStatus6") or "").strip().lower()
    if conn in ("connected", "up", "1", "true"):
        return {"voip_led_on": True, "voip_led": "ON", "conn_status": conn}
    if conn in ("disconnected", "down", "0", "false", "connecting", "error"):
        return {"voip_led_on": False, "voip_led": "OFF", "conn_status": conn}

    return {
        "voip_led_on": None,
        "voip_led": "UNKNOWN",
        "conn_status": conn if conn else None,
        "reason": "ConnStatus VOIP non interpretabile",
    }


def _login_h388x(session: Any, host: str, username: str, password: str) -> Dict[str, Any]:
    base = f"http://{host}"
    session.get(base, timeout=6)

    prelogin_json = session.get(f"{base}/?_type=loginData&_tag=login_entry", timeout=12).json()
    sess_token = prelogin_json.get("sess_token")
    if not sess_token:
        raise RuntimeError("sess_token non trovato nella pre-login.")

    salt_xml = session.get(f"{base}/?_type=loginData&_tag=login_token", timeout=12).text
    salt = (ET.fromstring(salt_xml).text or "").strip()
    if not salt:
        raise RuntimeError("salt non trovato in login_token.")

    hashed_password = hashlib.sha256(f"{password}{salt}".encode("utf-8")).hexdigest()

    login_data = {
        "Password": hashed_password,
        "Username": username,
        "_sessionTOKEN": sess_token,
        "action": "login",
    }
    resp = session.post(f"{base}/?_type=loginData&_tag=login_entry", data=login_data, timeout=12)
    resp.raise_for_status()
    return {"sess_token": sess_token}


def _logout_h388x(session: Any, host: str, sess_token: str) -> None:
    try:
        session.post(
            f"http://{host}/?_type=loginData&_tag=logout_entry",
            data={"IF_LogOff": "1", "_sessionTOKEN": sess_token},
            timeout=8,
        )
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(
        description="TIM Hub+ ZTE H388X: estrae INTERNET_ETH e STATUS LED VoIP in JSON."
    )
    parser.add_argument("--host", default=os.getenv("MODEM_HOST", "192.168.1.1"))
    parser.add_argument("--username", default=os.getenv("MODEM_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("MODEM_PASSWORD"))
    parser.add_argument(
        "--output-file",
        default=os.getenv("OUTPUT_FILE", r"C:\LOGIX\Python_prj\tim_hub_h388x_access3_output.json"),
    )
    args = parser.parse_args()

    if not args.password:
        print("Errore: specifica la password modem con --password o MODEM_PASSWORD.", file=sys.stderr)
        return 2

    requests = _require_requests()
    session = requests.Session()
    session.verify = False

    login_meta: Dict[str, Any] = {}
    internet_eth_data: Optional[Dict[str, str]] = None
    voip_data: Optional[Dict[str, str]] = None
    errors: List[str] = []

    try:
        login_meta = _login_h388x(session, args.host, args.username, args.password)
        wan_xml = session.get(
            f"http://{args.host}/?_type=menuData&_tag=wan_internet_lua.lua&TypeUplink=2&pageType=1",
            headers={"Cache-Control": "no-cache"},
            timeout=20,
        ).text
        instances = _to_instances(wan_xml, "ID_WAN_COMFIG")
        internet_eth_data = _pick_internet_eth(instances)
        voip_data = _pick_voip_instance(instances)
        if not internet_eth_data:
            errors.append("INTERNET_ETH non trovato in ID_WAN_COMFIG")
    except Exception as e:
        errors.append(str(e))
    finally:
        if login_meta.get("sess_token"):
            _logout_h388x(session, args.host, login_meta["sess_token"])
        session.close()

    status = _voip_led_status_from_instance(voip_data)
    if errors:
        status["errors"] = errors

    out = {
        "WAN_DATA": internet_eth_data if internet_eth_data else {},
        "STATUS": status,
        "generated_at": _utc_now_iso(),
        "host": args.host,
        "model_hint": "TIM Hub+ / ZTE H388X",
    }

    os.makedirs(os.path.dirname(args.output_file), exist_ok=True)
    with open(args.output_file, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"OK: salvato {args.output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

