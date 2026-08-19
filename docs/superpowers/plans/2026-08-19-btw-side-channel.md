# /btw Side Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/btw` side channel to pi that answers side questions and dispatches handoffs in a sub-session, without ever entering the main session's LLM context or invalidating its prompt cache.

**Architecture:** A pi extension at `extensions/btw/` creates an in-memory sub-session via `createAgentSession`, seeded with main's system prompt verbatim plus a clone of main's branch messages, so the provider cache entry main created is reused. The sub-session streams into a non-capturing overlay while main keeps running underneath. Side-thread state persists through `pi.appendEntry()`, which does not participate in LLM context.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`, vitest, jiti (pi loads TS directly, no build step).

**Spec:** `docs/superpowers/specs/2026-08-19-btw-side-channel-design.md`

## Global Constraints

- Installed pi is `0.84.2`. Target `@earendil-works/*` as peer deps with `*`, matching `extensions/ask-user-question/package.json`.
- **Never call `pi.sendMessage()`.** Custom messages participate in LLM context (`docs/extensions.md:1391`). All persistence goes through `pi.appendEntry()` (`docs/extensions.md:1444`).
- The only paths that may add to main's message array are `/btw:inject` and `/btw:summarize`, both via `pi.sendUserMessage()`.
- Sub-session tool list is exactly `["read", "bash", "edit", "write"]`.
- The side session's `ResourceLoader.getSystemPrompt()` returns `ctx.getSystemPrompt()` **verbatim**, and `getAppendSystemPrompt()` returns `[]`. No footer stripping, no appended prompt.
- vitest is scoped to `extensions/btw/package.json`. Do not add a root `package.json` to `pi-config`.
- Imports come only from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`, and `node:*` builtins.
- `pi-config` is symlinked into `~/.pi/agent`, so every task ends with commit **and push** per the `config-repos` skill.
- Brief directory: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Oek Vault/Logs/handoffs/`.
- Orca app-bundle fallback binary: `/Applications/Orca.app/Contents/Resources/bin/orca`.

---

### Task 1: Package scaffold, vitest harness, and Orca resolution

The scaffold rides along with the first real deliverable rather than being its own task. Orca resolution is chosen first because it is pure logic behind injected dependencies, so it proves the harness works.

**Files:**
- Create: `extensions/btw/package.json`
- Create: `extensions/btw/vitest.config.ts`
- Create: `extensions/btw/handoff.ts`
- Test: `extensions/btw/handoff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type OrcaProbeDeps`, `type OrcaResolution`, `async function resolveOrcaBinary(deps: OrcaProbeDeps): Promise<OrcaResolution>`, `function nodeOrcaProbeDeps(): OrcaProbeDeps`.

- [ ] **Step 1: Create the package manifest**

`extensions/btw/package.json`:

```json
{
	"name": "oek-btw",
	"version": "0.1.0",
	"private": true,
	"description": "Side channel for questions and handoffs that never enters main LLM context.",
	"type": "module",
	"license": "MIT",
	"pi": {
		"extensions": ["./index.ts"]
	},
	"scripts": {
		"test": "vitest --run"
	},
	"peerDependencies": {
		"@earendil-works/pi-ai": "*",
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*"
	},
	"devDependencies": {
		"typescript": "^6.0.2",
		"vitest": "^4.1.0"
	}
}
```

`extensions/btw/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["*.test.ts"],
		environment: "node",
	},
});
```

- [ ] **Step 2: Install dev dependencies**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm install`
Expected: `node_modules/` created, no errors. Confirm `node_modules/` is ignored by checking `git status --porcelain` shows no `node_modules` entries. If it does, add `extensions/btw/node_modules/` to `.gitignore` before committing.

- [ ] **Step 3: Write the failing test**

`extensions/btw/handoff.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveOrcaBinary, type OrcaProbeDeps } from "./handoff.js";

const APP_BUNDLE = "/Applications/Orca.app/Contents/Resources/bin/orca";

function deps(overrides: Partial<OrcaProbeDeps> = {}): OrcaProbeDeps {
	return {
		which: async () => null,
		isExecutable: async () => false,
		run: async () => ({ code: 1, stdout: "" }),
		...overrides,
	};
}

describe("resolveOrcaBinary", () => {
	it("uses the shim when it is executable and status succeeds", async () => {
		const result = await resolveOrcaBinary(
			deps({
				which: async () => "/usr/local/bin/orca",
				isExecutable: async (path) => path === "/usr/local/bin/orca",
				run: async () => ({ code: 0, stdout: '{"running":true}' }),
			}),
		);
		expect(result).toEqual({ ok: true, binary: "/usr/local/bin/orca" });
	});

	it("falls back to the app bundle when the shim is a dangling symlink", async () => {
		const result = await resolveOrcaBinary(
			deps({
				which: async () => "/usr/local/bin/orca",
				isExecutable: async (path) => path === APP_BUNDLE,
				run: async () => ({ code: 0, stdout: '{"running":true}' }),
			}),
		);
		expect(result).toEqual({ ok: true, binary: APP_BUNDLE });
	});

	it("falls back to the app bundle when the shim exists but status fails", async () => {
		const result = await resolveOrcaBinary(
			deps({
				which: async () => "/usr/local/bin/orca",
				isExecutable: async () => true,
				run: async (binary) => (binary === APP_BUNDLE ? { code: 0, stdout: "{}" } : { code: 127, stdout: "" }),
			}),
		);
		expect(result).toEqual({ ok: true, binary: APP_BUNDLE });
	});

	it("reports failure when neither candidate works", async () => {
		const result = await resolveOrcaBinary(deps());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("Orca");
		}
	});
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, cannot resolve `./handoff.js`.

- [ ] **Step 5: Write the minimal implementation**

`extensions/btw/handoff.ts`:

```typescript
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ORCA_APP_BUNDLE_BINARY = "/Applications/Orca.app/Contents/Resources/bin/orca";

export type OrcaProbeDeps = {
	which: (command: string) => Promise<string | null>;
	isExecutable: (path: string) => Promise<boolean>;
	run: (binary: string, args: string[]) => Promise<{ code: number; stdout: string }>;
};

export type OrcaResolution = { ok: true; binary: string } | { ok: false; reason: string };

export async function resolveOrcaBinary(deps: OrcaProbeDeps): Promise<OrcaResolution> {
	const shim = await deps.which("orca");
	const candidates = [shim, ORCA_APP_BUNDLE_BINARY].filter((value): value is string => Boolean(value));

	for (const candidate of candidates) {
		if (!(await deps.isExecutable(candidate))) {
			continue;
		}
		const probe = await deps.run(candidate, ["status", "--json"]);
		if (probe.code === 0) {
			return { ok: true, binary: candidate };
		}
	}

	return {
		ok: false,
		reason: `Orca is not available. Tried ${candidates.join(", ") || "no candidates"}.`,
	};
}

export function nodeOrcaProbeDeps(): OrcaProbeDeps {
	return {
		which: async (command) => {
			try {
				const { stdout } = await execFileAsync("command", ["-v", command], { shell: "/bin/bash" });
				const path = stdout.trim();
				return path || null;
			} catch {
				return null;
			}
		},
		isExecutable: async (path) => {
			try {
				await access(path, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		},
		run: async (binary, args) => {
			try {
				const { stdout } = await execFileAsync(binary, args);
				return { code: 0, stdout };
			} catch (error) {
				const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
				return { code, stdout: "" };
			}
		},
	};
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 4 passing.

- [ ] **Step 7: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw .gitignore
git commit -m "btw: scaffold package, vitest harness, and Orca binary resolution"
git push
```

---

### Task 2: Cache-aligned resource loader and seed builder

This task implements the spec's central guarantee. The tests here are the ones that catch a silent regression later.

**Files:**
- Create: `extensions/btw/side-session.ts`
- Test: `extensions/btw/side-session.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `function createSideResourceLoader(ctx: SeedContext): ResourceLoader`, `function buildSeedMessages(ctx: SeedContext, framing: string): Message[]`, `type SeedContext`.

- [ ] **Step 1: Write the failing test**

`extensions/btw/side-session.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSeedMessages, createSideResourceLoader, type SeedContext } from "./side-session.js";

const SYSTEM_PROMPT = "You are pi.\n\nCurrent date and time: 2026-08-19T10:00:00Z\nCurrent working directory: /vault";

function seedContext(messages: unknown[] = []): SeedContext {
	return {
		getSystemPrompt: () => SYSTEM_PROMPT,
		buildContextMessages: () => messages as never,
	};
}

describe("createSideResourceLoader", () => {
	it("returns main's system prompt byte-identical", () => {
		const loader = createSideResourceLoader(seedContext());
		expect(loader.getSystemPrompt()).toBe(SYSTEM_PROMPT);
	});

	it("appends nothing to the system prompt", () => {
		const loader = createSideResourceLoader(seedContext());
		expect(loader.getAppendSystemPrompt()).toEqual([]);
	});

	it("loads no extensions, skills, prompts, or themes into the side session", () => {
		const loader = createSideResourceLoader(seedContext());
		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getPrompts().prompts).toEqual([]);
		expect(loader.getThemes().themes).toEqual([]);
		expect(loader.getExtensions().extensions).toEqual([]);
	});
});

describe("buildSeedMessages", () => {
	it("places the framing as a trailing user message after the cloned branch", () => {
		const branch = [
			{ role: "user", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: [{ type: "text", text: "second" }] },
		];
		const messages = buildSeedMessages(seedContext(branch), "FRAMING");

		expect(messages).toHaveLength(3);
		expect(messages[0]).toEqual(branch[0]);
		expect(messages[1]).toEqual(branch[1]);
		expect(messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "FRAMING" }] });
	});

	it("does not mutate the cloned branch array", () => {
		const branch = [{ role: "user", content: [{ type: "text", text: "first" }] }];
		buildSeedMessages(seedContext(branch), "FRAMING");
		expect(branch).toHaveLength(1);
	});

	it("still produces the framing when the branch is empty", () => {
		const messages = buildSeedMessages(seedContext([]), "FRAMING");
		expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "FRAMING" }] }]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, cannot resolve `./side-session.js`.

- [ ] **Step 3: Write the minimal implementation**

`extensions/btw/side-session.ts`:

```typescript
import { createExtensionRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

export type SeedContext = {
	getSystemPrompt: () => string;
	buildContextMessages: () => Message[];
};

/**
 * Main's system prompt is returned verbatim and nothing is appended, so the side
 * session's prefix matches main's byte for byte and reuses its provider cache entry.
 */
