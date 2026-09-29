// Catches turns that end by handing Olle a step the agent could run itself
// ("you can now open a PR", "want me to push?") and forces one more turn.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_NUDGES_PER_PROMPT = 2;
const TAIL_CHARS = 800;

const HANDOFF_PATTERNS: RegExp[] = [
	/\byou(?:'ll| will)? (?:can|could|should|need to|may want to|might want to|'ll want to)(?: now| then| just)? (?:run|open|create|push|commit|merge|execute|install|restart|reload|paste|copy|add|apply|deploy|trigger|submit|raise|file|rebase|update|edit|delete|rename|move)\b/i,
	/\b(?:run|execute|paste|apply) (?:the following|this command|these commands|this in)\b/i,
	/\b(?:want|would you like|shall|should) (?:me to|i)\b[^?\n]*\?/i,
	/\blet me know (?:if|when) you(?:'d| would)? (?:like|want)\b/i,
	/\b(?:once|after) you(?:'ve| have)? (?:run|opened|created|pushed|merged|applied)\b/i,
	/^\s*(?:#+\s*)?next steps?\b/im,
];

const HOW_TO_PROMPT = /^\s*(?:how (?:do|can|should|would) (?:i|we)|how to|what(?:'s| is) the command)\b/i;

const NUDGE = [
	"Your last message handed Olle a step you can do yourself with your tools, or asked permission for a step inside the agreed scope.",
	"Do that step now, and keep going until the change is implemented and verified. Opening a pull request, committing, and pushing are yours to do.",
	"Stop only if the step needs a credential, a login, a physical action, a decision Olle has not made, or a destructive action outside the agreed scope. In that case, reply with one sentence naming the blocker.",
	"If Olle asked for instructions rather than action, reply with one line: \"No action needed.\"",
].join(" ");

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c: any) => c?.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

export default function (pi: ExtensionAPI) {
	let nudges = 0;
	let lastPrompt = "";

	pi.on("input", (event: any) => {
		if (event.source === "interactive" || event.source === "rpc") {
			nudges = 0;
			lastPrompt = typeof event.text === "string" ? event.text : "";
		}
	});

	pi.on("agent_before_settle", (event) => {
		if (event.outcome !== "completed") return;
		if (nudges >= MAX_NUDGES_PER_PROMPT) return;
		if (HOW_TO_PROMPT.test(lastPrompt)) return;

		const messages = event.context.llmMessages;
		const last = messages[messages.length - 1] as any;
		if (!last || last.role !== "assistant" || last.stopReason !== "stop") return;

		const tail = textOf(last.content).slice(-TAIL_CHARS);
		if (!HANDOFF_PATTERNS.some((re) => re.test(tail))) return;

		nudges++;
		return {
			entries: [
				{
					type: "custom_message",
					customType: "finish-the-job",
					content: NUDGE,
					display: true,
				},
			],
			continue: true,
		};
	});
}
