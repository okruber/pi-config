# ask-user-question (fork)

The `ask_user_question` tool: a tabbed terminal questionnaire the model opens
instead of guessing when a request is ambiguous.

This is a vendored fork of
[`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
2.6.2 (MIT). Everything in `docs/` is upstream's reference material and still
applies, except where this file says otherwise.

## Why the fork exists

Upstream mounts the dialog as a pi-tui overlay anchored to the bottom of the
terminal at `maxHeight: "100%"`. pi-tui composites overlay lines over the
viewport, so the dialog paints across the last rows of the transcript. The
message that prompted the questions is exactly what ends up hidden, and you
can't read it while you answer.

That's [juicesharp/rpiv-mono#47](https://github.com/juicesharp/rpiv-mono/issues/47),
open since May 2026. The maintainer's answer is `Ctrl+]`, which collapses the
overlay so you can read the transcript, then brings the dialog back. He has
said he intends to keep the overlay. Several people in that thread patch it out
locally instead; one forked.

## What this fork changes

One deviation, in `ask-user-question.ts`:

```diff
-  overlay: true,
-  overlayOptions: { anchor: "bottom-center", width: "100%", maxHeight: "100%", ... },
-  onHandle: (handle) => { ... },
+  overlay: false,
```

With `overlay: false`, pi puts the component in the editor slot instead
(`showExtensionCustom` in pi's interactive mode). The dialog joins the normal
chat flow: the transcript is pushed up rather than painted over, nothing is
hidden, and the conversation stays in terminal scrollback while you answer.

Two knock-on effects, both harmless:

- `onHandle` never fires, so the raw-terminal collapse listener finds no overlay
  handle and does nothing. `Ctrl+]` still collapses and expands the dialog,
  because a focused inline component receives keystrokes directly through
  `handleInput`. Collapsing is now a convenience, not the only way to read what
  the model said.
- The dialog no longer floats above other overlays. It shares the editor slot,
  which is where pi's own dialogs live.

The second change is packaging: `@juicesharp/rpiv-config` is vendored down to
the four symbols this extension uses (`vendor/rpiv-config.ts`), so the fork has
no `node_modules` and can live in this repo as a plain extension directory.

## Config

Unchanged from upstream, including the file location:
`~/.config/rpiv-ask-user-question/config.json`. See
[docs/configuration.md](docs/configuration.md). The `collapseKey` setting still
works.

## Updating from upstream

```bash
cd /tmp && npm pack @juicesharp/rpiv-ask-user-question@<version>
tar xzf juicesharp-rpiv-ask-user-question-<version>.tgz
cp -R package/. ~/Documents/Personal/pi-config/extensions/ask-user-question/
```

Then reapply the fork, which `git diff` will show you as three reverted hunks:

1. `overlay: false` in the `ctx.ui.custom` options in `ask-user-question.ts`.
2. The `./vendor/rpiv-config.js` imports in `config.ts`.
3. This `package.json` and `README.md`.

Check whether upstream has closed #47 first. If the overlay becomes optional
there, drop this fork and go back to the npm package.

## Installation

The extension loads from this directory automatically, because
`~/.pi/agent/extensions` is a symlink to `extensions/` in this repo and pi
discovers any subdirectory with a `pi.extensions` manifest.

Don't install the npm package alongside it. Two copies register the same tool
name and pi keeps only one of them.
