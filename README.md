# pi-config

okruber's personal [pi](https://pi.dev) config — the authored parts of
`~/.pi/agent`, symlinked in so edits are live. Skills are a separate repo
([`okruber/skills`](https://github.com/okruber/skills)).

## New machine

```bash
git clone git@github.com:okruber/pi-config.git ~/Documents/Personal/pi-config
cd ~/Documents/Personal/pi-config && ./install.sh
```

Secrets and machine state (`auth.json`, `telegram.json`,
`claude-subscriptions.json`, `sessions/`, `npm/`, `git/`, `bin/`) are
intentionally untracked.
