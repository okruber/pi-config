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
