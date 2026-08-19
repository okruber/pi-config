# btw

A side channel for questions and handoffs that never enters the main session's LLM context.

## Commands

| Command | What it does |
|---|---|
| `/btw <question>` | Ask a side question in a sub-session with `read`/`bash`/`edit`/`write` access. |
| `/btw:handoff <what needs doing>` | Draft a handoff brief, wait for approval, then dispatch a visible Orca session. |
| `/btw:inject [instructions]` | Send the side thread to the main agent as one user message. |
| `/btw:summarize [instructions]` | Summarize the side thread and send the summary instead. |
| `/btw:clear` | Clear the thread and dismiss the overlay. |

`Alt+/` (or `Ctrl+Alt+W`) toggles focus between the overlay and the main editor. `Esc` dismisses.

## Why the seeding looks the way it does

The side session gets main's system prompt verbatim and appends nothing to it, so its
prefix matches main's byte for byte and reuses the same provider cache entry. Stripping
the system prompt footer or appending a side-session prompt would force a full cache
write on every side thread. `side-session.test.ts` guards this.

Side turns persist through `pi.appendEntry()`, which does not participate in LLM context.
Never switch this to `pi.sendMessage()`, which does.

## Tests

```bash
cd extensions/btw && npm test
```

## Spec and plan

- `docs/superpowers/specs/2026-08-19-btw-side-channel-design.md`
- `docs/superpowers/plans/2026-08-19-btw-side-channel.md`
