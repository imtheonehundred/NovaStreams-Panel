# Live Runtime Ownership

## Authoritative Owner

**`server.js` is the authoritative owner of the local live runtime lifecycle.**

All live channel FFmpeg processes are started and stopped through functions in `server.js`:

- `startChannel(channelId)` - Starts FFmpeg process for a live channel
- `stopChannel(channelId)` - Stop FFmpeg process for a live channel
- `restartChannel(channelId)` - Restarts a channel's FFmpeg process

These functions directly manage FFmpeg processes via `child_process.spawn()`, track process state in memory, and update the `channels` map.

## `services/streamManager.js` - Secondary Role

`services/streamManager.js` provides **read-only status tracking** and helper functions, but does not own the live runtime:

- `getChannelStatus(channelId)` - Returns status info (running, process ID, etc.)
- `getAllChannelStatus()` - Returns status for all channels
- `isChannelRunning(channelId)` - Boolean check if channel is active

This module reads state but does not start/stop FFmpeg processes.

## Runtime State Management

| Component | Owner | Responsibility |
|-----------|--------|---------------|
| FFmpeg process lifecycle | `server.js` | Start, stop, restart processes |
| Process tracking in memory | `server.js` | `channels` map, `channelProcesses` map |
| Status queries | `services/streamManager.js` | Read status for display/monitoring |
| Runtime metrics | `server.js` + `services/streamManager.js` | CPU, memory, uptime stats |

## Remote Runtime (Future Scope)

**Remote live runtime start/stop is NOT implemented.**

The codebase has:
- Server inventory (`streaming_servers` table)
- Server selection (`services/serverService::selectServer()`)
- Heartbeat ingestion
- Placement tables (`stream_server_placement`, `line_runtime_sessions`)

But remote FFmpeg execution control is de-scoped. Live channels run only on the panel node via `server.js`.

## Rules for Future Live Runtime Work

1. **Never add new FFmpeg process management logic outside `server.js` without explicit migration.**
2. **Keep `services/streamManager.js` as a read-only status accessor.**
3. **Any future remote runtime work must explicitly address ownership transition.**
4. **Before extracting live runtime logic, first stabilize the current `server.js` contract.**

## Migration Path for Distributed Live Runtime (If Needed)

If remote live orchestration becomes a requirement:

1. Define a clear ownership contract (interface)
2. Implement local adapter (wraps current `server.js` behavior)
3. Implement remote adapter (SSH/command-queue-based)
4. Extract to service layer with clear boundaries
5. Update `server.js` to delegate to the service

**This migration has NOT been done.** Current reality: local-only live runtime owned by `server.js`.

---

*Last Updated: 2026-04-01*
