# pi-config

okruber's [pi](https://pi.dev) configuration. Source of truth for the authored
parts of `~/.pi/agent`; symlinked in so edits are live and pi's own writes flow
back into git.

Skills live in a separate repo ([`okruber/skills`](https://github.com/okruber/skills)),
which installs as a pi package and symlinks into the shared `~/.agents/skills`
store.

## What's tracked

| Path | What |
| --- | --- |
| `settings.json` | Taste + declared packages, models, theme. pi appends here on `pi install`. |
| `models.json` | Custom providers (local Ollama models). |
| `themes/` | Authored themes (`catppuccin-frappe`, `catppuccin-mocha`). |
| `extensions/` | Hand-written extensions (`omp-*`, `orca-*`, `claude-subscriptions`). |

## What's NOT tracked (secrets / machine state)

`auth.json`, `telegram.json`, `claude-subscriptions.json`, `locks.json`,
`sessions/`, `tmp/`, `npm/`, `git/` (installed packages — reproduced from
`settings.json`), and `bin/` (fd/rg binaries — install via your package
manager).

## Install on a new machine

```bash
git clone git@github.com:okruber/pi-config.git ~/Documents/Personal/pi-config
cd ~/Documents/Personal/pi-config
./install.sh
```

`install.sh` symlinks the tracked paths into `~/.pi/agent` (backing up any
existing real files to `*.bak`). Packages declared in `settings.json`
(superpowers, pi-subagents, pi-telegram) reinstall automatically on pi startup.

## Notes

- Editing a theme or extension here is live after a pi restart.
- `settings.json` churns slightly (e.g. `lastChangelogVersion`); commit when it
  reflects a decision worth keeping.
