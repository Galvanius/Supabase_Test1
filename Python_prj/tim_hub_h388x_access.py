#!/usr/bin/env python3
"""
Accesso programmatico al TIM Hub+ (ZTE H388X) via interfaccia HTTP interna.

Flusso (come da firmware TIM / integrazione community ha_zteh388x):
  1) GET  /?_type=loginData&_tag=login_entry  -> JSON con sess_token
  2) GET  /?_type=loginData&_tag=login_token  -> XML con salt
  3) password_hash = sha256(password + salt).hexdigest()
  4) POST /?_type=loginData&_tag=login_entry con Username, Password, _sessionTOKEN, action=login

Per FTTH con ONT esterno la linea WAN lato router e' tipicamente Ethernet:
  usa --linetype eth (default).

Requisiti:
  pip install requests

Uso:
  python tim_hub_h388x_access.py --host 192.168.1.1 --password "LA_TUA_PASSWORD" wan-status
  python tim_hub_h388x_access.py --host 192.168.1.1 --password "LA_TUA_PASSWORD" internet-eth
  python tim_hub_h388x_access.py --host 192.168.1.1 --password-from-env TIM_HUB_PASSWORD dump-raw

Variabili ambiente (opzionali):
  TIM_HUB_HOST, TIM_HUB_USER, TIM_HUB_PASSWORD, TIM_HUB_LINETYPE (eth|dsl), TIM_HUB_USE_HTTPS (0|1)

Nota: una sola sessione admin attiva; script ripetuti possono disconnettere la GUI web aperta nel browser.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Optional

# Profilo GUI "INTERNET_ETH" (TIM Hub+ / ha_zteh388x): solitamente _InstID ~ _IGD.WD2.WCD1.WCPPP1_
# (WAN Ethernet PPPoE). WD2 = porta ETH, WCPPP1 = canale PPP principale Internet.
_INTERNET_ETH_ID_MARKERS = ("wd2", "wcd1", "wcppp1")

import urllib3

try:
    import requests
except ImportError:
    print("Installa: pip install requests", file=sys.stderr)
    raise SystemExit(1) from None

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


@dataclass
class LoginResult:
    sess_token: str
    password_hash: str


class TimHubH388XClient:
    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        *,
        use_https: bool = False,
        timeout: float = 10.0,
    ) -> None:
        self._host = host.rstrip("/")
        self._username = username
        self._password = password
        scheme = "https" if use_https else "http"
        self._base = f"{scheme}://{self._host}"
        self._timeout = timeout
        self.session = requests.Session()
        self.session.verify = False
        self.sess_token: Optional[str] = None

    def _url(self, query: str) -> str:
        return f"{self._base}/?{query.lstrip('?')}"

    def prelogin(self) -> LoginResult:
        r = self.session.get(self._base + "/", timeout=self._timeout)
        r.raise_for_status()

        r = self.session.get(self._url("_type=loginData&_tag=login_entry"), timeout=self._timeout)
        r.raise_for_status()
        data = r.json()
        sess_token = data.get("sess_token")
        if not sess_token:
            raise RuntimeError(f"sess_token mancante nella risposta: {data!r}")

        r = self.session.get(self._url("_type=loginData&_tag=login_token"), timeout=self._timeout)
        r.raise_for_status()
        root = ET.fromstring(r.text)
        salt = (root.text or "").strip()
        if not salt:
            raise RuntimeError(f"salt vuoto nel login_token XML: {r.text[:500]!r}")

        pwd_hash = hashlib.sha256(f"{self._password}{salt}".encode()).hexdigest()
        return LoginResult(sess_token=sess_token, password_hash=pwd_hash)

    def login(self) -> None:
        pre = self.prelogin()
        self.sess_token = pre.sess_token
        payload = {
            "Password": pre.password_hash,
            "Username": self._username,
            "_sessionTOKEN": pre.sess_token,
            "action": "login",
        }
        r = self.session.post(
            self._url("_type=loginData&_tag=login_entry"),
            data=payload,
            timeout=self._timeout,
        )
        r.raise_for_status()
        # Cookie SID tipicamente impostato dalla risposta
        if not self.session.cookies.get("SID"):
            print("Avviso: cookie SID non trovato dopo login; la sessione potrebbe non essere valida.", file=sys.stderr)

    def logout(self) -> None:
        sid = self.session.cookies.get("SID")
        if not sid or not self.sess_token:
            self.session.close()
            return
        headers = {"Cookie": f"SID={sid}"}
        data = {"IF_LogOff": "1", "_sessionTOKEN": self.sess_token}
        try:
            self.session.post(
                self._url("_type=loginData&_tag=logout_entry"),
                headers=headers,
                data=data,
                timeout=self._timeout,
            )
        finally:
            self.session.cookies.clear()
            self.session.close()

    def fetch_wan_eth(self) -> tuple[str, str]:
        """FTTH / Ethernet WAN: statistiche linea + stato internet."""
        init = self._url("_type=menuView&_tag=ethWanStatus")
        line = self._url("_type=menuData&_tag=eth_interface_status_lua.lua")
        inet = self._url("_type=menuData&_tag=wan_internet_lua.lua&TypeUplink=2&pageType=1")
        h = {"Cache-Control": "no-cache"}
        self.session.get(init, headers=h, timeout=self._timeout).raise_for_status()
        r_line = self.session.get(line, headers=h, timeout=self._timeout)
        r_line.raise_for_status()
        r_inet = self.session.get(inet, headers=h, timeout=self._timeout)
        r_inet.raise_for_status()
        return r_line.text, r_inet.text

    def fetch_wan_dsl(self) -> tuple[str, str]:
        """xDSL: statistiche DSL + stato internet."""
        init = self._url("_type=menuView&_tag=dslWanStatus")
        line = self._url("_type=menuData&_tag=dsl_interface_status_lua.lua")
        inet = self._url("_type=menuData&_tag=wan_internet_lua.lua&TypeUplink=1&pageType=1")
        h = {"Cache-Control": "no-cache"}
        self.session.get(init, headers=h, timeout=self._timeout).raise_for_status()
        r_line = self.session.get(line, headers=h, timeout=self._timeout)
        r_line.raise_for_status()
        r_inet = self.session.get(inet, headers=h, timeout=self._timeout)
        r_inet.raise_for_status()
        return r_line.text, r_inet.text


def _parse_instances(xml_text: str, root_tag: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    try:
        tree = ET.fromstring(xml_text)
    except ET.ParseError as e:
        return [{"_error": str(e), "_raw_preview": xml_text[:400]}]
    for inst in tree.findall(f".//{root_tag}/Instance"):
        row: dict[str, str] = {}
        names = inst.findall("ParaName")
        values = inst.findall("ParaValue")
        if len(names) != len(values):
            continue
        for pn, pv in zip(names, values):
            if pn.text:
                row[pn.text] = (pv.text or "")
        out.append(row)
    return out


def _norm_inst_path(inst_id: str) -> str:
    return inst_id.replace("_", ".").strip(".").lower()


def _row_is_internet_eth(row: dict[str, str]) -> bool:
    """Riconosce la connessione INTERNET_ETH dal _InstID o da campi testuali noti."""
    inst = (row.get("_InstID") or row.get("InstID") or "").strip()
    if inst:
        n = _norm_inst_path(inst)
        if all(m in n for m in _INTERNET_ETH_ID_MARKERS):
            return True
    for key in (
        "WANCName",
        "WANName",
        "WANCConnectionName",
        "Alias",
        "Description",
        "Name",
    ):
        v = (row.get(key) or "").strip().upper()
        if v == "INTERNET_ETH" or "INTERNET_ETH" in v:
            return True
    return False


def _filter_internet_eth_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [dict(r) for r in rows if _row_is_internet_eth(r)]


def _parse_seconds_loose(raw: str) -> Optional[float]:
    s = raw.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _uptime_dhms_from_seconds(seconds: Optional[float]) -> dict[str, Any]:
    if seconds is None or seconds < 0:
        return {
            "days": None,
            "hours": None,
            "minutes": None,
            "seconds": None,
            "formatted": None,
        }
    sec_i = int(seconds)
    d, rest = divmod(sec_i, 86400)
    h, rest = divmod(rest, 3600)
    m, s = divmod(rest, 60)
    formatted = f"{d} giorni {h} ore {m} minuti {s} secondi"
    return {
        "days": d,
        "hours": h,
        "minutes": m,
        "seconds": s,
        "formatted": formatted,
    }


def _iter_row_keys_matching(row: dict[str, str], must_contain: tuple[str, ...]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for k, v in row.items():
        lk = k.lower()
        if any(tok in lk for tok in must_contain):
            out.append((k, v))
    return out


def _connection_active_from_value(val: Optional[str]) -> tuple[Optional[bool], str]:
    """Interpreta stato logico WAN da stringhe tipiche modem ZTE."""
    if val is None:
        return None, ""
    s = str(val).strip()
    if not s:
        return None, ""
    lower = s.lower()
    if "disconn" in lower or lower in {"down", "offline", "no", "inactive", "0", "false", "idle"}:
        return False, s
    if lower in {"1", "true", "up", "online", "connected", "connesso"}:
        return True, s
    if "connected" in lower or "connesso" in lower:
        return True, s
    if lower.startswith("establish") or "online" in lower:
        return True, s
    if "fail" in lower or "error" in lower:
        return False, s
    return None, s


def _select_eth_wan_port_row(eth_lines: list[dict[str, str]]) -> Optional[dict[str, str]]:
    """Preferisce la porta ETH WAN TIM (solitamente _IGD.WD2.ETH1_)."""
    for r in eth_lines:
        inst = _norm_inst_path(r.get("_InstID") or r.get("InstID") or "")
        if "wd2" in inst and "eth" in inst:
            return r
    return eth_lines[0] if eth_lines else None


def build_wan_status(
    internet_eth_rows: list[dict[str, str]],
    eth_line_rows: Optional[list[dict[str, str]]] = None,
) -> dict[str, Any]:
    """
    Oggetto per la chiave JSON WAN_STATUS: tempo_connessione (g/h/m/s + testuale),
    connessione_attiva, velocita (riepilogo + campi).
    Fonti: INTERNET_ETH + porta ETH WAN verso ONT.
    """
    eth_lines = eth_line_rows or []
    eth_wan = _select_eth_wan_port_row(eth_lines)
    main = dict(internet_eth_rows[0]) if internet_eth_rows else {}

    # Uptime sessione WAN (modem espone tipicamente secondi nel campo Uptime*)
    uptime_sec: Optional[float] = None
    for k, v in main.items():
        lk = k.lower()
        if "uptime" in lk and "lease" not in lk and "remain" not in lk:
            p = _parse_seconds_loose(v)
            if p is not None:
                uptime_sec = p
                break

    conn_active: Optional[bool] = None
    for kk, vv in main.items():
        lk = kk.lower()
        if any(
            t in lk
            for t in (
                "connstatus",
                "connectionstatus",
                "connstate",
                "wanstatus",
                "opstatus",
            )
        ):
            a, _raw = _connection_active_from_value(vv)
            if a is not None and conn_active is None:
                conn_active = a

    speed_fields: dict[str, str] = {}
    summary_bits: list[str] = []

    for row, label in ((main, "INTERNET_ETH"), (eth_wan or {}, "ETH_WAN")):
        if not row:
            continue
        for kk, vv in _iter_row_keys_matching(
            row,
            (
                "linkspeed",
                "maxbitrate",
                "bitrate",
                "downstream",
                "upstream",
                "txrate",
                "rxrate",
                "curbitrate",
                "wanrate",
            ),
        ):
            if not vv.strip():
                continue
            alias = f"{label}.{kk}"
            speed_fields[alias] = vv
            lk = kk.lower()
            if any(
                x in lk for x in ("linkspeed", "bitrate", "downstream", "upstream", "rxrate", "txrate")
            ):
                summary_bits.append(f"{label}.{kk}={vv}")

    if eth_wan:
        for kk, vv in eth_wan.items():
            if "linkspeed" in kk.lower() and str(vv).strip():
                speed_fields.setdefault(f"ETH_WAN.{kk}", vv)
                summary_bits.append(f"ETH_WAN {kk}={vv}")
            if any(x in kk.lower() for x in ("status", "link")):
                alias = f"ETH_WAN.{kk}"
                if alias not in speed_fields:
                    speed_fields[alias] = vv
                a, _raw = _connection_active_from_value(vv)
                if conn_active is None and a is not None and "link" in kk.lower():
                    conn_active = a

    if not summary_bits:
        by_label = [(k, v) for k, v in speed_fields.items()]
        pref = [
            kv
            for kv in by_label
            if any(y in kv[0].lower() for y in ("downstream", "upstream", "linkspeed"))
        ]
        if pref:
            summary_bits.append("; ".join(f"{k}={v}" for k, v in pref[:6]))
        elif by_label:
            summary_bits.append("; ".join(f"{k}={v}" for k, v in by_label[:6]))

    dh = _uptime_dhms_from_seconds(uptime_sec)
    return {
        "tempo_connessione": {
            "giorni": dh["days"],
            "ore": dh["hours"],
            "minuti": dh["minutes"],
            "secondi": dh["seconds"],
            "secondi_totali": uptime_sec,
            "testuale": dh["formatted"],
        },
        "connessione_attiva": conn_active,
        "velocita": {
            "riepilogo": " | ".join(summary_bits) if summary_bits else None,
            "campi": speed_fields if speed_fields else None,
        },
    }


def cmd_wan_status(client: TimHubH388XClient, linetype: str) -> int:
    client.login()
    try:
        if linetype == "eth":
            line_xml, inet_xml = client.fetch_wan_eth()
            line_root, inet_root = "OBJ_ETH_ID", "ID_WAN_COMFIG"
        elif linetype == "dsl":
            line_xml, inet_xml = client.fetch_wan_dsl()
            line_root, inet_root = "OBJ_DSLINTERFACE_ID", "ID_WAN_COMFIG"
        else:
            print("linetype deve essere eth o dsl", file=sys.stderr)
            return 2

        wan_rows = _parse_instances(inet_xml, inet_root)
        internet_eth_rows = _filter_internet_eth_rows(wan_rows)
        eth_iface = _parse_instances(line_xml, line_root)
        summary: dict[str, Any] = {
            "line_type": linetype,
            "eth_or_dsl_interface": eth_iface,
            "wan_internet_all": wan_rows,
            "internet_eth": internet_eth_rows,
            "WAN_STATUS": build_wan_status(internet_eth_rows, eth_iface),
            "internet_eth_note": (
                "Profilo GUI INTERNET_ETH (es. _IGD.WD2.WCD1.WCPPP1_). "
                "Lista: tutti i parametri restituiti dal modem per quella connessione."
            ),
        }
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0
    finally:
        client.logout()


def cmd_internet_eth(client: TimHubH388XClient, linetype: str) -> int:
    """Solo connessione INTERNET_ETH: tutti i campi disponibili dal menu WAN."""
    if linetype != "eth":
        print(
            "INTERNET_ETH e' tipico della WAN Ethernet/FTTH; usa --linetype eth (default).",
            file=sys.stderr,
        )
    client.login()
    try:
        if linetype == "eth":
            line_xml, inet_xml = client.fetch_wan_eth()
            line_root, inet_root = "OBJ_ETH_ID", "ID_WAN_COMFIG"
        elif linetype == "dsl":
            line_xml, inet_xml = client.fetch_wan_dsl()
            line_root, inet_root = "OBJ_DSLINTERFACE_ID", "ID_WAN_COMFIG"
        else:
            print("linetype deve essere eth o dsl", file=sys.stderr)
            return 2

        wan_rows = _parse_instances(inet_xml, inet_root)
        internet_eth_rows = _filter_internet_eth_rows(wan_rows)
        eth_iface = _parse_instances(line_xml, line_root)
        out: dict[str, Any] = {
            "profile": "INTERNET_ETH",
            "matches": len(internet_eth_rows),
            "instances": internet_eth_rows,
            "ethernet_line_summary": eth_iface,
            "WAN_STATUS": build_wan_status(internet_eth_rows, eth_iface),
        }
        if not internet_eth_rows:
            out["warning"] = (
                "Nessuna istanza riconosciuta come INTERNET_ETH. "
                "Controlla wan_internet_all con 'wan-status' o invia dump-raw: "
                "il _InstID sul tuo firmware potrebbe differire (es. WD3 se usi solo SFP)."
            )
            out["wan_internet_all_instids"] = [
                r.get("_InstID") or r.get("InstID") or "?" for r in wan_rows
            ]
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0
    finally:
        client.logout()


def cmd_dump_raw(client: TimHubH388XClient, linetype: str) -> int:
    client.login()
    try:
        if linetype == "eth":
            line_xml, inet_xml = client.fetch_wan_eth()
        elif linetype == "dsl":
            line_xml, inet_xml = client.fetch_wan_dsl()
        else:
            print("linetype deve essere eth o dsl", file=sys.stderr)
            return 2
        print("=== eth_interface_status / dsl_interface_status ===\n")
        print(line_xml)
        print("\n=== wan_internet ===\n")
        print(inet_xml)
        return 0
    finally:
        client.logout()


def cmd_login_only(client: TimHubH388XClient) -> int:
    client.login()
    try:
        sid = client.session.cookies.get("SID")
        print(json.dumps({"ok": True, "sid_present": bool(sid)}, indent=2))
        return 0
    finally:
        client.logout()


def main() -> int:
    p = argparse.ArgumentParser(description="TIM Hub+ ZTE H388X - accesso HTTP (LAN)")
    p.add_argument("--host", default=os.environ.get("TIM_HUB_HOST", "192.168.1.1"))
    p.add_argument("--user", default=os.environ.get("TIM_HUB_USER", "admin"))
    p.add_argument("--password", default=os.environ.get("TIM_HUB_PASSWORD", ""))
    p.add_argument(
        "--password-from-env",
        metavar="VAR",
        help="Legge la password dalla variabile d'ambiente indicata (es. TIM_HUB_PASSWORD)",
    )
    p.add_argument(
        "--linetype",
        choices=("eth", "dsl"),
        default=os.environ.get("TIM_HUB_LINETYPE", "eth"),
        help="eth = FTTH con ONT/SFP o WAN Ethernet; dsl = ADSL/VDSL",
    )
    p.add_argument(
        "--https",
        action="store_true",
        default=os.environ.get("TIM_HUB_USE_HTTPS", "").strip() in ("1", "true", "yes"),
    )
    p.add_argument(
        "command",
        choices=("login-test", "wan-status", "internet-eth", "dump-raw"),
        help="login-test | wan-status | internet-eth (solo INTERNET_ETH, tutti i campi) | dump-raw",
    )
    args = p.parse_args()

    password = args.password
    if args.password_from_env:
        password = os.environ.get(args.password_from_env, "")
    if not password:
        print("Specifica --password o --password-from-env o TIM_HUB_PASSWORD", file=sys.stderr)
        return 2

    client = TimHubH388XClient(
        args.host,
        args.user,
        password,
        use_https=args.https,
    )

    if args.command == "login-test":
        return cmd_login_only(client)
    if args.command == "wan-status":
        return cmd_wan_status(client, args.linetype)
    if args.command == "internet-eth":
        return cmd_internet_eth(client, args.linetype)
    if args.command == "dump-raw":
        return cmd_dump_raw(client, args.linetype)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
