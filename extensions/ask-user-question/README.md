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

The main deviation, in `ask-user-question.ts`:

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

Three consequences follow.

- The dialog no longer floats above other overlays. It shares the editor slot,
  which is where pi's own dialogs live.
- `onHandle` never fires, so upstream's raw-terminal collapse listener could
  never act. It's deleted here, along with the overlay handle it read. `Ctrl+]`
  still collapses and expands, because a focused inline component receives
  keystrokes directly through `handleInput`. Collapsing is now a convenience,
  not the only way to read what the model said.
- Inline height is height taken from the transcript, so
  `state/build-questionnaire.ts` caps the dialog at 70% of the terminal, with a
  floor of 8 rows and never more than the terminal itself. Past that the body
  scrolls behind the sticky heading and footer, which upstream's `DialogView`
  already knows how to do.

One packaging change: `@juicesharp/rpiv-config` is vendored down to the four
symbols this extension uses (`vendor/rpiv-config.ts`), so the fork has no
`node_modules` and can live in this repo as a plain extension directory.

## Config

Unchanged from upstream, including the file location:
`~/.config/rpiv-ask-user-question/config.json`. See
[docs/configuration.md](docs/configuration.md). The `collapseKey` setting still
works.

## Updating from upstream

Check [#47](https://github.com/juicesharp/rpiv-mono/issues/47) first. If the
overlay became optional upstream, drop this fork and go back to the npm package.

`fork.patch` is every change this fork makes, taken against pristine 2.6.2, so
the update is copy-then-apply:

```bash
cd /tmp && npm pack @juicesharp/rpiv-ask-user-question@<version>
tar xzf juicesharp-rpiv-ask-user-question-<version>.tgz

EXT=~/Documents/Personal/pi-config/extensions/ask-user-question
cp "$EXT/fork.patch" /tmp/fork.patch
cp -R package/. "$EXT"/
cd "$EXT" && git apply -p1 /tmp/fork.patch
```

If a hunk fails, upstream moved that code. Apply what's left with
`git apply -p1 --reject`, fix the `.rej` files by hand, then regenerate the
patch so the next update starts from a clean base:

```bash
cd /tmp && rm -rf rev && mkdir rev
cp -R /tmp/package rev/a && cp -R "$EXT" rev/b && rm -f rev/b/fork.patch
cd rev && git diff --no-index --no-prefix a b > "$EXT/fork.patch"
```

Regenerate it the same way after any edit to the fork, or it goes stale.

After updating, smoke-test without starting pi. Copy the extension to a scratch
directory next to a `node_modules` holding symlinks to pi's own
`@earendil-works/*` and `typebox`, then import the module graph with jiti and
render a questionnaire headlessly against a stub theme and a fake `tui`
(`{ terminal: { rows, columns } }`). That catches broken imports and layout
crashes in seconds, including the short-terminal cases.

## Installation

The extension loads from this directory automatically, because
`~/.pi/agent/extensions` is a symlink to `extensions/` in this repo and pi
discovers any subdirectory with a `pi.extensions` manifest.

Don't install the npm package alongside it. Two copies register the same tool
name and pi keeps only one of them.
