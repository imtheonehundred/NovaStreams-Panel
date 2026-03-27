# Streaming authentication (Nginx vs Node)

## Current behavior

- **Node mode (`STREAMING_MODE=node` or unset):** Signed URLs are validated in Node for `/streams/:id/stream.ts`. HLS is read from the panel `streams/` directory by Node.
- **Nginx mode (`STREAMING_MODE=nginx`):** FFmpeg writes HLS segments and playlists to `IPTV_DISK_ROOT/hls/{id}/`; **Nginx serves `/hls/` from disk.** MPEG-TS is **not** stored on disk: FFmpeg sends TS to **stdout** (`pipe:1`), Node fans bytes out over HTTP, and **Nginx proxies `/live/` to Node** (`proxy_buffering off`). Query parameters (`token`, `expires`, `sig`) on `/live/*.ts` are **validated by Node** behind the proxy.

## Phase 2 (production hardening)

1. Issue **short-lived** tokens only via `/api/channels/:id/playback-url` (`PLAYBACK_TOKEN_TTL_SEC`, clamped **30–60s**, default **45s**).
2. Optionally add **Nginx `secure_link`** (or JWT validation in OpenResty) in front of `/hls/` for defense in depth (Node does not see raw segment requests for nginx-served HLS).
3. Optionally restrict `/hls/` to **internal** network or VPN.

## Environment variables

| Variable | Description |
|----------|-------------|
| `STREAMING_MODE` | `node` (default) or `nginx` |
| `IPTV_DISK_ROOT` | Absolute path; default `NEW PANEL/iptv-media` — used for **`hls/`** only in nginx mode (no `live/*.ts` on disk) |
| `PUBLIC_STREAM_BASE_URL` | e.g. `https://yourdomain.com` (no trailing slash) for signed playback URLs |
| `PLAYBACK_TOKEN_TTL_SEC` | TTL for nginx-mode signed URLs (clamped 30–60, default 45) |
| `PLAYBACK_TOKEN_TTL_LEGACY_SEC` | TTL for node-mode panel URLs (default 3600) |
| `FFMPEG_LIVE_ANALYZEDURATION` | Optional. Microseconds for live ingest analyze (default `500000` in code if unset). Lower = slightly faster probe, riskier on noisy sources. |
| `FFMPEG_LIVE_PROBESIZE` | Optional. Bytes for live ingest probe when set; overrides the channel **On Demand Probesize** field for **live** streams only. |
| `FFMPEG_MINIMAL_INGEST` | If `1` / `true` / `yes`, all live channels omit explicit `-analyzeduration`/`-probesize` on FFmpeg/ffprobe input (webapp v1 style). Per-channel **Minimal ingest** in Advanced overrides when unset globally. |
| `STREAM_INGEST_STYLE` | Defaults to **webapp** when unset (fast ingest). Set to `off`, `none`, `0`, `false`, or `no` to use the classic input lead. When **webapp**, same minimal-probe behavior as `FFMPEG_MINIMAL_INGEST`, plus low-delay demuxer flags (`+nobuffer`, `low_delay`) and `+genpts` **before** live read args (see `NEW PANEL/lib/ffmpeg-args.js`). Skipped when **Stability profile** is **Lag fix**. Does **not** force global `-re` on all live inputs (see non-goals below). |
| `ALLOW_ADMIN_PREVIEW_UNSIGNED_TS` | If `1` / `true` / `yes`, **same-origin** requests to `/streams/:id/stream.ts` or `/live/:id.ts` with a valid **panel login cookie** and **channel owner** session skip signed URL tokens (browser preview). **VLC does not send cookies** — for VLC on the **same machine** as the panel, use **`ALLOW_LOCAL_UNSIGNED_TS`** (below) or copy the **signed** URL from the player modal. |
| `ALLOW_LOCAL_UNSIGNED_TS` | If `1` / `true` / `yes`, MPEG-TS requests **without** a token are allowed when the **TCP client is loopback** (`127.0.0.1` / `::1` only — checked via `socket.remoteAddress`, not `X-Forwarded-For`). Lets **VLC** open a short URL like `http://127.0.0.1:3000/streams/{id}/stream.ts` on the same PC. **Do not rely on this for remote access** — use signed URLs. Intended for local dev / same-host testing. |
| `PREBUFFER_ENABLED` | **On by default** when unset. Set to `0`, `false`, `no`, or `off` to disable. When enabled, Node keeps an **in-memory ring** of recent MPEG-TS bytes per pipe channel and **replays** it to new clients before live bytes. See **MPEG-TS prebuffer** below. |
| `PREBUFFER_SIZE_MB` | Max ring size per channel (default **6**, clamped **0.5–16** MB). Rough RAM ≈ **PREBUFFER_SIZE_MB ×** number of **running MPEG-TS pipe** channels when prebuffer is on. |
| `PREBUFFER_ON_DEMAND_MIN_BYTES` | For **`on_demand`** channels only: wait until the ring holds at least this many bytes before attaching a new client (default **2 MiB**, capped by ring size). Set `0` to disable the wait. |
| `PREBUFFER_ON_DEMAND_MAX_WAIT_MS` | Max time to wait for `PREBUFFER_ON_DEMAND_MIN_BYTES` (default **3000**, clamped **100–60000** ms); then playback starts with whatever is buffered. |

