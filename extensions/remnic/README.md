# Remnic for Pi Coding Agent

Remnic provides memory, retrieval, observation, MCP tools, and long-context compaction coordination for Pi Coding Agent.

## Installed Capabilities

- Recall relevant Remnic context in the `context` hook before agent turns.
- Observe user, assistant, and tool messages with `sourceFormat: "pi"`.
- Coordinate `session_before_compact` with Remnic LCM flush and checkpoint recording.
- Register Remnic MCP tools as host tools when daemon authentication is configured.
- Persist lightweight dedupe state in custom entries via `appendEntry`.

## Runtime

- Remnic daemon: `http://127.0.0.1:4318`
- Namespace: `default`
- Memory directory: `/Users/ollekruber/.remnic/memory`

The private `remnic.config.json` file stores the daemon URL, namespace, and connector auth token with owner-only permissions.
