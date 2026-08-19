import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BtwOverlay, matchesFocusShortcut } from "./overlay.js";
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

	pi.on("key", (event, data) => {
		if (overlay && matchesFocusShortcut(data)) {
			overlay.handle?.focus();
			event.preventDefault();
		}
	});
}
