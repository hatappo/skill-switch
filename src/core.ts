import { spawnSync } from "node:child_process";
import {
  cpSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const AGENTS = [
  "codex",
  "claude-code",
  "cursor",
  "github-copilot",
  "opencode",
  "gemini-cli",
] as const;
export const UNIVERSAL = "universal";
export const COLUMNS = [...AGENTS, UNIVERSAL] as const;
export type AgentName = (typeof AGENTS)[number];
export type ColumnName = (typeof COLUMNS)[number];
export const UNIVERSAL_TARGET_AGENTS = AGENTS.filter((agent) => agent !== "claude-code") as Exclude<
  AgentName,
  "claude-code"
>[];
export type SkillStatus = "on" | "off" | "mixed" | "-";
export const AGENT_LABELS: Record<AgentName, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  "github-copilot": "Copilot CLI",
  opencode: "OpenCode",
  "gemini-cli": "Gemini CLI",
};
export const COLUMN_LABELS: Record<ColumnName, string> = {
  ...AGENT_LABELS,
  universal: "Universal",
};
export const AGENT_COLUMN_WIDTHS: Record<AgentName, number> = {
  codex: 6,
  "claude-code": 11,
  cursor: 6,
  "github-copilot": 11,
  opencode: 8,
  "gemini-cli": 10,
};
export const COLUMN_WIDTHS: Record<ColumnName, number> = {
  ...AGENT_COLUMN_WIDTHS,
  universal: 9,
};
export const UNIVERSAL_SKILL_ROOT = [".agents", "skills"] as const;
export const AGENT_PRIMARY_SKILL_ROOTS: Record<AgentName, string[]> = {
  codex: [".codex", "skills"],
  "claude-code": [".claude", "skills"],
  cursor: [".cursor", "skills"],
  "github-copilot": [".copilot", "skills"],
  opencode: [".config", "opencode", "skills"],
  "gemini-cli": [".gemini", "skills"],
};
export const GH_MISSING_MESSAGE =
  "gh command not found. Install GitHub CLI and the gh skill extension first.";
export const GH_SKILL_MISSING_MESSAGE =
  "gh skill command is not available. Install or update the gh skill extension first.";

export type Frontmatter = {
  values: Record<string, string>;
  bounds: [number, number] | null;
};

const PORTABLE_SKILL_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

export type SkillProvenance = {
  repository: string;
  skillPath: string;
  pin?: string;
};

export type InstallCommand = {
  kind: "gh";
  agent: ColumnName;
  args: string[];
  command: string;
};

export type CopyInstallAction = {
  kind: "copy";
  agent: ColumnName;
  skillName: string;
  sourcePath: string;
  targetPath: string;
  command: string;
};

export type InstallAction = InstallCommand | CopyInstallAction;

export type SnapshotStatus = "on" | "off";
export type SkillSnapshot = {
  version: 1;
  skills: Record<string, Partial<Record<ColumnName, SnapshotStatus>>>;
};
export type SnapshotChange = {
  skill: string;
  agent: ColumnName;
  enabled: boolean;
};
export type SnapshotSkip = {
  skill: string;
  agent?: ColumnName;
  reason: string;
};
export type SnapshotPlan = {
  changes: SnapshotChange[];
  unchanged: SnapshotChange[];
  skipped: SnapshotSkip[];
};

export function parseSnapshot(text: string, source = "snapshot"): SkillSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(raw)) {
    throw new Error(`${source} must be a JSON object`);
  }
  if (raw.version !== 1) {
    throw new Error(`${source} version must be 1`);
  }
  if (!isRecord(raw.skills)) {
    throw new Error(`${source}.skills must be an object`);
  }

  const skills: SkillSnapshot["skills"] = {};
  for (const [skill, rawAgents] of Object.entries(raw.skills)) {
    if (!skill) {
      throw new Error(`${source}.skills contains an empty skill name`);
    }
    if (!isRecord(rawAgents)) {
      throw new Error(`${source}.skills.${skill} must be an object`);
    }

    const agents: Partial<Record<ColumnName, SnapshotStatus>> = {};
    for (const [agent, rawStatus] of Object.entries(rawAgents)) {
      if (!COLUMNS.includes(agent as ColumnName)) {
        throw new Error(`${source}.skills.${skill} has unsupported agent: ${agent}`);
      }
      if (rawStatus !== "on" && rawStatus !== "off") {
        throw new Error(`${source}.skills.${skill}.${agent} must be "on" or "off"`);
      }
      agents[agent as ColumnName] = rawStatus;
    }
    skills[skill] = agents;
  }

  return { version: 1, skills };
}

