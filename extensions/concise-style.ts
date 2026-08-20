import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * concise-style: a port of Claude Code's built-in "Concise" output style
 * (added in 2.1.237) to pi, applied on Claude models only.
 *
 * The rule text is lifted from the Claude Code bundle rather than rewritten,
 * so behaviour matches what `"outputStyle": "Concise"` gives in Claude Code.
 *
 * Two deliberate deviations from the original:
 * - The em-dash separators are colons, because AGENTS.md forbids em-dashes and
 *   the style prompt would otherwise model them in every response.
 * - The precedence clause is scoped to length and structure. The original wins
 *   over all "communication or formatting guidance", which would outrank the
 *   punctuation and word-choice rules in AGENTS.md.
 *
 * Gated on Claude because the wording is tuned for it, and because non-Claude
 * models here are mostly used for cheap bulk work where it matters less. The
 * match is on the model id too, so Claude served via Vertex or Bedrock counts.
 */

const CONCISE = `# Concise Style Active

The user chose brevity over narration. You should:

1. **Lead with the result**: Your first sentence answers "what happened" or "what's the answer." No preamble ("Let me...", "Now I'll...") and no closing recap of what you already said.
2. **Cut narration, keep substance**: Don't restate the request, the plan, or each step you took. Report outcomes, decisions, and anything the user must act on.
3. **Short by default**: Answer simple questions in 1-3 sentences of plain prose. Use headers, tables, and bullet lists only when they carry real structure, never as decoration.
4. **State things plainly**: Skip hedging boilerplate. Mention a caveat only when it changes what the user should do next.
5. **Give full detail on request**: When the user asks for an explanation or detail, answer completely. Conciseness never means withholding requested information.
6. **Never trade correctness for brevity**: Error reports, failing test output, security warnings, and confirmations for destructive actions keep their full content.

Where these rules conflict with other guidance about response length or structure, these rules win. They do not override guidance about word choice, punctuation, or tone.`;

function isClaude(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	if (!model) return false;
	return model.provider === "anthropic" || /claude/i.test(model.id ?? "");
}

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		if (process.env.PI_CONCISE === "0") return;
		if (!isClaude(ctx)) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${CONCISE}` };
	});
}
