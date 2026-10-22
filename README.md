# Moneytor

Personal finance tracker you use through an AI assistant. It runs a remote MCP server that Claude and Gemini connect to with OAuth, plus a small web app where people sign in, approve those connections, and the owner hands out invites. Data lives in MySQL and every account only sees its own.

## Requirements

- Node.js 22.12+ (the web app builds with Vite 8)
- MySQL 8 (5.7 may work but isn't tested)
- A public HTTPS address on your server
- A reverse proxy such as Nginx or Caddy on the same machine

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `MYSQL_*`: connection for the `moneytor` database.
- `PUBLIC_BASE_URL`: the public HTTPS address, e.g. `https://moneytor.example.com`. OAuth metadata and the MCP address (`<PUBLIC_BASE_URL>/mcp`) come from it.
- `SETUP_TOKEN`: a long random value used once to claim the owner account.
- `DEFAULT_CURRENCY`: e.g. `IDR`.
- `TRUST_PROXY`, `ALLOWED_CIDRS`: optional, see the comments in `.env.example`.

Create the database and user, then:

```bash
npm run migrate
npm run build      # server and web app
npm start
```

```sql
CREATE DATABASE moneytor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'moneytor'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON moneytor.* TO 'moneytor'@'localhost';
FLUSH PRIVILEGES;
```

## First run

1. Open `<PUBLIC_BASE_URL>/setup` and enter the `SETUP_TOKEN`, your email and a password. That claims the owner account; anything already recorded becomes yours.
2. Optionally remove `SETUP_TOKEN` from `.env` and restart. Setup stays closed once the owner has a password either way.
3. Invite people from **Invites & people**. Each code works once, for one account, until it expires. There's no open sign-up.

## Connecting an assistant

Both use the same address, `<PUBLIC_BASE_URL>/mcp`. The assistant registers itself (OAuth dynamic client registration), sends you to Moneytor to sign in, and asks you to approve. The approval screen shows the app's name and where it returns, and warns about addresses it doesn't recognize.

- **Claude**: Settings → Connectors → Add custom connector, paste the address.
- **Gemini**: on gemini.google.com, Settings → Connected Apps → Custom apps → Add a custom app, paste the address, leave Advanced features empty. As of October 2026 Google offers this only on personal Google accounts in the US, 18+, in English.

Requests to `/mcp` without a valid token get `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/mcp`, which is how clients find the sign-in flow.

## Tools

The MCP server exposes tools for transactions, categories, pay-period budgets and templates, accounts, transfers and reconciliation, and receivables (money fronted for others). See `src/mcp.ts` for the full list and descriptions.

## Nginx example

The whole site goes to the app: the web pages, `/api`, `/mcp`, and the OAuth endpoints (`/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/...`). Pass the client IP so login rate limits work.

```nginx
server {
  listen 443 ssl http2;
  server_name moneytor.example.com;

  ssl_certificate /etc/letsencrypt/live/moneytor.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/moneytor.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

An IP allowlist on `/mcp` (Claude connects from `160.79.104.0/21`) still works, but Google doesn't publish Gemini's addresses, so it blocks Gemini.

## systemd example

```ini
[Unit]
Description=Moneytor
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/moneytor
EnvironmentFile=/opt/moneytor/.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=always
RestartSec=5
User=moneytor
Group=moneytor

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now moneytor
```

## Development

```bash
npm run dev        # API and MCP server with reload
npm run dev:web    # web app on Vite, proxying /api to :3000
npm test           # needs the MYSQL_* variables of a scratch database
```
