#!/usr/bin/env python3
"""One-shot fix: add selection colors to the Parchment custom terminal theme.

Orca's Warp theme importer drops selection colors, so they must be added to
the stored theme directly. Orca rewrites orca-data.json from memory, so run
this only while Orca is completely quit (cmd-Q), then start Orca again.
"""

import json
import shutil
import sys

PATH = (
    "/Users/ollekruber/Library/Application Support/orca/orca-data.json"
)
SELECTION_BACKGROUND = "#ded6b4"  # soft gold, same family as searchMatchBg
SELECTION_FOREGROUND = "#3b3624"  # ink


def main() -> int:
    with open(PATH) as f:
        data = json.load(f)

    themes = data.get("settings", {}).get("terminalCustomThemes", [])
    targets = [t for t in themes if t.get("name") == "Parchment"]
    if not targets:
        print("No Parchment theme found in orca-data.json")
        return 1

    shutil.copy2(PATH, PATH + ".bak.selection")
    for theme in targets:
        theme["terminal"]["selectionBackground"] = SELECTION_BACKGROUND
        theme["terminal"]["selectionForeground"] = SELECTION_FOREGROUND
        print(f"Patched '{theme['name']}' ({theme['id']})")

    with open(PATH, "w") as f:
        json.dump(data, f, indent=2)
    print("Done. Start Orca now.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
