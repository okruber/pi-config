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

export const HANDOFF_SKILL_PATH = `${process.env.HOME}/.agents/skills/handoff/SKILL.md`;
export const BRIEF_DIR = `${process.env.HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Oek Vault/Logs/handoffs`;

export function briefPath(task: string, today: string, briefDir: string): string {
	const slug = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60)
		.replace(/-$/, "");
	return `${briefDir}/${today}-${slug}.md`;
}

export type HandoffFramingInput = {
	task: string;
	orcaBinary: string;
	skillPath: string;
	briefPath: string;
};

export function buildHandoffFraming(input: HandoffFramingInput): string {
	return [
		"[Side conversation. The main session above is context only and is handled by another agent.]",
		"",
		"You are dispatching a handoff. Do the work in this order:",
		`1. Read ${input.skillPath} and follow it.`,
		`2. Draft the handoff brief using that skill's template and write it to ${input.briefPath}.`,
		"3. Show the brief and stop. Wait for the user's approval before dispatching. This is propose-first.",
		`4. On approval, dispatch with this already-resolved Orca binary: ${input.orcaBinary}`,
		"   Do not run `command -v orca` or search for the binary yourself. It has been resolved for you.",
		"5. Report the created worktree or terminal handle and the brief path.",
		"",
		"If dispatch fails, say so plainly and report the brief path. Never claim a session was created when it was not.",
		"",
		`Task: ${input.task}`,
	].join("\n");
}
