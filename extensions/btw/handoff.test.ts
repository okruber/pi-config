import { describe, expect, it } from "vitest";
import { briefPath, buildHandoffFraming, resolveOrcaBinary, type OrcaProbeDeps } from "./handoff.js";

const APP_BUNDLE = "/Applications/Orca.app/Contents/Resources/bin/orca";

function deps(overrides: Partial<OrcaProbeDeps> = {}): OrcaProbeDeps {
	return {
		which: async () => null,
		isExecutable: async () => false,
		run: async () => ({ code: 1, stdout: "" }),
		...overrides,
	};
}

describe("resolveOrcaBinary", () => {
	it("uses the shim when it is executable and status succeeds", async () => {
		const result = await resolveOrcaBinary(
			deps({
				which: async () => "/usr/local/bin/orca",
				isExecutable: async (path) => path === "/usr/local/bin/orca",
				run: async () => ({ code: 0, stdout: '{"running":true}' }),
			}),
		);
		expect(result).toEqual({ ok: true, binary: "/usr/local/bin/orca" });
	});

	it("falls back to the app bundle when the shim is a dangling symlink", async () => {
		const result = await resolveOrcaBinary(
			deps({
				which: async () => "/usr/local/bin/orca",
				isExecutable: async (path) => path === APP_BUNDLE,
				run: async () => ({ code: 0, stdout: '{"running":true}' }),
			}),
		);
		expect(result).toEqual({ ok: true, binary: APP_BUNDLE });
	});

	it("falls back to the app bundle when the shim exists but status fails", async () => {
		const result = await resolveOrcaBinary(
			deps({
				which: async () => "/usr/local/bin/orca",
				isExecutable: async () => true,
				run: async (binary) => (binary === APP_BUNDLE ? { code: 0, stdout: "{}" } : { code: 127, stdout: "" }),
			}),
		);
		expect(result).toEqual({ ok: true, binary: APP_BUNDLE });
	});

	it("reports failure when neither candidate works", async () => {
		const result = await resolveOrcaBinary(deps());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("Orca");
		}
	});
});

describe("briefPath", () => {
	it("slugifies the task into a dated filename", () => {
		expect(briefPath("Fix the OAuth refresh loop", "2026-08-19", "/briefs")).toBe(
			"/briefs/2026-08-19-fix-the-oauth-refresh-loop.md",
		);
	});

	it("truncates very long tasks to a usable slug", () => {
		const path = briefPath("a".repeat(200), "2026-08-19", "/briefs");
		expect(path.length).toBeLessThan(120);
	});

	it("collapses punctuation and repeated separators", () => {
		expect(briefPath("Ship it!!  now, please", "2026-08-19", "/briefs")).toBe("/briefs/2026-08-19-ship-it-now-please.md");
	});
});

describe("buildHandoffFraming", () => {
	const input = {
		task: "Fix the OAuth refresh loop",
		orcaBinary: "/Applications/Orca.app/Contents/Resources/bin/orca",
		skillPath: "/Users/x/.agents/skills/handoff/SKILL.md",
		briefPath: "/briefs/2026-08-19-fix-the-oauth-refresh-loop.md",
	};

	it("points at the skill by path rather than inlining it", () => {
		const framing = buildHandoffFraming(input);
		expect(framing).toContain(input.skillPath);
		expect(framing.length).toBeLessThan(2000);
	});

	it("hands over the resolved Orca binary", () => {
		expect(buildHandoffFraming(input)).toContain(input.orcaBinary);
	});

	it("forbids re-probing for Orca", () => {
		expect(buildHandoffFraming(input)).toContain("command -v");
	});

	it("requires approval before dispatch", () => {
		const framing = buildHandoffFraming(input);
		expect(framing.toLowerCase()).toContain("approval");
	});

	it("names the brief path it must write", () => {
		expect(buildHandoffFraming(input)).toContain(input.briefPath);
	});
});
