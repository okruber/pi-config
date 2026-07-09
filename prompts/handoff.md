---
description: Spin off a handoff session without polluting this session's context
argument-hint: "<what to hand off>"
---
Hand off a spun-off session for: $@

Do this as a **clean dispatch** so this orchestrator session stays uncluttered.
Do NOT author the brief or run any `orca` commands inline in this session.

Instead, use the `subagent` / `pi-subagents` tool with **context: "fork"** so the
child inherits this session's context, and give it a task that follows the
`handoff` skill:

- Author a handoff brief for the tangent above, drawing the relevant
  Goal / Context / Acceptance from this session.
- Write the brief to the vault handoffs dir
  (`.../Oek Vault/Logs/handoffs/YYYY-MM-DD-<slug>.md`).
- Spawn the execution session via Orca (a worktree for isolated repo work, or a
  fresh session in the real checkout for live / global-config work per the
  skill's Rule 6a), seed it with the brief, and leave it propose-first unless
  told otherwise.
- Return ONLY a terse pointer: the created worktree/terminal handle, the brief
  path, and any vault writeback needed. It must not paste the full brief or
  transcript back.

When the subagent returns, surface that pointer to me and then continue whatever
we were doing here.