export function createSideResourceLoader(ctx: SeedContext): ResourceLoader {
	const systemPrompt = ctx.getSystemPrompt();
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };

	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

export function buildSeedMessages(ctx: SeedContext, framing: string): Message[] {
	return [...ctx.buildContextMessages(), { role: "user", content: [{ type: "text", text: framing }] } as Message];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 10 passing (4 from Task 1, 6 new).

- [ ] **Step 5: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: cache-aligned resource loader and seed builder"
git push
```

---

### Task 3: Thread state, persistence, and rehydration

**Files:**
- Create: `extensions/btw/thread.ts`
- Test: `extensions/btw/thread.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `const BTW_TURN_ENTRY = "btw-turn"`, `const BTW_RESET_ENTRY = "btw-reset"`, `type BtwTurn`, `function rehydrateThread(entries: SessionEntryLike[]): BtwTurn[]`, `type SessionEntryLike`.

- [ ] **Step 1: Write the failing test**

`extensions/btw/thread.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { BTW_RESET_ENTRY, BTW_TURN_ENTRY, rehydrateThread, type BtwTurn, type SessionEntryLike } from "./thread.js";

function turnEntry(turn: Partial<BtwTurn>): SessionEntryLike {
	return {
		type: "custom",
		customType: BTW_TURN_ENTRY,
		data: { question: "q", answer: "a", kind: "question", timestamp: 1, ...turn },
	};
}

describe("rehydrateThread", () => {
	it("returns turns in session order", () => {
		const thread = rehydrateThread([turnEntry({ question: "one" }), turnEntry({ question: "two" })]);
		expect(thread.map((t) => t.question)).toEqual(["one", "two"]);
	});

	it("ignores entries belonging to other extensions", () => {
		const thread = rehydrateThread([
			{ type: "custom", customType: "todo-state", data: { question: "nope" } },
			turnEntry({ question: "one" }),
		]);
		expect(thread.map((t) => t.question)).toEqual(["one"]);
	});

	it("drops everything before a reset marker", () => {
		const thread = rehydrateThread([
			turnEntry({ question: "old" }),
			{ type: "custom", customType: BTW_RESET_ENTRY, data: {} },
			turnEntry({ question: "new" }),
		]);
		expect(thread.map((t) => t.question)).toEqual(["new"]);
	});

	it("returns an empty thread when the last entry is a reset", () => {
		const thread = rehydrateThread([turnEntry({ question: "old" }), { type: "custom", customType: BTW_RESET_ENTRY, data: {} }]);
		expect(thread).toEqual([]);
	});

	it("skips malformed turn payloads instead of throwing", () => {
		const thread = rehydrateThread([
			{ type: "custom", customType: BTW_TURN_ENTRY, data: null },
			{ type: "custom", customType: BTW_TURN_ENTRY, data: { question: 42 } },
			turnEntry({ question: "one" }),
		]);
		expect(thread.map((t) => t.question)).toEqual(["one"]);
	});

	it("preserves the handoff kind", () => {
		const thread = rehydrateThread([turnEntry({ kind: "handoff" })]);
		expect(thread[0].kind).toBe("handoff");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, cannot resolve `./thread.js`.

- [ ] **Step 3: Write the minimal implementation**

`extensions/btw/thread.ts`:

```typescript
export const BTW_TURN_ENTRY = "btw-turn";
export const BTW_RESET_ENTRY = "btw-reset";

export type BtwTurnKind = "question" | "handoff";

export type BtwTurn = {
	question: string;
	answer: string;
	kind: BtwTurnKind;
	timestamp: number;
};

export type SessionEntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
};

