# n8n HTTPS setup (Caddy)

Questa configurazione mette n8n dietro Caddy con TLS automatico.

## Prerequisiti

- Un dominio pubblico che punta all'IP del PC/server n8n (record A/AAAA).
- Porte 80 e 443 aperte verso il server.
- Docker e Docker Compose installati.

## Avvio

1. Copia il file `.env.example` in `.env`.
2. Imposta `N8N_DOMAIN` con il tuo dominio reale (es. `n8n.miodominio.it`).
3. Avvia:

```powershell
cd "C:\LOGIX\Cursor\Workspace\Supabase_Test1\n8n-https"
copy .env.example .env
notepad .env
docker compose up -d
```

4. Apri n8n su:

`https://<N8N_DOMAIN>`

## Aggiornare / riavviare

```powershell
cd "C:\LOGIX\Cursor\Workspace\Supabase_Test1\n8n-https"
docker compose pull
docker compose up -d
```

## Stop

```powershell
cd "C:\LOGIX\Cursor\Workspace\Supabase_Test1\n8n-https"
docker compose down
```
