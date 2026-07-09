import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

export type Verdict = "good" | "junk" | "miscategorized";

export interface MemoryRecord {
  id: string;
  category: string;
  namespace: string;
  created: string;
  updated: string;
  tags: string[];
  confidence: number | null;
  status: string | null;
  lifecycleState: string | null;
  path: string;
  preview: string;
  size: number;
}

// Plural on-disk category dirs treated as discrete memories.
export const CATEGORY_DIRS = [
  "decisions", "facts", "questions", "entities", "corrections",
  "preferences", "principles", "rules", "commitments", "artifacts", "procedures",
];

const SKIP_DIRS = new Set(["state", ".registry", "config", "identity", "summaries", "reasoning-traces", "transcripts", "checkpoints"]);

export function parseFrontmatter(text: string): { fm: Record<string, any>; body: string } {
  const fm: Record<string, any> = {};
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      const block = text.slice(3, end);
      body = text.slice(end + 4);
      let lastKey: string | null = null;
      for (const raw of block.split(/\r?\n/)) {
        const line = raw.replace(/\r$/, "");
        const listItem = line.match(/^\s*-\s+(.*)$/);
        if (listItem && lastKey) {
          if (!Array.isArray(fm[lastKey])) fm[lastKey] = [];
          fm[lastKey].push(stripQuotes(listItem[1].trim()));
          continue;
        }
        const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        const val = m[2].trim();
        lastKey = key;
        if (val === "") { fm[key] = fm[key] ?? []; continue; }
        if (val.startsWith("[") && val.endsWith("]")) {
          fm[key] = val.slice(1, -1).split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
        } else {
          fm[key] = stripQuotes(val);
        }
      }
    }
  }
  return { fm, body };
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

export function classifyPath(relPath: string): { categoryDir: string; namespace: string } | null {
  const parts = relPath.split(sep).filter(Boolean);
  if (parts.length < 2) return null;
  let categoryDir: string;
  let namespace: string;
  if (parts[0] === "namespaces") {
    if (parts.length < 4) return null;
    namespace = parts[1];
    categoryDir = parts[2];
  } else {
    namespace = "default";
    categoryDir = parts[0];
  }
  if (SKIP_DIRS.has(categoryDir)) return null;
  if (!CATEGORY_DIRS.includes(categoryDir)) return null;
  return { categoryDir, namespace };
}

function singular(categoryDir: string): string {
  return categoryDir.replace(/s$/, "");
}

function cleanPreview(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("[Attributes:") && !l.startsWith("**Context:**") && !l.startsWith("#")) || "";
  return line.replace(/\s+/g, " ").trim();
}

export function parseMemoryFile(absPath: string, memoryDir: string): MemoryRecord | null {
  const rel = absPath.startsWith(memoryDir) ? absPath.slice(memoryDir.length).replace(/^[/\\]+/, "") : absPath;
  const cls = classifyPath(rel);
  if (!cls) return null;
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const { fm, body } = parseFrontmatter(text);
  const conf = fm.confidence != null && fm.confidence !== "" ? Number(fm.confidence) : null;
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    size = Buffer.byteLength(text, "utf8");
  }
  return {
    id: String(fm.id || rel),
    category: typeof fm.category === "string" && fm.category ? fm.category : singular(cls.categoryDir),
    namespace: cls.namespace,
    created: String(fm.created || ""),
    updated: String(fm.updated || fm.created || ""),
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    confidence: Number.isFinite(conf as number) ? (conf as number) : null,
    status: fm.status ? String(fm.status) : null,
    lifecycleState: fm.lifecycleState ? String(fm.lifecycleState) : (fm.lifecycle_state ? String(fm.lifecycle_state) : null),
    path: absPath,
    preview: cleanPreview(body),
    size,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

export function scanMemories(memoryDir: string): MemoryRecord[] {
  const out: MemoryRecord[] = [];
  for (const file of walk(memoryDir)) {
    const rec = parseMemoryFile(file, memoryDir);
    if (rec) out.push(rec);
  }
  return out;
}

export function readMemoryBody(absPath: string): string {
  try {
    return parseFrontmatter(readFileSync(absPath, "utf8")).body.trim();
  } catch {
    return "";
  }
}

export function dirSizeBytes(memoryDir: string): number {
  let total = 0;
  for (const file of walk(memoryDir)) {
    try { total += statSync(file).size; } catch { /* skip */ }
  }
  return total;
}
