import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ORCA_APP_BUNDLE_BINARY = "/Applications/Orca.app/Contents/Resources/bin/orca";

export type OrcaProbeDeps = {
	which: (command: string) => Promise<string | null>;
	isExecutable: (path: string) => Promise<boolean>;
	run: (binary: string, args: string[]) => Promise<{ code: number; stdout: string }>;
};

export type OrcaResolution = { ok: true; binary: string } | { ok: false; reason: string };

export async function resolveOrcaBinary(deps: OrcaProbeDeps): Promise<OrcaResolution> {
	const shim = await deps.which("orca");
	const candidates = [shim, ORCA_APP_BUNDLE_BINARY].filter((value): value is string => Boolean(value));

	for (const candidate of candidates) {
		if (!(await deps.isExecutable(candidate))) {
			continue;
		}
		const probe = await deps.run(candidate, ["status", "--json"]);
		if (probe.code === 0) {
			return { ok: true, binary: candidate };
		}
	}

	return {
		ok: false,
		reason: `Orca is not available. Tried ${candidates.join(", ") || "no candidates"}.`,
	};
}

export function nodeOrcaProbeDeps(): OrcaProbeDeps {
	return {
		which: async (command) => {
			try {
				const { stdout } = await execFileAsync("command", ["-v", command], { shell: "/bin/bash" });
				const path = stdout.trim();
				return path || null;
			} catch {
				return null;
			}
		},
		isExecutable: async (path) => {
			try {
				await access(path, constants.X_OK);
				return true;
			} catch {
				return false;
			}
		},
		run: async (binary, args) => {
			try {
				const { stdout } = await execFileAsync(binary, args);
				return { code: 0, stdout };
			} catch (error) {
				const code = typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1;
				return { code, stdout: "" };
			}
		},
	};
}
