#!/usr/bin/env bash
# Link okruber's pi config into ~/.pi/agent on a fresh machine.
#
# This repo is the source of truth for the authored parts of pi's config:
# settings, custom models, themes, and extensions. Everything is symlinked so
# edits here are live immediately and pi's own writes (e.g. `pi install`
# appending to settings.json) flow back into git.
#
# Secrets and machine state (auth.json, telegram.json, sessions/, npm/, git/,
# bin/) are NOT tracked — see README.md.
#
# Usage: ./install.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="$HOME/.pi/agent"
mkdir -p "$AGENT"

link() {
  local src="$REPO_DIR/$1" dst="$AGENT/$1"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "    backing up existing $1 -> $1.bak"
    mv "$dst" "$dst.bak"
  fi
  ln -sfn "$src" "$dst"
  echo "    linked $1"
}

echo "==> Linking pi config into $AGENT"
link settings.json
link models.json
link themes
link extensions
link AGENTS.md

echo "==> Done. Restart pi to pick up theme/extension changes."
echo "    Reminder: packages (superpowers, pi-subagents, pi-telegram) reinstall"
echo "    from settings.json on pi startup; skills come from the 'skills' repo."
