import { describe, expect, it } from "vitest";
import { resolveOrcaBinary, type OrcaProbeDeps } from "./handoff.js";

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