export function formatSnapshot(snapshot: SkillSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function checkGhCommand(command = "gh"): string | null {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error) {
    return result.error.message.includes("ENOENT")
      ? GH_MISSING_MESSAGE
      : `gh command check failed: ${result.error.message}`;
  }
  if (result.status !== 0) {
    return `gh command check failed with exit ${result.status ?? 1}.`;
  }

  const skillResult = spawnSync(command, ["skill", "install", "--help"], { stdio: "ignore" });
  if (skillResult.error) {
    return `gh skill command check failed: ${skillResult.error.message}`;
  }
  if (skillResult.status !== 0) {
    return GH_SKILL_MISSING_MESSAGE;
  }
  return null;
}

export class SkillInstance {
  readonly agent: ColumnName;
  readonly targetAgent: AgentName | null;
  readonly name: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly provenance: SkillProvenance | null;

  constructor(
    agent: ColumnName,
    name: string,
    path: string,
    enabled: boolean,
    provenance: SkillProvenance | null = null,
    targetAgent: AgentName | null = null,
  ) {
    this.agent = agent;
    this.targetAgent = targetAgent;
    this.name = name;
    this.path = path;
    this.enabled = enabled;
    this.provenance = provenance;
  }

  toJSON(): Record<string, unknown> {
    return {
      agent: this.agent,
      name: this.name,
      path: this.path,
      enabled: this.enabled,
      provenance: this.provenance,
      targetAgent: this.targetAgent,
    };
  }
}

export class SkillRow {
  readonly name: string;
  readonly instances: Record<ColumnName, SkillInstance[]> = createColumnRecord(() => []);

  constructor(name: string) {
    this.name = name;
  }

  status(column: ColumnName): SkillStatus {
    const items = this.instances[column];
    if (items.length === 0) {
      return "-";
    }
    const enabledCount = items.filter((item) => item.enabled).length;
    if (enabledCount === items.length) {
      return "on";
    }
    if (enabledCount === 0) {
      return "off";
    }
    return "mixed";
  }

  statusLabel(
    column: ColumnName,
    universalTargetAgents: AgentName[] = [...UNIVERSAL_TARGET_AGENTS],
  ): string {
    if (column === UNIVERSAL) {
      const targetAgentSet = new Set(universalTargetAgents);
      const items = this.instances[column].filter(
        (item) => item.targetAgent === null || targetAgentSet.has(item.targetAgent),
      );
      if (items.length === 0) {
        return "-";
      }
      const enabledCount = items.filter((item) => item.enabled).length;
      if (enabledCount === items.length) {
        return "ON";
      }
      if (enabledCount === 0) {
        return "OFF";
      }
      return `${enabledCount}/${items.length}`;
    }
    return formatStatus(this.status(column));
  }

  toJSON(columns: ColumnName[] = [...COLUMNS]): Record<string, unknown> {
    return {
      name: this.name,
      status: Object.fromEntries(columns.map((column) => [column, this.status(column)])),
      instances: Object.fromEntries(
        columns.map((column) => [column, this.instances[column].map((item) => item.toJSON())]),
      ),
    };
  }
}

export function discoverSkillFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = readDirectory(current);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        const parts = relative(root, path).split(sep);
        if (!parts.some((part) => part.startsWith("."))) {
          stack.push(path);
        }
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        result.push(path);
      }
    }
  }

  return result.sort();
}

function readDirectory(path: string): Dirent[] {
  return readdirSync(path, { withFileTypes: true });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined || firstLine.trim() !== "---") {
    return { values: {}, bounds: null };
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return { values: parseSimpleYaml(lines.slice(1, index)), bounds: [0, index] };
    }
  }

  return { values: {}, bounds: null };
}

function parseSimpleYaml(lines: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !line.includes(":")) {
      continue;
    }
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim();
    const value = rest
      .join(":")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) {
      values[key] = value;
    }
  }
  return values;
}

export function frontmatterName(path: string): string {
  try {
    return skillFrontmatter(path).name || basename(dirname(path));
  } catch {
    return basename(dirname(path));
  }
}

function skillFrontmatter(path: string): Record<string, string> {
  return parseFrontmatter(readFileSync(path, "utf8")).values;
}

export function provenanceFromFrontmatter(values: Record<string, string>): SkillProvenance | null {
  const rawRepository = values["github-repo"];
  const rawSkillPath = values["github-path"];
  if (!rawRepository || !rawSkillPath) {
    return null;
  }

  const repository = normalizeGitHubRepository(rawRepository);
  if (!repository) {
    return null;
  }

  const provenance: SkillProvenance = {
    repository,
    skillPath: normalizeSkillPath(rawSkillPath),
  };
  const pin = pinFromGitHubRef(values["github-ref"]);
  if (pin) {
    provenance.pin = pin;
  }
  return provenance;
}

function normalizeGitHubRepository(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (match) {
    return match[1];
  }
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return trimmed.replace(/\.git$/, "");
  }
  return null;
}

