// Auto-continue after provider errors. OpenRouter upstreams sometimes drop
// mid-stream: pi retries, gives up, and the session hangs until the user
// types "continue". Hook agent_settled: when the run ends with an error
// stopReason, inject a continue prompt as if the user typed it. Capped so a
// dead provider cannot spin forever. User aborts (stopReason "aborted") and
// manual input both suppress/reset the counter.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_AUTO_CONTINUES = 5;
const CONTINUE_PROMPT =
	"The previous response aborted with a provider error and is incomplete. Resume from where you left off.";

export default function (pi: ExtensionAPI) {
	let autoContinues = 0;

	pi.on("input", (event) => {
		if (event.source === "interactive" || event.source === "rpc") {
			autoContinues = 0;
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const branch = ctx.sessionManager.getBranch();
		let lastAssistant:
			| { role: string; stopReason?: string; errorMessage?: string }
			| undefined;

		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type === "message" && (entry as any).message?.role === "assistant") {
				lastAssistant = (entry as any).message;
				break;
			}
		}
		if (!lastAssistant) return;

		if (lastAssistant.stopReason !== "error") {
			autoContinues = 0;
			ctx.ui.setStatus("auto-continue", undefined);
			return;
		}

		if (autoContinues >= MAX_AUTO_CONTINUES) {
			ctx.ui.setStatus("auto-continue", undefined);
			ctx.ui.notify(
				`auto-continue: provider still failing after ${MAX_AUTO_CONTINUES} retries. Giving up.`,
				"warning",
			);
			return;
		}

		autoContinues++;
		const detail = lastAssistant.errorMessage
			? `: ${lastAssistant.errorMessage.slice(0, 120)}`
			: "";
		ctx.ui.setStatus(
			"auto-continue",
			`auto-continue ${autoContinues}/${MAX_AUTO_CONTINUES}`,
		);
		ctx.ui.notify(
			`Provider error${detail} — auto-continuing (${autoContinues}/${MAX_AUTO_CONTINUES})`,
			"warning",
		);
		pi.sendUserMessage(CONTINUE_PROMPT);
	});
}
