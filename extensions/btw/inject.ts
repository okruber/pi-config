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
