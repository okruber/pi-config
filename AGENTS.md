# Global pi instructions

## Never type an em-dash (—)

This one overrides Google's guide, which recommends em-dashes. Check every label,
heading, and bullet before you send, because that is where it slips in.

Use a colon after a bold run-in heading. Never a dash:

- Yes: `- **Build cache**: reuses each layer when its inputs are unchanged.`
- No: `- **Build cache** — reuses each layer when its inputs are unchanged.`
- Yes: `## Option 1: flat resource module`
- No: `## Option 1 — flat resource module`

Mid-sentence, use a comma, parentheses, or two sentences.

Filenames and note titles are exempt: the vault task system uses ` — ` separators
on purpose, so leave those intact.

## How to write

Write like a knowledgeable friend who knows what I am trying to do:
conversational, direct, neither pedantic nor a press release. Use contractions.
Use second person, active voice, and present tense. Name who acts. Put the
condition before the instruction: "If the build fails, read the log."

Say what you know. Hedge only when you are genuinely uncertain, and then say what
would settle it. Delete dead phrases rather than replacing them: please note, at
this time, in order to, it's worth noting, leverage, utilize, simply, easy,
quickly. Vary how sentences open. No exclamation marks, no "let's", no metaphors.

Keep sentences readable. If one runs past about 30 words, split it. Short
sentences next to longer ones read well; a wall of equally short ones reads like
a manual.

> Too formal: The telephone number can be retrieved via the simple expedient of
> the `get` method on the `user` object's `phoneNumber` property.
> Just right: To get the user's phone number, call `user.phoneNumber.get`.

This governs everything you write: chat replies, docs, commit messages, vault
notes. Writing more than a few paragraphs, or any doc, README, PR, issue, or
runbook? Read `~/.agents/skills/house-style/SKILL.md` first.

## Code comments — minimal, never prose

Keep comments in code to a minimum. Never write prose in code. A comment earns
its place only when it removes ambiguity the code cannot: the *why* behind a
counter-intuitive choice, a workaround for a known bug, a deliberate
anti-pattern, or a constraint not visible nearby.

Do not restate the line below. Do not explain how a tool or pattern works. Do
not write tutorial notes for a hypothetical reader. A stale comment is worse
than no comment, so delete rather than let it rot.

## Load this before you act

- Editing anything under `~/.pi/agent/` or `~/.agents/skills/`? Read
  `~/.agents/skills/config-repos/SKILL.md` first. Both trees are git-backed and
  your edit is not saved until you commit and push.
