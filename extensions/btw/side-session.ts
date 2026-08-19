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
