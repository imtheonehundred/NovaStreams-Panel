# Load balancer and multi-server operations

This panel stores **streaming servers** (roles: `main`, `lb`, `edge`) in MariaDB. Clients should use **public hostnames** that point at your **Nginx (or similar) load balancer**, not at the database host. The panel Node process does not proxy video traffic in typical deployments.

## DNS and URLs

1. Create **Servers** entries in the panel: set **public host** for the LB hostname (e.g. `lb.example.com`) and **public/private IP** for origins.
2. **Settings → General → Default stream server ID**: optional numeric `streaming_servers.id` to use when a line has no `force_server_id`. If `0`, the panel picks the first enabled **load balancer**, then **main**.
3. **Per-line** `force_server_id` in the database forces that server row for M3U and stream base URLs for that subscriber line.
4. Optional env **`PUBLIC_STREAM_BASE_URL`** still overrides stream base URL resolution when set (same behavior as before).

## M3U / Xtream playlist

- `get.php` builds stream URLs with `resolvePlaylistBaseUrl`: `force_server_id` → `default_stream_server_id` → first enabled `lb` → `main` → request host.
- Server `meta_json` may include:
  - `public_base_url` — full base URL override for that server row.
  - `https` — use `https` instead of `http` when building from `public_host`.
  - `port` — non-default port for `public_host`.
  - `upstream_port` — used in Nginx export for `server ip:port` lines.

## Nginx upstream export

- **Servers → Export Nginx upstream** copies a snippet with `upstream panel_stream_origins { least_conn; server … }` from enabled **edge** and **main** rows using `private_ip` or `public_ip` and `meta_json.upstream_port` (default 80).
- Paste the snippet on the **LB** host and `proxy_pass` to `http://panel_stream_origins` for your stream locations.

## Remote agent

- Set **`AGENT_SECRET`** on the panel (same value on each agent).
- Agents run `NEW PANEL/agent/` with `SERVER_ID`, `PANEL_URL`, `AGENT_SECRET` and POST signed JSON to `/api/agent/heartbeat`.
- Signature: hex **HMAC-SHA256** of a canonical JSON string with keys in this order: `server_id`, `ts`, `cpu`, `mem`, `net_mbps`, `ping_ms`, `version` — header **`X-Agent-Signature`**.

## SSH provisioning (optional)

- Set **`ENABLE_SERVER_PROVISIONING=1`** on the panel (master switch), then enable **Settings → Streaming → Enable Server Provisioning** so `streaming_provisioning_enabled` is stored in the DB.
- Use **Servers → Install** tab with SSH credentials; passwords are never stored in the DB; jobs are logged in `server_provisioning_jobs` and panel logs.
- Set **`PROVISIONING_SECRET`** for audit encryption helpers.
