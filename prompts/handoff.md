---
description: Spin off a visible Orca session for a tangent
argument-hint: "<what to hand off>"
---
Hand off a spun-off session for: $@

Follow the `handoff` skill:

- Author a handoff brief for the tangent above, drawing the relevant
  Goal / Context / Acceptance from this session.
- Write the brief to the vault handoffs dir
  (`.../Oek Vault/Logs/handoffs/YYYY-MM-DD-<slug>.md`).
- Spawn the execution session via Orca (a worktree for isolated repo work, or a
  fresh session in the real checkout for live / global-config work per the
  skill's Rule 6a), seed it with the brief, and set the approval mode per the
  skill's Rule 3a.

Then report a terse pointer: the created worktree/terminal handle, the brief
path, and any vault writeback needed. Do not paste the full brief back. Continue
whatever we were doing here.
