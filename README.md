# Moneytor MCP

Remote MCP server for tracking personal income and expenses from Claude.ai. It exposes tools to add, list, update, delete, and summarize transactions stored in MySQL.

## Requirements

- Node.js 20+
- MySQL 5.7+ or 8+
- Public HTTPS endpoint on your VPS
- Reverse proxy such as Nginx or Caddy

Claude.ai custom connectors need a reachable remote MCP endpoint. Local stdio MCP servers are for local clients, not Claude.ai web connectors.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- `MYSQL_*`: MySQL connection for the `moneytor` database.
- `DEFAULT_CURRENCY`: default transaction currency, for example `IDR`.
- `MCP_SECRET_SLUG`: long random path segment for the MCP URL.
- `ALLOWED_CIDRS`: optional app-level IP allowlist. Keep `127.0.0.1/32` while testing locally.

Create the database and user in MySQL, then run:

```bash
npm run migrate
npm run build
npm start
```

The MCP endpoint is:

```text
https://your-domain.example/mcp/<MCP_SECRET_SLUG>
```

Minimal MySQL bootstrap:

```sql
CREATE DATABASE moneytor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'moneytor'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON moneytor.* TO 'moneytor'@'localhost';
FLUSH PRIVILEGES;
```

## Tools

- `add_transaction`: records one `income` or `expense` using `DEFAULT_CURRENCY`.
- `list_transactions`: fetches rows by date range, type, category, account, tag, limit, and offset.
- `get_finance_summary`: returns totals and breakdowns by category, account, and day/month.
- `update_transaction`: corrects an existing transaction.
- `delete_transaction`: deletes a mistaken transaction by `id`.

## Nginx Example

Prefer enforcing the Anthropic allowlist at the reverse proxy. Keep your own IP temporarily while testing.

```nginx
server {
  listen 443 ssl http2;
  server_name moneytor.example.com;

  ssl_certificate /etc/letsencrypt/live/moneytor.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/moneytor.example.com/privkey.pem;

  location /mcp/ {
    allow 160.79.104.0/21;
    deny all;

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /health {
    proxy_pass http://127.0.0.1:3000;
  }
}
```

## systemd Example

```ini
[Unit]
Description=Moneytor MCP
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/moneytor
EnvironmentFile=/opt/moneytor/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=moneytor
Group=moneytor

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now moneytor-mcp
sudo systemctl status moneytor-mcp
```

## Claude.ai Connector

In Claude.ai, add a custom connector with:

- Name: `Moneytor`
- URL: `https://your-domain.example/mcp/<MCP_SECRET_SLUG>`
- Authentication: no authentication

This project uses an authless connector because Claude.ai custom connectors do not support pasted static bearer tokens. Security comes from HTTPS, the secret endpoint path, and reverse-proxy IP allowlisting.