### Fast preset (XC-style instant MPEG-TS)

When related env vars are **unset**, the panel uses: **`PREBUFFER_ENABLED` on** (opt out with `PREBUFFER_ENABLED=0`), **`PREBUFFER_SIZE_MB=6`**, **`PREBUFFER_ON_DEMAND_MIN_BYTES`** default **2 MiB** (capped by ring size), **`PREBUFFER_ON_DEMAND_MAX_WAIT_MS=3000`**, and **`STREAM_INGEST_STYLE`** → **webapp** ingest (set `STREAM_INGEST_STYLE=off` for the classic input lead).

**Admin UI:** Use **Settings → Streaming Performance** to persist tuning in the database (`streaming_*` keys in the `settings` table). When a key is set in the DB, it overrides the corresponding environment variable; per-channel overrides for prebuffer size and ingest style are in **Edit stream → Servers**.

- **RAM:** budget roughly **`PREBUFFER_SIZE_MB` ×** (number of **running** MPEG-TS **pipe** channels) for the in-memory rings, plus normal FFmpeg usage.
- **Keyframes:** the ring stores raw TS bytes and does **not** parse video; **IDR alignment is not guaranteed**. A larger ring improves the chance a recent keyframe is included; decoders usually recover quickly. Treat as **best-effort**, not a promise.
- **Security:** these defaults do **not** weaken signed URLs; remote clients still need valid tokens unless you explicitly enable loopback/admin preview flags below.

### Webapp v1 style (fast local preview)

For a setup that feels like the original `webapp/` panel (quick input open + simple URLs for in-panel testing):

1. **`STREAM_INGEST_STYLE`** defaults to **webapp** so FFmpeg uses the webapp-like input lead (minimal probe caps where applicable, low-delay demux flags before `-i` for live, no duplicate `+nobuffer` vs the classic `combinedFflags` path). Override with `STREAM_INGEST_STYLE=off` if needed.
2. Set **`ALLOW_ADMIN_PREVIEW_UNSIGNED_TS=1`** for **browser** preview without tokens (owner session + cookies), and/or **`ALLOW_LOCAL_UNSIGNED_TS=1`** so **VLC on the same machine** can use the token-free **`/streams/{id}/stream.ts`** URL (loopback clients only). The playback API returns a **short** `url` plus **`urlSigned`** when either flag is set; the panel shows both lines when they differ.
3. **New channels** default **Minimal ingest** to **on** in the panel (you can still turn it off per channel in Advanced).

When neither flag is set, or VLC runs on **another** device, use **`urlSigned`** or the signed `ts` field — short URLs will be rejected without a valid token.

**Non-goal:** Do not expect the panel to mirror legacy webapp’s “always `-re` on every live input” globally; that would fight Xtream-style live-edge behavior. A separate opt-in (e.g. per-channel **Native frames** / `read_native`) covers `-re` when you need it.

MPEG-TS channels always use FFmpeg **stdout** in Node (no opt-out).

### MPEG-TS prebuffer (XC-style instant attach)

When prebuffer is **enabled** (default on; disable with `PREBUFFER_ENABLED=0`), each FFmpeg stdout chunk is appended to a **ring buffer** (trimmed to `PREBUFFER_SIZE_MB`). New HTTP clients to `/streams/{id}/stream.ts` or `/live/{id}.ts` receive a **snapshot** of the current ring first, then join the live fan-out—so the first viewer does not only see bytes from attach time onward.

- **Copy mode / no re-encode:** Without demuxing, the server **cannot** guarantee an IDR at attach time. A larger ring makes a recent GOP more likely; decoders usually recover quickly. Worst case, behavior matches before (wait for next keyframe).
- **On-demand:** If **`PREBUFFER_ON_DEMAND_MIN_BYTES`** is greater than `0`, the handler **waits** (up to **`PREBUFFER_ON_DEMAND_MAX_WAIT_MS`**) for enough TS to accumulate after FFmpeg is running, then sends snapshot + live.
- **Restart:** The ring is **cleared** when a new FFmpeg process is spawned for the channel (avoids stale TS after reconnect).
- **Not used for HLS** (segments on disk are unchanged).