function toTurn(data: unknown): BtwTurn | null {
	if (!data || typeof data !== "object") {
		return null;
	}
	const record = data as Record<string, unknown>;
	if (typeof record.question !== "string" || typeof record.answer !== "string") {
		return null;
	}
	return {
		question: record.question,
		answer: record.answer,
		kind: record.kind === "handoff" ? "handoff" : "question",
		timestamp: typeof record.timestamp === "number" ? record.timestamp : 0,
	};
}

export function rehydrateThread(entries: SessionEntryLike[]): BtwTurn[] {
	let thread: BtwTurn[] = [];

	for (const entry of entries) {
		if (entry?.type !== "custom") {
			continue;
		}
		if (entry.customType === BTW_RESET_ENTRY) {
			thread = [];
			continue;
		}
		if (entry.customType !== BTW_TURN_ENTRY) {
			continue;
		}
		const turn = toTurn(entry.data);
		if (turn) {
			thread.push(turn);
		}
	}

	return thread;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 16 passing.

- [ ] **Step 5: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: thread state persistence and rehydration"
git push
```

---

### Task 4: Overlay transcript reducer

The overlay's rendering is verified by hand; its state machine is not. This task builds the reducer that turns sub-session events into displayable entries, which is where the bugs actually live.

**Files:**
- Create: `extensions/btw/transcript.ts`
- Test: `extensions/btw/transcript.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type TranscriptEntry`, `type TranscriptState`, `function emptyTranscript(): TranscriptState`, `function applyTranscriptEvent(state: TranscriptState, event: TranscriptEventLike): TranscriptState`, `type TranscriptEventLike`.

- [ ] **Step 1: Write the failing test**

`extensions/btw/transcript.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { applyTranscriptEvent, emptyTranscript, type TranscriptEventLike } from "./transcript.js";

function apply(events: TranscriptEventLike[]) {
	return events.reduce(applyTranscriptEvent, emptyTranscript());
}

describe("applyTranscriptEvent", () => {
	it("appends an assistant entry on message_start", () => {
		const state = apply([{ type: "message_start", role: "assistant" }]);
		expect(state.entries).toEqual([{ role: "assistant", text: "", streaming: true }]);
	});

	it("accumulates streamed text into the open assistant entry", () => {
		const state = apply([
			{ type: "message_start", role: "assistant" },
			{ type: "message_update", role: "assistant", text: "Hel" },
			{ type: "message_update", role: "assistant", text: "Hello" },
		]);
		expect(state.entries).toEqual([{ role: "assistant", text: "Hello", streaming: true }]);
	});

	it("closes the entry on message_end", () => {
		const state = apply([
			{ type: "message_start", role: "assistant" },
			{ type: "message_update", role: "assistant", text: "Hello" },
			{ type: "message_end", role: "assistant" },
		]);
		expect(state.entries).toEqual([{ role: "assistant", text: "Hello", streaming: false }]);
	});

	it("records tool activity as its own entry", () => {
		const state = apply([{ type: "tool_execution_start", toolName: "bash" }]);
		expect(state.entries).toEqual([{ role: "tool", text: "bash", streaming: true }]);
	});

	it("closes the tool entry on tool_execution_end", () => {
		const state = apply([
			{ type: "tool_execution_start", toolName: "bash" },
			{ type: "tool_execution_end", toolName: "bash" },
		]);
		expect(state.entries).toEqual([{ role: "tool", text: "bash", streaming: false }]);
	});

	it("ignores unrelated events", () => {
		const state = apply([{ type: "turn_start" }, { type: "turn_end" }]);
		expect(state.entries).toEqual([]);
	});

	it("does not mutate the previous state", () => {
		const first = apply([{ type: "message_start", role: "assistant" }]);
		const second = applyTranscriptEvent(first, { type: "message_update", role: "assistant", text: "Hi" });
		expect(first.entries[0].text).toBe("");
		expect(second.entries[0].text).toBe("Hi");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, cannot resolve `./transcript.js`.

- [ ] **Step 3: Write the minimal implementation**

`extensions/btw/transcript.ts`:

```typescript
export type TranscriptRole = "user" | "assistant" | "tool";

export type TranscriptEntry = {
	role: TranscriptRole;
	text: string;
	streaming: boolean;
};

export type TranscriptState = {
	entries: TranscriptEntry[];
};

export type TranscriptEventLike = {
	type: string;
	role?: string;
	text?: string;
	toolName?: string;
};

export function emptyTranscript(): TranscriptState {
	return { entries: [] };
}

export function appendUserEntry(state: TranscriptState, text: string): TranscriptState {
	return { entries: [...state.entries, { role: "user", text, streaming: false }] };
}

function replaceLast(state: TranscriptState, update: Partial<TranscriptEntry>): TranscriptState {
	if (state.entries.length === 0) {
		return state;
	}
	const entries = state.entries.slice();
	entries[entries.length - 1] = { ...entries[entries.length - 1], ...update };
	return { entries };
}

export function applyTranscriptEvent(state: TranscriptState, event: TranscriptEventLike): TranscriptState {
	switch (event.type) {
		case "message_start":
			return { entries: [...state.entries, { role: "assistant", text: "", streaming: true }] };
		case "message_update":
			return replaceLast(state, { text: event.text ?? "" });
		case "message_end":
			return replaceLast(state, { streaming: false });
		case "tool_execution_start":
			return { entries: [...state.entries, { role: "tool", text: event.toolName ?? "tool", streaming: true }] };
		case "tool_execution_end":
			return replaceLast(state, { streaming: false });
		default:
			return state;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 23 passing.

- [ ] **Step 5: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: overlay transcript reducer"
git push
```

---

### Task 5: Side session lifecycle

**Files:**
- Modify: `extensions/btw/side-session.ts`
- Modify: `extensions/btw/side-session.test.ts`

**Interfaces:**
- Consumes: `createSideResourceLoader`, `buildSeedMessages`, `SeedContext` (Task 2).
- Produces: `type SideSessionRuntime`, `type SideSessionDeps`, `async function createSideSession(ctx: SideSessionContext, framing: string, deps: SideSessionDeps): Promise<SideSessionRuntime>`, `type SideSessionContext`.

- [ ] **Step 1: Write the failing test**

Append to `extensions/btw/side-session.test.ts`:

```typescript
import { createSideSession, type SideSessionContext, type SideSessionDeps } from "./side-session.js";

function sessionContext(): SideSessionContext {
	return {
		getSystemPrompt: () => SYSTEM_PROMPT,
		buildContextMessages: () => [],
		model: { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" } as never,
		modelRegistry: {} as never,
		thinkingLevel: "off",
	};
}

function fakeDeps(): { deps: SideSessionDeps; captured: { options?: Record<string, unknown> } } {
	const captured: { options?: Record<string, unknown> } = {};
	const deps: SideSessionDeps = {
		createSession: (async (options: Record<string, unknown>) => {
			captured.options = options;
			return {
				session: {
					agent: { state: { messages: [] } },
					subscribe: () => () => {},
					abort: async () => {},
					dispose: () => {},
				},
			};
		}) as never,
		createInMemorySessionManager: () => ({}) as never,
	};
	return { deps, captured };
}

describe("createSideSession", () => {
	it("requests exactly the coding-agent tool set", async () => {
		const { deps, captured } = fakeDeps();
		await createSideSession(sessionContext(), "FRAMING", deps);
		expect(captured.options?.tools).toEqual(["read", "bash", "edit", "write"]);
	});

	it("seeds the sub-session with the framing as the trailing message", async () => {
		const { deps } = fakeDeps();
		const runtime = await createSideSession(sessionContext(), "FRAMING", deps);
		const messages = runtime.session.agent.state.messages as { role: string; content: { text: string }[] }[];
		expect(messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "FRAMING" }] });
	});

	it("throws a clear error when no model is active", async () => {
		const { deps } = fakeDeps();
		const ctx = { ...sessionContext(), model: null };
		await expect(createSideSession(ctx, "FRAMING", deps)).rejects.toThrow("No active model");
	});

	it("dispose aborts the session before disposing it", async () => {
		const order: string[] = [];
		const { deps } = fakeDeps();
		deps.createSession = (async () => ({
			session: {
				agent: { state: { messages: [] } },
				subscribe: () => () => {},
				abort: async () => {
					order.push("abort");
				},
				dispose: () => {
					order.push("dispose");
				},
			},
		})) as never;

		const runtime = await createSideSession(sessionContext(), "FRAMING", deps);
		await runtime.dispose();
		expect(order).toEqual(["abort", "dispose"]);
	});

	it("dispose runs every registered unsubscribe", async () => {
		const { deps } = fakeDeps();
		const runtime = await createSideSession(sessionContext(), "FRAMING", deps);
		let unsubscribed = 0;
		runtime.subscriptions.add(() => {
			unsubscribed += 1;
		});
		await runtime.dispose();
		expect(unsubscribed).toBe(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, `createSideSession` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `extensions/btw/side-session.ts`:

```typescript
import { createAgentSession, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";

export const SIDE_SESSION_TOOLS = ["read", "bash", "edit", "write"] as const;

export type SideSessionContext = SeedContext & {
	model: AgentSession["model"] | null;
	modelRegistry: AgentSession["modelRegistry"];
	thinkingLevel: string;
};

export type SideSessionDeps = {
	createSession: typeof createAgentSession;
	createInMemorySessionManager: () => ReturnType<typeof SessionManager.inMemory>;
};

export type SideSessionRuntime = {
	session: AgentSession;
	subscriptions: Set<() => void>;
	dispose: () => Promise<void>;
};

export function nodeSideSessionDeps(): SideSessionDeps {
	return {
		createSession: createAgentSession,
		createInMemorySessionManager: () => SessionManager.inMemory(),
	};
}

export async function createSideSession(
	ctx: SideSessionContext,
	framing: string,
	deps: SideSessionDeps,
): Promise<SideSessionRuntime> {
	if (!ctx.model) {
		throw new Error("No active model. Run /login or select a model before using /btw.");
	}

	const { session } = await deps.createSession({
		sessionManager: deps.createInMemorySessionManager(),
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		thinkingLevel: ctx.thinkingLevel,
		tools: [...SIDE_SESSION_TOOLS],
		resourceLoader: createSideResourceLoader(ctx),
	} as Parameters<typeof createAgentSession>[0]);

	session.agent.state.messages = buildSeedMessages(ctx, framing) as typeof session.agent.state.messages;

	const subscriptions = new Set<() => void>();

	return {
		session,
		subscriptions,
		dispose: async () => {
			for (const unsubscribe of subscriptions) {
				unsubscribe();
			}
			subscriptions.clear();
			await session.abort();
			session.dispose();
		},
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 28 passing.

- [ ] **Step 5: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: side session lifecycle"
git push
```

---

### Task 6: Overlay component and the `/btw` command

This is the first task that produces something usable. It is also the largest, because the non-capturing overlay is what lets main keep running.

**Files:**
- Create: `extensions/btw/overlay.ts`
- Create: `extensions/btw/index.ts`
- Test: manual, plus the existing suite must stay green.

**Interfaces:**
- Consumes: `createSideSession`, `nodeSideSessionDeps`, `SideSessionRuntime` (Task 5); `applyTranscriptEvent`, `appendUserEntry`, `emptyTranscript`, `TranscriptState` (Task 4); `BtwTurn`, `BTW_TURN_ENTRY`, `BTW_RESET_ENTRY`, `rehydrateThread` (Task 3).
- Produces: `class BtwOverlay`, `function questionFraming(question: string): string`.

- [ ] **Step 1: Write the overlay component**

`extensions/btw/overlay.ts`:

```typescript
import { Container, Input, Key, Text, matchesKey, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import type { TranscriptState } from "./transcript.js";

export const FOCUS_SHORTCUTS = [Key.alt("/"), Key.ctrlAlt("w")] as const;

export function matchesFocusShortcut(data: string): boolean {
	return FOCUS_SHORTCUTS.some((shortcut) => matchesKey(data, shortcut));
}

export class BtwOverlay extends Container implements Focusable {
	focused = true;
	private readonly input: Input;

	constructor(
		tui: TUI,
		private readonly theme: { fg: (name: string, text: string) => string; bold: (text: string) => string },
		keybindings: KeybindingsManager,
		private readonly getTranscript: () => TranscriptState,
		private readonly getStatus: () => string | null,
		private readonly onSubmit: (value: string) => void,
		private readonly onDismiss: () => void,
		private readonly onToggleFocus: () => void,
	) {
		super();
		this.input = new Input(tui, keybindings);
		this.input.onSubmit = (value) => {
			if (value.trim()) {
				this.onSubmit(value.trim());
				this.input.setText("");
			}
		};
		this.rebuild();
	}

	handleInput(data: string): boolean {
		if (matchesFocusShortcut(data)) {
			this.onToggleFocus();
			return true;
		}
		if (matchesKey(data, Key.escape())) {
			this.onDismiss();
			return true;
		}
		return this.input.handleInput(data);
	}

	setDraft(value: string): void {
		this.input.setText(value);
	}

	getDraft(): string {
		return this.input.getText();
	}

	refresh(): void {
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		this.addChild(new Text(this.theme.bold("btw · side thread")));

		for (const entry of this.getTranscript().entries) {
			const prefix = entry.role === "user" ? "› " : entry.role === "tool" ? "⚙ " : "";
			const body = entry.role === "tool" ? this.theme.fg("dim", `${prefix}${entry.text}`) : `${prefix}${entry.text}`;
			this.addChild(new Text(body));
		}

		const status = this.getStatus();
		if (status) {
			this.addChild(new Text(this.theme.fg("dim", status)));
		}

		this.addChild(this.input);
		this.addChild(new Text(this.theme.fg("dim", "alt+/ focus main · esc dismiss")));
	}
}
```

- [ ] **Step 2: Write the extension entry point**

`extensions/btw/index.ts`:

```typescript
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BtwOverlay } from "./overlay.js";
import { createSideSession, nodeSideSessionDeps, type SideSessionRuntime } from "./side-session.js";
import { BTW_RESET_ENTRY, BTW_TURN_ENTRY, rehydrateThread, type BtwTurn } from "./thread.js";
import { appendUserEntry, applyTranscriptEvent, emptyTranscript, type TranscriptState } from "./transcript.js";

export function questionFraming(question: string): string {
	return [
		"[Side conversation. The main session is handled by another agent and is shown above for context only.",
		"Answer this side question directly. Do not continue the main session's work unless asked.]",
		"",
		question,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	let thread: BtwTurn[] = [];
	let runtime: SideSessionRuntime | null = null;
	let transcript: TranscriptState = emptyTranscript();
	let status: string | null = null;
	let overlay: { close: () => void; refresh: () => void; handle?: { focus: () => void; unfocus: () => void } } | null = null;

	pi.on("session_start", async (_event, ctx) => {
		thread = rehydrateThread(ctx.sessionManager.getEntries() as never);
	});

	async function ensureOverlay(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.hasUI || overlay) {
			overlay?.handle?.focus();
			return;
		}

		const local: NonNullable<typeof overlay> = { close: () => {}, refresh: () => {} };
		overlay = local;

		void ctx.ui.custom<void>(
			async (tui, theme, keybindings, done) => {
				const component = new BtwOverlay(
					tui,
					theme as never,
					keybindings,
					() => transcript,
					() => status,
					(value) => void ask(ctx, value),
					() => {
						overlay = null;
						done();
					},
					() => local.handle?.unfocus(),
				);
				local.refresh = () => component.refresh();
				local.close = () => done();
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					width: "78%",
					minWidth: 72,
					maxHeight: "78%",
					anchor: "top-center",
					margin: { top: 1, left: 2, right: 2 },
					// Keeps main rendering and running underneath instead of taking the screen.
					nonCapturing: true,
				},
				onHandle: (handle) => {
					local.handle = handle as never;
					handle.focus();
				},
			},
		);
	}

	async function ensureSession(ctx: ExtensionCommandContext, framing: string): Promise<SideSessionRuntime> {
		if (runtime) {
			return runtime;
		}

		runtime = await createSideSession(
			{
				getSystemPrompt: () => ctx.getSystemPrompt(),
				buildContextMessages: () => ctx.buildContextMessages(),
				model: ctx.model ?? null,
				modelRegistry: ctx.modelRegistry as never,
				thinkingLevel: ctx.thinkingLevel ?? "off",
			} as never,
			framing,
			nodeSideSessionDeps(),
		);

		runtime.subscriptions.add(
			runtime.session.subscribe((event) => {
				transcript = applyTranscriptEvent(transcript, event as never);
				status = runtime?.session.isStreaming ? "⏳ working…" : null;
				overlay?.refresh();
			}),
		);

		return runtime;
	}

	async function ask(ctx: ExtensionCommandContext, question: string, kind: BtwTurn["kind"] = "question"): Promise<void> {
		await ensureOverlay(ctx);
		transcript = appendUserEntry(transcript, question);
		overlay?.refresh();

		try {
			const active = await ensureSession(ctx, questionFraming(question));
			// The seed already carries the first framing, so only later turns are prompted.
			if (thread.length > 0) {
				await active.session.prompt(questionFraming(question), { source: "extension" });
			} else {
				await active.session.prompt("", { source: "extension" });
			}
			const answer = transcript.entries.filter((e) => e.role === "assistant").at(-1)?.text ?? "";
			const turn: BtwTurn = { question, answer, kind, timestamp: Date.now() };
			thread.push(turn);
			pi.appendEntry(BTW_TURN_ENTRY, turn);
		} catch (error) {
			status = `⚠ ${error instanceof Error ? error.message : String(error)}`;
			overlay?.refresh();
		}
	}

	pi.registerCommand("btw", {
		description: "Ask a side question without touching main context",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (!question) {
				await ensureOverlay(ctx);
				return;
			}
			await ask(ctx, question);
		},
	});

	pi.registerCommand("btw:clear", {
		description: "Clear the side thread and dismiss the overlay",
		handler: async (_args, _ctx) => {
			await runtime?.dispose();
			runtime = null;
			thread = [];
			transcript = emptyTranscript();
			status = null;
			overlay?.close();
			overlay = null;
			pi.appendEntry(BTW_RESET_ENTRY, {});
		},
	});
}
```

- [ ] **Step 3: Verify the existing suite is still green**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 28 passing, unchanged.

- [ ] **Step 4: Manual verification, including the cache probe**

Run: `pi -e ~/Documents/Personal/pi-config/extensions/btw`

Check each of these:

1. `/btw what is in this directory?` opens the overlay and answers. The answer uses the `read` or `bash` tool, proving tool access.
2. Start a long main turn, then run `/btw` mid-turn. The main turn keeps streaming underneath and is not interrupted.
3. `Alt+/` returns focus to the main editor with the overlay still visible. If your terminal swallows it, `Ctrl+Alt+W` does the same.
4. `Esc` dismisses.
5. **Cache probe (spec open item):** watch the `token-speed` cache hit rate on main's next turn after a `/btw`. If main's hit rate is unchanged, cache alignment holds. If it collapses, check whether pi rebuilds the `Current date and time:` footer per turn; if it does, record that in the spec and drop the alignment rule.

- [ ] **Step 5: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: overlay component and /btw command"
git push
```

---

### Task 7: Injecting back into main

**Files:**
- Modify: `extensions/btw/index.ts`
- Create: `extensions/btw/inject.ts`
- Test: `extensions/btw/inject.test.ts`

**Interfaces:**
- Consumes: `BtwTurn` (Task 3).
- Produces: `function formatThreadForInjection(thread: BtwTurn[], instructions: string): string`, `function summarizeFraming(thread: BtwTurn[], instructions: string): string`.

- [ ] **Step 1: Write the failing test**

`extensions/btw/inject.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatThreadForInjection, summarizeFraming } from "./inject.js";
import type { BtwTurn } from "./thread.js";

const thread: BtwTurn[] = [
	{ question: "why sockets?", answer: "latency", kind: "question", timestamp: 1 },
	{ question: "and SSE?", answer: "simpler", kind: "question", timestamp: 2 },
];

describe("formatThreadForInjection", () => {
	it("includes every question and answer in order", () => {
		const text = formatThreadForInjection(thread, "");
		expect(text.indexOf("why sockets?")).toBeLessThan(text.indexOf("and SSE?"));
		expect(text).toContain("latency");
		expect(text).toContain("simpler");
	});

	it("puts the instructions last so they read as the actual request", () => {
		const text = formatThreadForInjection(thread, "now implement it");
		expect(text.trimEnd().endsWith("now implement it")).toBe(true);
	});

	it("marks the content as coming from a side thread", () => {
		expect(formatThreadForInjection(thread, "")).toContain("side thread");
	});

	it("handles an empty thread without producing a stray header", () => {
		expect(formatThreadForInjection([], "do the thing")).toBe("do the thing");
	});
});

describe("summarizeFraming", () => {
	it("asks for a summary and includes the thread", () => {
		const text = summarizeFraming(thread, "");
		expect(text).toContain("Summarize");
		expect(text).toContain("why sockets?");
	});

	it("passes extra instructions through", () => {
		expect(summarizeFraming(thread, "focus on risks")).toContain("focus on risks");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, cannot resolve `./inject.js`.

- [ ] **Step 3: Write the minimal implementation**

`extensions/btw/inject.ts`:

```typescript
import type { BtwTurn } from "./thread.js";

function renderThread(thread: BtwTurn[]): string {
	return thread.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`).join("\n\n");
}

export function formatThreadForInjection(thread: BtwTurn[], instructions: string): string {
	if (thread.length === 0) {
		return instructions.trim();
	}

	return [
		"[From a side thread you did not see:]",
		"",
		renderThread(thread),
		"",
		instructions.trim(),
	]
		.join("\n")
		.trimEnd();
}

export function summarizeFraming(thread: BtwTurn[], instructions: string): string {
	return [
		"Summarize this side conversation concisely. Preserve decisions, plans, risks, and action items.",
		"Output only the summary.",
		instructions.trim(),
		"",
		renderThread(thread),
	]
		.filter((line, index) => index !== 2 || line.length > 0)
		.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 34 passing.

- [ ] **Step 5: Register the commands**

Add to `extensions/btw/index.ts`, inside the default export, after the `btw:clear` registration:

```typescript
	pi.registerCommand("btw:inject", {
		description: "Send the side thread to the main agent",
		handler: async (args, ctx) => {
			if (thread.length === 0 && !args.trim()) {
				ctx.ui.notify("Side thread is empty.", "warning");
				return;
			}
			pi.sendUserMessage(formatThreadForInjection(thread, args), { deliverAs: "followUp", triggerTurn: true });
			await runtime?.dispose();
			runtime = null;
			thread = [];
			transcript = emptyTranscript();
			overlay?.close();
			overlay = null;
			pi.appendEntry(BTW_RESET_ENTRY, {});
		},
	});

	pi.registerCommand("btw:summarize", {
		description: "Summarize the side thread into the main agent",
		handler: async (args, ctx) => {
			if (thread.length === 0) {
				ctx.ui.notify("Side thread is empty.", "warning");
				return;
			}
			const active = await ensureSession(ctx, summarizeFraming(thread, args));
			await active.session.prompt("", { source: "extension" });
			const summary = transcript.entries.filter((e) => e.role === "assistant").at(-1)?.text ?? "";
			pi.sendUserMessage(`[Summary of a side thread:]\n\n${summary}`, { deliverAs: "followUp", triggerTurn: true });
			await runtime?.dispose();
			runtime = null;
			thread = [];
			transcript = emptyTranscript();
			overlay?.close();
			overlay = null;
			pi.appendEntry(BTW_RESET_ENTRY, {});
		},
	});
```

Add the import at the top of `index.ts`:

```typescript
import { formatThreadForInjection, summarizeFraming } from "./inject.js";
```

- [ ] **Step 6: Manual verification**

Run: `pi -e ~/Documents/Personal/pi-config/extensions/btw`

Ask a `/btw` question, then `/btw:inject implement this`. Confirm the main transcript gains exactly one user message and the overlay closes. Then repeat with `/btw:summarize` and confirm main receives the summary rather than the full thread.

- [ ] **Step 7: Commit and push**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: inject and summarize back into main"
git push
```

---

### Task 8: `/btw:handoff` and the skill update

**Files:**
- Modify: `extensions/btw/handoff.ts`
- Modify: `extensions/btw/handoff.test.ts`
- Modify: `extensions/btw/index.ts`
- Create: `extensions/btw/README.md`
- Modify: `~/Documents/Personal/skills/skills/handoff/SKILL.md`

**Interfaces:**
- Consumes: `resolveOrcaBinary`, `nodeOrcaProbeDeps` (Task 1); `ask` and command registration (Task 6).
- Produces: `function buildHandoffFraming(input: HandoffFramingInput): string`, `type HandoffFramingInput`, `function briefPath(task: string, today: string, briefDir: string): string`.

- [ ] **Step 1: Write the failing test**

Append to `extensions/btw/handoff.test.ts`:

```typescript
import { briefPath, buildHandoffFraming } from "./handoff.js";

describe("briefPath", () => {
	it("slugifies the task into a dated filename", () => {
		expect(briefPath("Fix the OAuth refresh loop", "2026-08-19", "/briefs")).toBe(
			"/briefs/2026-08-19-fix-the-oauth-refresh-loop.md",
		);
	});

	it("truncates very long tasks to a usable slug", () => {
		const path = briefPath("a".repeat(200), "2026-08-19", "/briefs");
		expect(path.length).toBeLessThan(120);
	});

	it("collapses punctuation and repeated separators", () => {
		expect(briefPath("Ship it!!  now, please", "2026-08-19", "/briefs")).toBe("/briefs/2026-08-19-ship-it-now-please.md");
	});
});

describe("buildHandoffFraming", () => {
	const input = {
		task: "Fix the OAuth refresh loop",
		orcaBinary: "/Applications/Orca.app/Contents/Resources/bin/orca",
		skillPath: "/Users/x/.agents/skills/handoff/SKILL.md",
		briefPath: "/briefs/2026-08-19-fix-the-oauth-refresh-loop.md",
	};

	it("points at the skill by path rather than inlining it", () => {
		const framing = buildHandoffFraming(input);
		expect(framing).toContain(input.skillPath);
		expect(framing.length).toBeLessThan(2000);
	});

	it("hands over the resolved Orca binary", () => {
		expect(buildHandoffFraming(input)).toContain(input.orcaBinary);
	});

	it("forbids re-probing for Orca", () => {
		expect(buildHandoffFraming(input)).toContain("command -v");
	});

	it("requires approval before dispatch", () => {
		const framing = buildHandoffFraming(input);
		expect(framing.toLowerCase()).toContain("approval");
	});

	it("names the brief path it must write", () => {
		expect(buildHandoffFraming(input)).toContain(input.briefPath);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: FAIL, `briefPath` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `extensions/btw/handoff.ts`:

```typescript
export const HANDOFF_SKILL_PATH = `${process.env.HOME}/.agents/skills/handoff/SKILL.md`;
export const BRIEF_DIR = `${process.env.HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Oek Vault/Logs/handoffs`;

export function briefPath(task: string, today: string, briefDir: string): string {
	const slug = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60)
		.replace(/-$/, "");
	return `${briefDir}/${today}-${slug}.md`;
}

export type HandoffFramingInput = {
	task: string;
	orcaBinary: string;
	skillPath: string;
	briefPath: string;
};

export function buildHandoffFraming(input: HandoffFramingInput): string {
	return [
		"[Side conversation. The main session above is context only and is handled by another agent.]",
		"",
		"You are dispatching a handoff. Do the work in this order:",
		`1. Read ${input.skillPath} and follow it.`,
		`2. Draft the handoff brief using that skill's template and write it to ${input.briefPath}.`,
		"3. Show the brief and stop. Wait for the user's approval before dispatching. This is propose-first.",
		`4. On approval, dispatch with this already-resolved Orca binary: ${input.orcaBinary}`,
		"   Do not run `command -v orca` or search for the binary yourself. It has been resolved for you.",
		"5. Report the created worktree or terminal handle and the brief path.",
		"",
		"If dispatch fails, say so plainly and report the brief path. Never claim a session was created when it was not.",
		"",
		`Task: ${input.task}`,
	].join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Documents/Personal/pi-config/extensions/btw && npm test`
Expected: 42 passing.

- [ ] **Step 5: Register the command**

Add the import to `extensions/btw/index.ts`:

```typescript
import { BRIEF_DIR, briefPath, buildHandoffFraming, HANDOFF_SKILL_PATH, nodeOrcaProbeDeps, resolveOrcaBinary } from "./handoff.js";
```

Add the registration inside the default export:

```typescript
	pi.registerCommand("btw:handoff", {
		description: "Draft a handoff brief and dispatch an Orca session from the side thread",
		handler: async (args, ctx) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /btw:handoff <what needs doing>", "warning");
				return;
			}

			const orca = await resolveOrcaBinary(nodeOrcaProbeDeps());
			if (!orca.ok) {
				ctx.ui.notify(orca.reason, "error");
				return;
			}

			const today = new Date().toISOString().slice(0, 10);
			const framing = buildHandoffFraming({
				task,
				orcaBinary: orca.binary,
				skillPath: HANDOFF_SKILL_PATH,
				briefPath: briefPath(task, today, BRIEF_DIR),
			});

			await ensureOverlay(ctx);
			transcript = appendUserEntry(transcript, `handoff: ${task}`);
			overlay?.refresh();

			const active = await ensureSession(ctx, framing);
			if (thread.length > 0) {
				await active.session.prompt(framing, { source: "extension" });
			} else {
				await active.session.prompt("", { source: "extension" });
			}

			const answer = transcript.entries.filter((e) => e.role === "assistant").at(-1)?.text ?? "";
			const turn: BtwTurn = { question: `handoff: ${task}`, answer, kind: "handoff", timestamp: Date.now() };
			thread.push(turn);
			pi.appendEntry(BTW_TURN_ENTRY, turn);
		},
	});
```

- [ ] **Step 6: Write the extension README**

`extensions/btw/README.md`:

```markdown
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
```

- [ ] **Step 7: Manual end-to-end verification**

Run: `pi -e ~/Documents/Personal/pi-config/extensions/btw` from the vault.

1. `/btw:handoff add a --dry-run flag to the deploy script in <some repo>`
2. Confirm the side thread reads the handoff skill, drafts a brief, writes it to `Logs/handoffs/`, and **stops for approval**.
3. Reply "go" in the overlay.
4. Confirm a visible Orca session is created and the handle is reported.
5. Confirm the main transcript gained nothing.
6. Run `/btw:inject` and confirm the pointer reaches main.

- [ ] **Step 8: Update the handoff skill**

In `~/Documents/Personal/skills/skills/handoff/SKILL.md`, rewrite the Clean Dispatch section so `/btw:handoff` is the named mechanism instead of the forked `pi-subagents` subagent. Keep every existing rule intact: the executor is still a visible Orca session, propose-first is still the default, and the brief contract is unchanged. The only change is which mechanism authors the brief and spawns the session.

Replace the paragraph beginning "Dispatch a **forked-context** subagent" with a description of `/btw:handoff`, and update the "Rules for clean dispatch" bullets so they describe the side thread rather than the subagent. Leave the Common Mistakes row about background subagents in place, since it still applies.

- [ ] **Step 9: Commit and push both repos**

```bash
cd ~/Documents/Personal/pi-config
git add extensions/btw
git commit -m "btw: /btw:handoff dispatch and extension README"
git push

cd ~/Documents/Personal/skills
git add skills/handoff/SKILL.md
git commit -m "handoff: name /btw:handoff as the clean dispatch mechanism"
git push
```

- [ ] **Step 10: Install the extension permanently**

The manual steps above ran with `-e`. To load it in every session, add it to `~/.pi/agent/settings.json` under `extensions` (it is not auto-discovered because `pi-config/extensions` is symlinked as `~/.pi/agent/extensions`, so confirm first whether `~/.pi/agent/extensions/btw/index.ts` is already discovered by the subdirectory rule in `docs/extensions.md`). If it is auto-discovered, no settings change is needed. Verify with `/reload` followed by typing `/btw` and confirming the command exists.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Cache-aligned seeding | 2 (implementation + guard tests), 6 (live cache probe) |
| `appendEntry` persistence, not `sendMessage` | 3, plus Global Constraints |
| Module split (`index`/`side-session`/`thread`/`overlay`/`handoff`) | 1-8; `transcript.ts` was added as a sixth module so the overlay's state machine is testable apart from its rendering |
| Commands table | 6 (`/btw`, `/btw:clear`), 7 (`/btw:inject`, `/btw:summarize`), 8 (`/btw:handoff`) |
| Handoff flow: skill by reference, Orca pre-resolved, propose-first | 8 (framing tests assert all three), 1 (resolution) |
| Concurrency, `nonCapturing` overlay, focus toggle | 6 |
| Failure modes | 5 (no model), 6 (status line surfacing), 8 (Orca absent, framing forbids fabricating dispatch) |
| Testing harness | 1 |
| Handoff skill update | 8 Step 8 |
| Verification checks | 6 Step 4, 7 Step 6, 8 Step 7 |

**Known gaps, accepted deliberately:**

- The entry renderer that draws a dim line per exchange in the main transcript is specified but not implemented in any task. It is cosmetic and depends on `registerEntryRenderer` shape. **Add it as a step in Task 6 if the implementer wants it**, using the `registerEntryRenderer("btw-turn", …)` example at `docs/extensions.md:1593`; otherwise it can follow the plan.
- Main-compaction status messaging is specified but not tasked, because it needs a live compaction event to design against. Handle it after the cache probe in Task 6 settles whether the alignment rule survives at all.

**Type consistency:** `BtwTurn`, `SideSessionRuntime`, `TranscriptState`, `SeedContext`, `OrcaProbeDeps`, and `HandoffFramingInput` are each defined once and referenced with matching names in later tasks. `ensureSession`, `ensureOverlay`, and `ask` are defined in Task 6 and reused unchanged in Tasks 7 and 8.

**Note for the implementer:** the `ask()` and `ensureSession()` seeding interaction in Task 6 has a real wrinkle. The first framing is baked into the seed, so the first turn prompts with an empty string, while later turns prompt normally. If `session.prompt("")` turns out to be rejected by pi, change `createSideSession` to seed without the trailing framing and always prompt with it instead. That is a two-line change and the tests in Task 2 should be updated to match.
