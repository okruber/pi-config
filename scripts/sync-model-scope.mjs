#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsPath = path.join(repoDir, "settings.json");
const scopedModelsPath = path.join(repoDir, "scoped-models.json");
const checkOnly = process.argv.includes("--check");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const scopedConfig = readJson(scopedModelsPath);
if (!Array.isArray(scopedConfig.models) || scopedConfig.models.length === 0 || scopedConfig.models.some((model) => typeof model !== "string" || !model)) {
  throw new Error("scoped-models.json must contain a non-empty models array of strings.");
}
if (new Set(scopedConfig.models).size !== scopedConfig.models.length) {
  throw new Error("scoped-models.json must not contain duplicate model IDs.");
}
if (scopedConfig.models.some((model) => model === "inherit" || model.includes("*"))) {
  throw new Error("scoped-models.json must contain exact model IDs, not inherit or wildcard patterns.");
}

const settingsText = fs.readFileSync(settingsPath, "utf8");
const settings = JSON.parse(settingsText);
const currentScope = settings.subagents?.modelScope;
const models = scopedConfig.models;
const synchronized =
  JSON.stringify(settings.enabledModels) === JSON.stringify(models) &&
  currentScope?.enforce === true &&
  currentScope?.strict === true &&
  JSON.stringify(currentScope.allow) === JSON.stringify(models);

if (checkOnly) {
  if (!synchronized) {
    console.error("Model settings are out of sync with scoped-models.json.");
    process.exitCode = 1;
  } else {
    console.log("Model settings are synchronized.");
  }
} else {
  settings.enabledModels = models;
  settings.subagents ??= {};
  settings.subagents.modelScope = {
    ...(settings.subagents.modelScope ?? {}),
    enforce: true,
    strict: true,
    allow: models,
  };
  const updatedSettingsText = `${JSON.stringify(settings, null, 2)}\n`;
  if (updatedSettingsText !== settingsText) {
    fs.writeFileSync(settingsPath, updatedSettingsText);
    console.log("Synchronized settings.json from scoped-models.json.");
  } else {
    console.log("settings.json is already synchronized.");
  }
}
