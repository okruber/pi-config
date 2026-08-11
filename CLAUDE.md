# Superpowers artifact & worktree locations

Overrides the default paths in the superpowers skills (`brainstorming`,
`writing-plans`, `using-git-worktrees`). These apply in every repository.

- **Spec & plan files — external per-repo store, out of tree.** Superpowers
  artifacts do NOT live in the repo. They go in a stable, branch-independent
  location so any session — primary checkout or any worktree, on any branch —
  resolves the same path (Orca cuts new worktrees from `main`, so a plan
  "committed on a feature branch" is invisible to the next session; and repos
  like enablement gitignore `docs/`, so in-tree plans can't be committed
  anyway). Resolve the directory with the `superpowers-store` helper on PATH:
  - Plans → ``"$(superpowers-store plans)"/YYYY-MM-DD-<feature>.md``
  - Specs → ``"$(superpowers-store specs)"/YYYY-MM-DD-<topic>-design.md``
  - The helper prints (and creates) an absolute dir under
    `~/.superpowers/repos/<owner>__<repo>/{plans,specs}/`, keyed off `origin`'s
    owner/repo — identical from every worktree of that repo. Run it from
    anywhere inside the repo. `superpowers-store` (no arg) prints the root.
  - When referencing a plan across sessions, pass this absolute store path — do
    NOT look for plans under the repo's `docs/`. If the helper is missing,
    the path is `~/.superpowers/repos/<owner>__<repo>/plans/` where
    `<owner>__<repo>` comes from `git remote get-url origin`.

- **Worktree ownership (World A — Orca is the system of record)** — for repos
  imported into Orca (Stably ADE), create worktrees through Orca, not raw
  `git worktree add`. Orca places them under its `workspaceDir`
  (`~/orca/workspaces/<repo>/<name>`, out-of-tree) and, with each repo's
  `worktreeBaseRef` pinned to `main`, branches every worktree from `main` —
  never from a drifted primary. Prefer the `orca-cli` skill's
  `orca worktree create --repo <id> --name <task> [--agent <a> --prompt <p>]`.
  Keep each repo's primary checkout parked on `main`; do feature work only in
  worktrees. Remove a worktree the moment its branch merges
  (`orca worktree rm`).
- **Worktree directory (non-Orca / superpowers flows)** — any worktree NOT
  created by Orca (e.g. the `using-git-worktrees` skill) MUST live under
  `<repo-root>/.worktrees/` (project-local, hidden, gitignored). Never use the
  global `~/.config/superpowers/worktrees/` location. Ensure `.worktrees/` is
  in the repo's committed `.gitignore` before creating one.

## Human-facing technical docs and instructions — plain, unambiguous prose (ASD-STE100-inspired)

Applies wherever you write or say this kind of content, in a file or in a
chat reply: READMEs, runbooks, setup and troubleshooting guides, PR
descriptions, issue reports, release notes, API or architecture docs and
explanations, and any time you give me step-by-step instructions. Write
short, unambiguous prose in the style of ASD-STE100 Simplified Technical
English:

- One instruction per sentence. For procedures, use the imperative ("Run the
  migration.") and put any condition before the command ("If the build
  fails, read the log.").
- Keep sentences under about 20 words for instructions, 25 for explanations.
  Split anything longer.
- Active voice. Simple tenses only - no "has been", no "is being", no
  present perfect.
- Ban should/would/may/might/could as hedges. Write "must" for a
  requirement, "can" for a possibility, or state it as fact.
- One term per concept, used consistently through a document or reply (pick
  "config" or "settings", not both, and stick with it).
- No filler: leverage, utilize, seamlessly, robust, comprehensive, in order
  to, it's worth noting that, and similar padding get deleted, not replaced.
  Write "use" for leverage/utilize, "to" for "in order to".
- Keep articles and "that" - this is short, not terse. Don't strip words to
  save length.

Does not apply to casual back-and-forth, brainstorming or exploratory
discussion, commit messages, or prose in vault notes - keep those in normal
conversational style.
