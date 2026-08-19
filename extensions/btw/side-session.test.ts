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
