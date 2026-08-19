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
