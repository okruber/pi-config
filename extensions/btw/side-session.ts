import { createAgentSession, SessionManager, createExtensionRuntime, type AgentSession, type ResourceLoader } from "@earendil-works/pi-coding-agent";
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
