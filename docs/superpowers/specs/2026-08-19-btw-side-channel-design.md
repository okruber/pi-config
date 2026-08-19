# /btw: a non-polluting side channel for questions and handoffs

Date: 2026-08-19
Status: approved (pending implementation plan)
Owning repo: `okruber/pi-config`
Target files: `extensions/btw/` (new directory)
Also touches: `~/.agents/skills/handoff/SKILL.md` (repo `okruber/skills`)

## Problem

After the agent finishes a turn, two things regularly come up that do not belong
in the main conversation:

1. **A side question.** Something needs answering before the next instruction can
   be written. Asking it in the main thread burns context on a detour and leaves
   the answer sitting in the prefix for the rest of the session.
2. **A side action.** A piece of work should be dispatched through the `handoff`
   skill to a visible Orca session. Authoring the brief inline pollutes the main
   thread with brief-drafting chatter that has nothing to do with the main task.

Both need a channel that has the main session's context, can use tools, and never
adds to the main session's LLM context.

## Goals

1. `/btw <question>` answers a side question in a sub-session that inherits main's
   context and has tool access, without touching main's LLM context.
2. `/btw:handoff <what needs doing>` drafts a handoff brief, gets approval, and
   spawns the Orca session, all in the same side channel.
3. Both work while the main agent is still running.
4. The main session's prompt cache survives. A side question must not force main
   to rewrite its cached prefix.
5. Anything from the side thread reaches main only through an explicit
   `/btw:inject` or `/btw:summarize`.

## Non-goals

- No automatic injection of side-thread content into main, on close or otherwise.
- No BTW-only model or thinking overrides. The side session inherits main's model.
- No contextless tangent mode, no session-tree context picker, no menu UI, no
  `--save` visible notes. All exist in the reference implementations and none
  serve the two use cases above.
- Not a replacement for the executor. `/btw:handoff` spawns a visible Orca
  session and stops. It never does the work itself.

## Prior art

Three existing implementations were reviewed. None is adopted wholesale; the
design borrows from the first.

| Implementation | Shape | Why not adopted |
|---|---|---|
| `dbachelder/pi-btw` | Real sub-session with tools, modal overlay, hidden entries, inject/summarize. ~2.3k lines, one file. | Closest fit and the model for this design, but carries model/thinking overrides, tangent mode, and `--save`, and its seeding breaks cache alignment (see below). |
| `juicesharp/rpiv-btw` | Stateless completion per question, no tools, process-scoped. | No tools means a side question cannot grep to answer itself, and a handoff cannot run `orca`. |
| `narumiruna/pi-btw` | Full-screen UI, menu, tree-based context picker, resumable threads. ~4k lines. | Suspends main rendering, and most of its surface is UI features that are out of scope. |

## Architecture

New directory `extensions/btw/`, following the `extensions/ask-user-question/`
precedent of a package directory rather than a loose `.ts` file.

| Module | Responsibility |
|---|---|
| `index.ts` | Registers the commands. Owns nothing else. |
| `side-session.ts` | Sub-session lifecycle: create, seed, prompt, dispose. The only module that calls `createAgentSession`. |
| `thread.ts` | Thread state and persistence via `pi.appendEntry()`, plus rehydration on `session_start`. |
| `overlay.ts` | The modal: transcript, composer, focus toggle, status line. |
| `handoff.ts` | Handoff framing, brief path resolution, Orca binary resolution and dispatch. |

The side session gets the standard tool set (`read`, `bash`, `edit`, `write`,
`grep`). Case 1 needs to grep to answer itself; case 2 needs to write a brief and
run `orca`.

## Cache-aligned seeding

This is the rule `side-session.ts` exists to enforce, and the one thing that
silently regresses.

The side session is seeded with:

1. Main's system prompt **verbatim** from `ctx.getSystemPrompt()`. No footer
   stripping, no `getAppendSystemPrompt()`.
2. The cloned branch messages from
   `buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())`.
3. The BTW framing as a **trailing user message**.

Everything before that trailing message is byte-identical to what main last sent.
Anthropic prompt caching is keyed on content prefix rather than session identity,
so the side session should hit the cache entry main already created instead of
paying to write a new one.

`dbachelder/pi-btw` does the opposite in two ways worth naming, because both look
harmless: it strips the dynamic `Current date and time:` / `Current working
directory:` footer from the system prompt, and it appends a BTW system prompt via
`getAppendSystemPrompt()`. Either alone makes the system block diverge at the
first token, so the whole context is re-written to cache on every new side thread.

**Open item to verify before building on this.** If pi rebuilds the system
prompt's date/time footer on every turn rather than stamping it once per session,
then main already invalidates its own cache each turn and this alignment buys
nothing. The `token-speed` extension surfaces cache hit rate, so a two-minute
observation settles it. If the footer does rebuild per turn, drop the alignment
rule and let the side session strip the footer for cleanliness instead.

### Context persistence and cache

`pi.sendMessage()` custom messages **do** participate in LLM context
(`docs/extensions.md:1391`). Using them for side-thread state would grow main's
prefix and cost a cache write per side question.

`pi.appendEntry()` persists to the session file and does **not** participate in
LLM context (`docs/extensions.md:1444`). Side turns therefore survive `/reload`
and `/resume` while remaining invisible to the model. Persistence and cache safety
are not in tension.