function normalizeSkillPath(value: string): string {
  return value.replace(/\/SKILL\.md$/, "");
}

function pinFromGitHubRef(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("refs/tags/")) {
    return value.slice("refs/tags/".length);
  }
  if (/^[0-9a-f]{7,40}$/i.test(value)) {
    return value;
  }
  return undefined;
}

function basename(path: string): string {
  const parts = path.split(sep);
  return parts.at(-1) || path;
}

export function updateFrontmatterKey(path: string, key: string, value: boolean): void {
  const text = readFileSync(path, "utf8");
  const lines = text.match(/^.*(?:\r?\n|$)/gm) ?? [];
  const boolText = value ? "true" : "false";

  const firstLine = lines[0];
  if (firstLine === undefined || firstLine.trim() !== "---") {
    const name = basename(dirname(path));
    writeFileSync(path, `---\nname: ${name}\n${key}: ${boolText}\n---\n\n${text}`, "utf8");
    return;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex < 0) {
    throw new Error(`frontmatter is not closed: ${path}`);
  }

  const pattern = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*:`);
  for (let index = 1; index < endIndex; index += 1) {
    const match = lines[index].match(pattern);
    if (match) {
      const newline = lines[index].endsWith("\n") ? "\n" : "";
      lines[index] = `${match[1]}${key}: ${boolText}${newline}`;
      writeFileSync(path, lines.join(""), "utf8");
      return;
    }
  }

  lines.splice(endIndex, 0, `${key}: ${boolText}\n`);
  writeFileSync(path, lines.join(""), "utf8");
}

export function removeFrontmatterKey(path: string, key: string): boolean {
  const text = readFileSync(path, "utf8");
  const lines = text.match(/^.*(?:\r?\n|$)/gm) ?? [];
  const firstLine = lines[0];
  if (firstLine === undefined || firstLine.trim() !== "---") {
    return false;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex < 0) {
    throw new Error(`frontmatter is not closed: ${path}`);
  }

  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  let removed = false;
  let keepCurrentBlock = true;
  const nextLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && index < endIndex) {
      if (!/^\s/.test(lines[index])) {
        keepCurrentBlock = !pattern.test(lines[index].trim());
        removed ||= !keepCurrentBlock;
      }
      if (!keepCurrentBlock) {
        continue;
      }
    }
    nextLines.push(lines[index]);
  }

  if (removed) {
    writeFileSync(path, nextLines.join(""), "utf8");
  }
  return removed;
}

export function sanitizeSkillFrontmatter(path: string): boolean {
  const text = readFileSync(path, "utf8");
  const lines = text.match(/^.*(?:\r?\n|$)/gm) ?? [];
  const firstLine = lines[0];
  if (firstLine === undefined || firstLine.trim() !== "---") {
    return false;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex < 0) {
    throw new Error(`frontmatter is not closed: ${path}`);
  }

  const filtered = filterPortableFrontmatterLines(lines.slice(1, endIndex));
  const nextText = [lines[0], ...filtered, ...lines.slice(endIndex)].join("");
  if (nextText === text) {
    return false;
  }

  writeFileSync(path, nextText, "utf8");
  return true;
}

function filterPortableFrontmatterLines(lines: string[]): string[] {
  const result: string[] = [];
  let keepCurrentBlock = true;

  for (const line of lines) {
    const key = topLevelYamlKey(line);
    if (key !== null) {
      keepCurrentBlock = PORTABLE_SKILL_FRONTMATTER_KEYS.has(key);
    }
    if (keepCurrentBlock) {
      result.push(line);
    }
  }

  return result;
}

function topLevelYamlKey(line: string): string | null {
  if (/^\s/.test(line)) {
    return null;
  }
  const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
  return match?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`expected JSON object in ${path}`);
  }
  return data as Record<string, unknown>;
}

function writeJson(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function addString(value: unknown, item: string): string[] {
  return [...new Set([...readStringArray(value), item])].sort();
}

function removeString(value: unknown, item: string): string[] {
  return readStringArray(value).filter((entry) => entry !== item);
}

function createColumnRecord<T>(factory: (column: ColumnName) => T): Record<ColumnName, T> {
  return Object.fromEntries(COLUMNS.map((column) => [column, factory(column)])) as Record<
    ColumnName,
    T
  >;
}

export function readCodexSkillEnabled(configPath: string): Map<string, boolean> {
  if (!existsSync(configPath)) {
    return new Map();
  }
  const entries = new Map<string, boolean>();
  const text = readFileSync(configPath, "utf8");
  for (const block of readTomlArrayBlocks(text, "[[skills.config]]")) {
    const path = parseTomlString(block, "path");
    if (!path) {
      continue;
    }
    const enabled = parseTomlBoolean(block, "enabled") ?? true;
    entries.set(resolve(path), enabled);
  }
  return entries;
}

function readTomlArrayBlocks(text: string, header: string): string[][] {
  const lines = text.split(/(?<=\n)/);
  const blocks: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== header) {
      continue;
    }
    const block = [lines[index]];
    index += 1;
    while (index < lines.length && !lines[index].trimStart().startsWith("[")) {
      block.push(lines[index]);
      index += 1;
    }
    index -= 1;
    blocks.push(block);
  }
  return blocks;
}

function parseTomlString(lines: string[], key: string): string | null {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(['"])(.*)\\1\\s*$`);
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) {
      return match[2];
    }
  }
  return null;
}