### TS vs HLS latency (VLC checklist)

**They are not interchangeable:** `outputFormat` is either **`mpegts`** (continuous TS from FFmpeg stdout — `/streams/{id}/stream.ts` or signed `/live/{id}.ts`) or **`hls`** (playlists + segments on disk — `.m3u8`). HLS **segment** files use the `.ts` extension on disk; that is **not** the same URL as **pipe** `stream.ts`.

- **`GET /api/channels/:id/playback-url`** returns **`outputFormat`** (`mpegts` | `hls`) and **`primaryKind`** (`ts` | `hls`) so clients know what the main **`url`** points to. In **nginx** mode the response may still include both `hls` and `ts` signed URLs for convenience; always prefer the field that matches **`outputFormat`** (or follow **`primaryKind`**).
- **VLC slow with `.m3u8`?** Buffered HLS ingest (`hlsIngestMode === buffered` + HLS input) **rewrites** media playlists to trail the live edge by **`hlsBufferDelaySec`** — that adds fixed delay before the first playable segment. For lowest delay tests, use **MPEG-TS output** or set ingest to **direct** / lower the buffer delay.
- **Fair comparison vs old `webapp/`:** Compare **MPEG-TS to MPEG-TS** (or HLS to HLS) and match **buffered vs direct**; otherwise latency differences are expected.

## Latency (Xtream-style input + players)

- **`-re`:** For **HTTP HLS / HTTP MPEG-TS** live inputs, FFmpeg is **not** given `-re` by default so it can read toward the live edge as fast as the network allows (same idea as Xtream “read native” off for HLS). Set the channel **`read_native`** to **true** if you need `-re` on HLS (e.g. file-like behavior). **RTMP** live still uses `-re`; **DASH** uses readrate options.
- **Native Frames (`read_native`):** New channels default to **off** for faster HLS startup. Turn **on** only when you need wall-clock sync on HLS input.
- **Existing channels (created before defaults changed):** If a stream still has **Native Frames** enabled in the UI, FFmpeg will keep using **`-re`** on HLS until you **edit the channel** and turn it **off**. There is no separate SQL column: channel options live in the channel JSON, so fix this **per stream** in **Live Streams → Edit → Advanced**, or via the API by setting `read_native: false`.
- **Output: TS vs HLS:** HLS output always waits for at least one segment (~`hls_time` seconds) before clients see video. For the lowest delay when testing (e.g. VLC), set the channel **output format to MPEG-TS** and open the **TS** playback URL (not the `.m3u8` playlist). Use HLS when you need adaptive delivery or players that only support HLS.
- **Nginx copy** (`STREAMING_MODE=nginx`, copy mode): FFmpeg uses **full `-c copy`** on both MPEG-TS and HLS outputs (no audio re-encode to AAC), so TS startup matches the Node copy path. **On Demand Probesize** defaults to **1.5MB**; live ingest applies a **2MB cap** on probe size unless `FFMPEG_LIVE_PROBESIZE` is set.
- **Minimal ingest:** Advanced stream option or `FFMPEG_MINIMAL_INGEST=1` skips forced probe limits for faster input open (similar to first-version `webapp/`); some sources may be less stable.
- **VLC:** **Preferences → Input / Codecs → Network caching** (try **0–300 ms** for local/low-latency tests). High caching adds perceived delay on top of server-side buffering.

## On-demand idle stop (HLS / Nginx)

- **Pre-warm (channel option):** In **Live Streams → Edit → Servers**, **Pre-warm** skips the **30s idle stop** for on-demand channels (Node TS close handler and HLS idle sweep). When **Pre-warm** is on and **On Demand** is **off**, the server may **start FFmpeg at boot** for that channel (subject to `MAX_FFMPEG_PROCESSES`). Use for channels you want always warm without manual Play.

- **Auto-start:** For channels with **On Demand** enabled, the **first authenticated playback** (panel/VLC signed URL, or Xtream line redirect) **starts FFmpeg automatically**; you do not need to press Play in the panel first. Optional: `ON_DEMAND_START_WAIT_MS` (default 120000) caps how long the server waits for the stream to become ready after start.
- **Node-served HLS:** last access is updated on each `.m3u8` / segment request.
- **Nginx-served HLS:** Node does not see segment hits; idle is extended when clients hit **`/api/channels/:id/playback-url`**, **Xtream live redirect**, or **Node-served** HLS routes (dev).
- **Nginx-served MPEG-TS (`/live/{id}.ts`):** Node sees each connection and updates idle for on-demand channels (same as redirect flow).