## Commands

| Command | Behavior |
|---|---|
| `/btw <question>` | Opens or reuses the side thread, asks the question, streams into the overlay. |
| `/btw:handoff <what needs doing>` | Same thread and overlay, handoff framing. Drafts a brief, waits for approval, dispatches. |
| `/btw:inject [instructions]` | Sends the side thread to main as a user message. Queues as a follow-up if main is busy. |
| `/btw:summarize [instructions]` | Summarizes the side thread and injects the summary instead of the full thread. |
| `/btw:clear` | Dismisses the overlay and clears the thread. |

`/btw:handoff` continues the current side thread when one is open, and starts a
fresh one otherwise. This keeps the command boundary explicit while letting "ask a
question, realize it is actually a job, dispatch it" work without retyping context.

## Handoff flow

`/btw:handoff` differs from `/btw` in three deterministic ways.

**Skill by reference, not by value.** The framing points the side session at the
absolute path `~/.agents/skills/handoff/SKILL.md` and lets it `read` the file.
Inlining the skill text would add roughly 4k uncached tokens to every dispatch; a
read call costs one round trip and caches normally.

**Orca resolution is done for it.** The `handoff` skill devotes a paragraph to the
fact that `command -v orca` lies, because the `/usr/local/bin/orca` shim is
frequently a dangling AppTranslocation symlink while Orca is installed and
running. `handoff.ts` resolves the working binary itself (probe the shim, fall
back to `/Applications/Orca.app/Contents/Resources/bin/orca`, confirm with
`orca status --json`) and passes the resolved path into the framing. The failure
mode is deleted rather than documented.

**Propose-first is the thread, not a widget.** The side session drafts the brief,
writes it to `Logs/handoffs/YYYY-MM-DD-<slug>.md` in the vault, and renders it in
the overlay. Approval is an affirmative reply in the overlay composer, judged by the
side session in the normal way. There is no literal string match on "go" and no
approval keybinding. Revisions are just more turns.

The side session runs in main's cwd. It only spawns the executor, and per the
skill's Rule 3 the executor starts in the target repo, which is the Orca session's
cwd rather than ours.

After dispatch the overlay shows the brief path and the created worktree or
terminal handle. Nothing reaches main automatically; `/btw:inject` puts that one
pointer line into main when the main agent needs to know work is in flight.

## Concurrency and UI

The overlay subscribes to the sub-session's `AgentSessionEvent` stream and renders
into its own transcript component, so main keeps streaming underneath rather than
being suspended.

- `Alt+/` toggles focus between the overlay and the main editor without closing.
- `Ctrl+Alt+W` is a fallback, because some terminals do not deliver `Alt+/`.
- `Esc` dismisses the overlay and cancels the in-flight side turn only. Cancelling
  a side question never interrupts main.

## Persistence

One `pi.appendEntry("btw-turn", …)` per exchange, plus a `btw-reset` marker for
`/btw:clear`. Rehydration scans `ctx.sessionManager.getEntries()` on
`session_start`.

A registered entry renderer draws one dim line per exchange in the main transcript
("btw · asked about X"), so scrollback shows that a side thread happened. Custom
entries never reach the LLM, so this costs no context.

## Failure modes

Each surfaces the real error rather than a swallowed generic one.

| Case | Behavior |
|---|---|
| No model or no credentials | Refuse, showing the provider's actual error. |
| Sub-session creation fails | Report in the overlay status line, leave the thread intact. |
| Orca genuinely absent | Do **not** fabricate a dispatch. The brief is already on disk, so report its path and state that the spawn failed. |
| Main compacts mid-thread | The side session keeps its snapshot, which stays correct. Cache alignment is lost until the next thread reseeds. Note it in the status line; do not try to fix it. |

## Testing

`pi-config` currently has no test harness. This extension adds one, scoped to
`extensions/btw/` via its own `package.json` with a vitest dev dependency and a
test script, so the rest of the repo is undisturbed. Development follows TDD.

The tests that carry weight:

1. The seed's system prompt is byte-identical to `ctx.getSystemPrompt()` and the
   append list is empty. This is the cache guarantee.
2. Thread state round-trips through `appendEntry` and rehydration.
3. Orca resolution picks the app-bundle binary when the shim is a dangling
   symlink, using a fixture rather than the real filesystem.
4. Nothing the extension does appends to main's message array except
   `/btw:inject` and `/btw:summarize`.

## Deliverable outside the extension

The `handoff` skill's Clean Dispatch section currently prescribes forking a
`pi-subagents` subagent to author the brief and spawn the session. `/btw:handoff`
does that job with a visible overlay that can be interjected in, which is closer
to the skill's own stated philosophy than the forked subagent is. Update that
section to name `/btw:handoff` as the mechanism rather than leaving two competing
ones documented. That edit lands in `okruber/skills`, not this repo.

## Verification

Manual, in a live session, plus the vitest suite:

- Ask a `/btw` question mid-turn while main is streaming; confirm main is
  uninterrupted and the answer never appears in main's context.
- Observe cache hit rate through `token-speed` across a side question, confirming
  main's next turn still hits cache.
- Run a `/btw:handoff` end to end against a real repo, confirming the brief lands
  in `Logs/handoffs/` and a visible Orca session is created.
- `/reload` with an open thread and confirm it rehydrates.