function parseTomlBoolean(lines: string[], key: string): boolean | null {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(true|false)\\s*$`);
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) {
      return match[1] === "true";
    }
  }
  return null;
}

export function setCodexSkillEnabled(
  configPath: string,
  skillPath: string,
  enabled: boolean,
): void {
  mkdirSync(dirname(configPath), { recursive: true });
  const target = resolve(skillPath);
  const lines = existsSync(configPath) ? readFileSync(configPath, "utf8").split(/(?<=\n)/) : [];
  const result: string[] = [];
  let found = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "[[skills.config]]") {
      result.push(lines[index]);
      continue;
    }

    const block = [lines[index]];
    index += 1;
    while (index < lines.length && !lines[index].trimStart().startsWith("[")) {
      block.push(lines[index]);
      index += 1;
    }
    index -= 1;

    const blockPath = parseTomlString(block, "path");
    if (blockPath && resolve(blockPath) === target) {
      result.push(...codexSkillBlock(target, enabled));
      found = true;
    } else {
      result.push(...block);
    }
  }

  if (!found) {
    if (result.length > 0 && !result.at(-1)!.endsWith("\n")) {
      result[result.length - 1] += "\n";
    }
    if (result.length > 0 && result.at(-1)!.trim()) {
      result.push("\n");
    }
    result.push(...codexSkillBlock(target, enabled));
  }

  writeFileSync(configPath, result.join(""), "utf8");
}

export function removeCodexSkillConfig(configPath: string, skillPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }
  const target = resolve(skillPath);
  const lines = readFileSync(configPath, "utf8").split(/(?<=\n)/);
  const result: string[] = [];
  let found = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "[[skills.config]]") {
      result.push(lines[index]);
      continue;
    }

    const block = [lines[index]];
    index += 1;
    while (index < lines.length && !lines[index].trimStart().startsWith("[")) {
      block.push(lines[index]);
      index += 1;
    }
    index -= 1;

    const blockPath = parseTomlString(block, "path");
    if (blockPath && resolve(blockPath) === target) {
      found = true;
    } else {
      result.push(...block);
    }
  }

  if (found) {
    writeFileSync(configPath, result.join(""), "utf8");
  }
}

function codexSkillBlock(path: string, enabled: boolean): string[] {
  return [
    "[[skills.config]]\n",
    `path = ${JSON.stringify(path)}\n`,
    `enabled = ${enabled ? "true" : "false"}\n`,
  ];
}

type Adapter = {
  discover(): SkillInstance[];
  isEnabled(instance: SkillInstance): boolean;
  setEnabled(instance: SkillInstance, enabled: boolean): void;
  remove?(instance: SkillInstance): void;
};

class CodexAdapter implements Adapter {
  readonly roots: string[];
  readonly configPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.roots = [join(home, ".codex", "skills")];
    this.configPath = join(home, ".codex", "config.toml");
  }

  discover(): SkillInstance[] {
    return this.roots.flatMap((root) =>
      discoverSkillFiles(root).map((path) => {
        const values = skillFrontmatter(path);
        const name = values.name || basename(dirname(path));
        return new SkillInstance(
          "codex",
          name,
          path,
          this.isEnabled(new SkillInstance("codex", name, path, true, null)),
          provenanceFromFrontmatter(values),
        );
      }),
    );
  }

  isEnabled(instance: SkillInstance): boolean {
    return readCodexSkillEnabled(this.configPath).get(resolve(instance.path)) ?? true;
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    if (enabled) {
      removeCodexSkillConfig(this.configPath, instance.path);
    } else {
      setCodexSkillEnabled(this.configPath, instance.path, false);
    }
  }

  remove(instance: SkillInstance): void {
    removeCodexSkillConfig(this.configPath, instance.path);
  }
}

class ClaudeAdapter implements Adapter {
  readonly root: string;
  readonly settingsPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.root = join(home, ".claude", "skills");
    this.settingsPath = join(home, ".claude", "settings.json");
  }

  discover(): SkillInstance[] {
    return discoverSkillFiles(this.root).map((path) => {
      const values = skillFrontmatter(path);
      const name = values.name || basename(dirname(path));
      return new SkillInstance(
        "claude-code",
        name,
        path,
        this.isEnabled(new SkillInstance("claude-code", name, path, true, null)),
        provenanceFromFrontmatter(values),
      );
    });
  }

  isEnabled(instance: SkillInstance): boolean {
    const settings = readJson(this.settingsPath);
    const overrides = readObject(settings.skillOverrides);
    return overrides[instance.name] !== "off";
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    const settings = readJson(this.settingsPath);
    const overrides = readObject(settings.skillOverrides);
    if (enabled) {
      delete overrides[instance.name];
    } else {
      overrides[instance.name] = "off";
    }
    settings.skillOverrides = overrides;
    writeJson(this.settingsPath, settings);
  }

  remove(instance: SkillInstance): void {
    if (!existsSync(this.settingsPath)) {
      return;
    }
    const settings = readJson(this.settingsPath);
    const overrides = readObject(settings.skillOverrides);
    if (!(instance.name in overrides)) {
      return;
    }
    delete overrides[instance.name];
    settings.skillOverrides = overrides;
    writeJson(this.settingsPath, settings);
  }
}

class CursorAdapter implements Adapter {
  readonly root: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.root = join(home, ".cursor", "skills");
  }

  discover(): SkillInstance[] {
    return discoverSkillFiles(this.root).map((path) => {
      const values = skillFrontmatter(path);
      const name = values.name || basename(dirname(path));
      return new SkillInstance(
        "cursor",
        name,
        path,
        this.isEnabled(new SkillInstance("cursor", name, path, true, null)),
        provenanceFromFrontmatter(values),
      );
    });
  }

  isEnabled(instance: SkillInstance): boolean {
    const disabled =
      skillFrontmatter(instance.path)["disable-model-invocation"]?.toLowerCase() === "true";
    return !disabled;
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    if (enabled) {
      removeFrontmatterKey(instance.path, "disable-model-invocation");
    } else {
      updateFrontmatterKey(instance.path, "disable-model-invocation", true);
    }
  }

  remove(_instance: SkillInstance): void {}
}

class CopilotAdapter implements Adapter {
  readonly roots: string[];
  readonly settingsPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.roots = [join(home, ".copilot", "skills")];
    this.settingsPath = join(home, ".copilot", "settings.json");
  }

  discover(): SkillInstance[] {
    return this.roots.flatMap((root) =>
      discoverSkillFiles(root).map((path) => {
        const values = skillFrontmatter(path);
        const name = values.name || basename(dirname(path));
        return new SkillInstance(
          "github-copilot",
          name,
          path,
          this.isEnabled(new SkillInstance("github-copilot", name, path, true, null)),
          provenanceFromFrontmatter(values),
        );
      }),
    );
  }

  isEnabled(instance: SkillInstance): boolean {
    const settings = readJson(this.settingsPath);
    return !new Set(readStringArray(settings.disabledSkills)).has(instance.name);
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    const settings = readJson(this.settingsPath);
    settings.disabledSkills = enabled
      ? removeString(settings.disabledSkills, instance.name)
      : addString(settings.disabledSkills, instance.name);
    writeJson(this.settingsPath, settings);
  }

  remove(instance: SkillInstance): void {
    if (!existsSync(this.settingsPath)) {
      return;
    }
    const settings = readJson(this.settingsPath);
    if (!readStringArray(settings.disabledSkills).includes(instance.name)) {
      return;
    }
    settings.disabledSkills = removeString(settings.disabledSkills, instance.name);
    writeJson(this.settingsPath, settings);
  }
}

class OpenCodeAdapter implements Adapter {
  readonly roots: string[];
  readonly configPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.roots = [join(home, ".config", "opencode", "skills")];
    this.configPath = join(home, ".config", "opencode", "opencode.json");
  }

  discover(): SkillInstance[] {
    return this.roots.flatMap((root) =>
      discoverSkillFiles(root).map((path) => {
        const values = skillFrontmatter(path);
        const name = values.name || basename(dirname(path));
        return new SkillInstance(
          "opencode",
          name,
          path,
          this.isEnabled(new SkillInstance("opencode", name, path, true, null)),
          provenanceFromFrontmatter(values),
        );
      }),
    );
  }

  isEnabled(instance: SkillInstance): boolean {
    const config = readJson(this.configPath);
    return skillPermissionFor(readSkillPermissions(config), instance.name) !== "deny";
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    const config = readJson(this.configPath);
    const permission = readObject(config.permission);
    const skill = readObject(permission.skill);
    skill[instance.name] = enabled ? "allow" : "deny";
    permission.skill = skill;
    config.permission = permission;
    writeJson(this.configPath, config);
  }

  remove(instance: SkillInstance): void {
    if (!existsSync(this.configPath)) {
      return;
    }
    const config = readJson(this.configPath);
    const permission = readObject(config.permission);
    const skill = readObject(permission.skill);
    if (!(instance.name in skill)) {
      return;
    }
    delete skill[instance.name];
    permission.skill = skill;
    config.permission = permission;
    writeJson(this.configPath, config);
  }
}

class GeminiAdapter implements Adapter {
  readonly root: string;
  readonly settingsPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.root = join(home, ".gemini", "skills");
    this.settingsPath = join(home, ".gemini", "settings.json");
  }

  discover(): SkillInstance[] {
    return discoverSkillFiles(this.root).map((path) => {
      const values = skillFrontmatter(path);
      const name = values.name || basename(dirname(path));
      return new SkillInstance(
        "gemini-cli",
        name,
        path,
        this.isEnabled(new SkillInstance("gemini-cli", name, path, true, null)),
        provenanceFromFrontmatter(values),
      );
    });
  }

  isEnabled(instance: SkillInstance): boolean {
    const settings = readJson(this.settingsPath);
    const skills = readObject(settings.skills);
    const globallyEnabled = skills.enabled !== false;
    const disabled = new Set(readStringArray(skills.disabled));
    return globallyEnabled && !disabled.has(instance.name);
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    const settings = readJson(this.settingsPath);
    const skills = readObject(settings.skills);
    if (enabled) {
      skills.enabled = true;
      skills.disabled = removeString(skills.disabled, instance.name);
    } else {
      skills.disabled = addString(skills.disabled, instance.name);
    }
    settings.skills = skills;
    writeJson(this.settingsPath, settings);
  }

  remove(instance: SkillInstance): void {
    if (!existsSync(this.settingsPath)) {
      return;
    }
    const settings = readJson(this.settingsPath);
    const skills = readObject(settings.skills);
    if (!readStringArray(skills.disabled).includes(instance.name)) {
      return;
    }
    skills.disabled = removeString(skills.disabled, instance.name);
    settings.skills = skills;
    writeJson(this.settingsPath, settings);
  }
}

type SkillPermissionValue = "allow" | "ask" | "deny";
type SkillPermissions = SkillPermissionValue | Record<string, unknown>;

function readSkillPermissions(config: Record<string, unknown>): SkillPermissions {
  const permission = readObject(config.permission);
  const skill = permission.skill;
  if (skill === "allow" || skill === "ask" || skill === "deny") {
    return skill;
  }
  return readObject(skill);
}

function skillPermissionFor(
  permissions: SkillPermissions,
  skillName: string,
): SkillPermissionValue {
  if (typeof permissions === "string") {
    return permissions;
  }

  const exact = permissionValue(permissions[skillName]);
  if (exact) {
    return exact;
  }

  for (const [pattern, rawValue] of Object.entries(permissions)) {
    if (globMatches(pattern, skillName)) {
      const value = permissionValue(rawValue);
      if (value) {
        return value;
      }
    }
  }
  return "allow";
}

function permissionValue(value: unknown): SkillPermissionValue | null {
  if (value === "allow" || value === "ask" || value === "deny") {
    return value;
  }
  return null;
}

function globMatches(pattern: string, value: string): boolean {
  const regexp = new RegExp(`^${escapeRegExp(pattern).replaceAll("\\*", ".*")}$`);
  return regexp.test(value);
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export class SkillManager {
  readonly home: string;
  readonly adapters: Record<AgentName, Adapter>;

  constructor(home: string) {
    const resolvedHome = resolve(home);
    this.home = resolvedHome;
    this.adapters = {
      codex: new CodexAdapter(resolvedHome),
      "claude-code": new ClaudeAdapter(resolvedHome),
      cursor: new CursorAdapter(resolvedHome),
      "github-copilot": new CopilotAdapter(resolvedHome),
      opencode: new OpenCodeAdapter(resolvedHome),
      "gemini-cli": new GeminiAdapter(resolvedHome),
    };
  }

  activeColumns(): ColumnName[] {
    return COLUMNS.filter((column) => isDirectory(this.skillRoot(column)));
  }

  activeUniversalTargetAgents(): AgentName[] {
    const active = new Set(this.activeColumns());
    return UNIVERSAL_TARGET_AGENTS.filter((agent) => active.has(agent));
  }

  skillRoot(column: ColumnName): string {
    const parts = column === UNIVERSAL ? UNIVERSAL_SKILL_ROOT : AGENT_PRIMARY_SKILL_ROOTS[column];
    return join(this.home, ...parts);
  }

  discoverUniversal(): SkillInstance[] {
    return discoverSkillFiles(this.skillRoot(UNIVERSAL)).flatMap((path) => {
      const values = skillFrontmatter(path);
      const name = values.name || basename(dirname(path));
      const provenance = provenanceFromFrontmatter(values);
      return UNIVERSAL_TARGET_AGENTS.map((agent) => {
        const instance = new SkillInstance(agent, name, path, true, provenance);
        return new SkillInstance(
          UNIVERSAL,
          name,
          path,
          this.adapters[agent].isEnabled(instance),
          provenance,
          agent,
        );
      });
    });
  }

  scan(): SkillRow[] {
    const rows = new Map<string, SkillRow>();
    for (const instance of this.discoverUniversal()) {
      const row = rows.get(instance.name) ?? new SkillRow(instance.name);
      row.instances.universal.push(instance);
      rows.set(instance.name, row);
    }
    for (const agent of AGENTS) {
      for (const instance of this.adapters[agent].discover()) {
        const row = rows.get(instance.name) ?? new SkillRow(instance.name);
        row.instances[agent].push(instance);
        rows.set(instance.name, row);
      }
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  createSnapshot(rows = this.scan(), columns = this.activeColumns()): SkillSnapshot {
    const skills: SkillSnapshot["skills"] = {};
    for (const row of rows) {
      const agents: Partial<Record<ColumnName, SnapshotStatus>> = {};
      for (const agent of columns) {
        const status = row.status(agent);
        if (status === "on" || status === "off") {
          agents[agent] = status;
        }
      }
      if (Object.keys(agents).length > 0) {
        skills[row.name] = agents;
      }
    }
    return { version: 1, skills };
  }

  planSnapshot(snapshot: SkillSnapshot): SnapshotPlan {
    const rows = new Map(this.scan().map((row) => [row.name, row]));
    const active = new Set(this.activeColumns());
    const changes: SnapshotChange[] = [];
    const unchanged: SnapshotChange[] = [];
    const skipped: SnapshotSkip[] = [];

    for (const [skill, agents] of Object.entries(snapshot.skills)) {
      const row = rows.get(skill);
      for (const [agent, status] of Object.entries(agents) as [ColumnName, SnapshotStatus][]) {
        if (!active.has(agent)) {
          skipped.push({ skill, agent, reason: "agent skill folder does not exist" });
          continue;
        }
        if (!row) {
          skipped.push({ skill, agent, reason: "skill is not installed" });
          continue;
        }

        const current = row.status(agent);
        if (current === "-") {
          skipped.push({ skill, agent, reason: "skill is not installed for agent" });
          continue;
        }

        const enabled = status === "on";
        const change = { skill, agent, enabled };
        if (current === status) {
          unchanged.push(change);
        } else {
          changes.push(change);
        }
      }
    }

    return { changes, unchanged, skipped };
  }

  applySnapshot(snapshot: SkillSnapshot): SnapshotPlan {
    const plan = this.planSnapshot(snapshot);
    for (const change of plan.changes) {
      this.applyState(change.skill, [change.agent], change.enabled);
    }
    return plan;
  }

  applyState(skillName: string, agents: ColumnName[], enabled: boolean): ColumnName[] {
    const row = this.scan().find((item) => item.name === skillName);
    if (!row) {
      return [];
    }

    const changed: ColumnName[] = [];
    for (const agent of agents) {
      const instances = row.instances[agent];
      if (instances.length === 0) {
        continue;
      }
      if (agent === UNIVERSAL) {
        const instance = instances[0];
        this.setUniversalEnabled(instance, enabled);
      } else {
        for (const instance of instances) {
          this.adapters[agent].setEnabled(instance, enabled);
        }
      }
      changed.push(agent);
    }
    return changed;
  }

  private setUniversalEnabled(instance: SkillInstance, enabled: boolean): void {
    for (const agent of UNIVERSAL_TARGET_AGENTS) {
      this.adapters[agent].setEnabled(
        new SkillInstance(agent, instance.name, instance.path, true, instance.provenance),
        enabled,
      );
    }
  }

  deleteTargets(skillName: string): string[] {
    const row = this.scan().find((item) => item.name === skillName);
    return row ? uniqueSkillDirectories(row) : [];
  }

  deleteSkill(skillName: string): string[] {
    const row = this.scan().find((item) => item.name === skillName);
    if (!row) {
      return [];
    }

    for (const agent of AGENTS) {
      for (const instance of row.instances[agent]) {
        this.adapters[agent].remove?.(instance);
      }
    }
    for (const instance of uniqueInstances(row.instances.universal)) {
      for (const agent of UNIVERSAL_TARGET_AGENTS) {
        this.adapters[agent].remove?.(
          new SkillInstance(agent, instance.name, instance.path, true, instance.provenance),
        );
      }
    }

    const targets = uniqueSkillDirectories(row);
    for (const target of targets) {
      rmSync(target, { recursive: true, force: true });
    }
    return targets;
  }

  buildInstallMissingCommands(skillName: string, agents?: ColumnName[]): InstallCommand[] {
    const actions = this.buildInstallMissingActions(skillName, agents);
    if (actions.some((action) => action.kind === "copy")) {
      throw new Error(`No GitHub provenance metadata found for ${JSON.stringify(skillName)}.`);
    }
    return actions.filter((action): action is InstallCommand => action.kind === "gh");
  }

  buildInstallMissingActions(skillName: string, agents?: ColumnName[]): InstallAction[] {
    const row = this.scan().find((item) => item.name === skillName);
    if (!row) {
      throw new Error(`No installed skill named ${JSON.stringify(skillName)}.`);
    }

    const targetAgents = agents ?? this.activeColumns();
    const missingAgents = targetAgents.filter((agent) => row.instances[agent].length === 0);
    if (missingAgents.length === 0) {
      return [];
    }

    const source = COLUMNS.flatMap((agent) => row.instances[agent]).find(
      (instance) => instance.provenance !== null,
    )?.provenance;
    if (source) {
      return missingAgents.map((agent) => {
        const args = [
          "skill",
          "install",
          source.repository,
          source.skillPath,
          "--scope",
          "user",
          "--agent",
          agent,
        ];
        if (source.pin) {
          args.push("--pin", source.pin);
        }
        return {
          kind: "gh",
          agent,
          args,
          command: ["gh", ...args].map(shellQuote).join(" "),
        };
      });
    }

    const copySource = COLUMNS.flatMap((agent) => row.instances[agent])[0];
    if (!copySource) {
      throw new Error(`No installed skill named ${JSON.stringify(skillName)}.`);
    }

    const sourceDirectory = resolve(dirname(copySource.path));
    const directoryName = basename(sourceDirectory);
    return missingAgents.map((agent) => {
      const root = agent === UNIVERSAL ? UNIVERSAL_SKILL_ROOT : AGENT_PRIMARY_SKILL_ROOTS[agent];
      const targetPath = join(this.home, ...root, directoryName);
      return {
        kind: "copy",
        agent,
        skillName,
        sourcePath: sourceDirectory,
        targetPath,
        command: `copy ${sourceDirectory} -> ${targetPath}`,
      };
    });
  }

  executeInstallAction(action: InstallAction): void {
    if (action.kind === "gh") {
      const result = spawnSync("gh", action.args, { stdio: "inherit" });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`gh skill install failed with exit ${result.status ?? 1}`);
      }
      return;
    }

    if (existsSync(action.targetPath)) {
      throw new Error(`target skill directory already exists: ${action.targetPath}`);
    }
    mkdirSync(dirname(action.targetPath), { recursive: true });
    cpSync(action.sourcePath, action.targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });

    const copiedSkillPath = join(action.targetPath, "SKILL.md");
    sanitizeSkillFrontmatter(copiedSkillPath);

    if (action.agent !== UNIVERSAL) {
      this.adapters[action.agent].remove?.(
        new SkillInstance(action.agent, action.skillName, copiedSkillPath, true, null),
      );
    } else {
      this.setUniversalEnabled(
        new SkillInstance(UNIVERSAL, action.skillName, copiedSkillPath, true, null),
        true,
      );
    }
  }

  formatTable(
    rows = this.scan(),
    columns = this.activeColumns(),
    universalTargetAgents = this.activeUniversalTargetAgents(),
  ): string {
    const nameWidth = Math.max("Skill".length, ...rows.map((row) => row.name.length));
    const lines = [
      [
        "Skill".padEnd(nameWidth),
        ...columns.map((column) => COLUMN_LABELS[column].padEnd(COLUMN_WIDTHS[column])),
      ].join("  "),
      ["-".repeat(nameWidth), ...columns.map((column) => "-".repeat(COLUMN_WIDTHS[column]))].join(
        "  ",
      ),
    ];
    for (const row of rows) {
      const values = columns.map((column) => row.statusLabel(column, universalTargetAgents));
      lines.push(
        [
          row.name.padEnd(nameWidth),
          ...columns.map((column, index) => values[index].padEnd(COLUMN_WIDTHS[column])),
        ].join("  "),
      );
    }
    return lines.join("\n");
  }
}

function uniqueSkillDirectories(row: SkillRow): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const column of COLUMNS) {
    for (const instance of row.instances[column]) {
      const target = resolve(dirname(instance.path));
      if (!seen.has(target)) {
        seen.add(target);
        targets.push(target);
      }
    }
  }
  return targets;
}

function uniqueInstances(instances: SkillInstance[]): SkillInstance[] {
  const seen = new Set<string>();
  const result: SkillInstance[] = [];
  for (const instance of instances) {
    const key = resolve(instance.path);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(instance);
    }
  }
  return result;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatStatus(status: SkillStatus): string {
  return {
    on: "ON",
    off: "OFF",
    mixed: "MIX",
    "-": "-",
  }[status];
}
