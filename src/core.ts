import { spawnSync } from "node:child_process";
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
export type AgentName = (typeof AGENTS)[number];
export type SkillStatus = "on" | "off" | "mixed" | "-";
export const AGENT_LABELS: Record<AgentName, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  "github-copilot": "Copilot CLI",
  opencode: "OpenCode",
  "gemini-cli": "Gemini CLI",
};
export const AGENT_COLUMN_WIDTHS: Record<AgentName, number> = {
  codex: 6,
  "claude-code": 11,
  cursor: 6,
  "github-copilot": 11,
  opencode: 8,
  "gemini-cli": 10,
};
export const GH_MISSING_MESSAGE =
  "gh command not found. Install GitHub CLI and the gh skill extension first.";
export const GH_SKILL_MISSING_MESSAGE =
  "gh skill command is not available. Install or update the gh skill extension first.";

export type Frontmatter = {
  values: Record<string, string>;
  bounds: [number, number] | null;
};

export type SkillProvenance = {
  repository: string;
  skillPath: string;
  pin?: string;
};

export type InstallCommand = {
  agent: AgentName;
  args: string[];
  command: string;
};

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
  readonly agent: AgentName;
  readonly name: string;
  readonly path: string;
  readonly enabled: boolean;
  readonly provenance: SkillProvenance | null;

  constructor(
    agent: AgentName,
    name: string,
    path: string,
    enabled: boolean,
    provenance: SkillProvenance | null = null,
  ) {
    this.agent = agent;
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
    };
  }
}

export class SkillRow {
  readonly name: string;
  readonly instances: Record<AgentName, SkillInstance[]> = createAgentRecord(() => []);

  constructor(name: string) {
    this.name = name;
  }

  status(agent: AgentName): SkillStatus {
    const items = this.instances[agent];
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

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      status: Object.fromEntries(AGENTS.map((agent) => [agent, this.status(agent)])),
      instances: Object.fromEntries(
        AGENTS.map((agent) => [agent, this.instances[agent].map((item) => item.toJSON())]),
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

function createAgentRecord<T>(factory: (agent: AgentName) => T): Record<AgentName, T> {
  return Object.fromEntries(AGENTS.map((agent) => [agent, factory(agent)])) as Record<AgentName, T>;
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

function codexSkillBlock(path: string, enabled: boolean): string[] {
  return [
    "[[skills.config]]\n",
    `path = ${JSON.stringify(path)}\n`,
    `enabled = ${enabled ? "true" : "false"}\n`,
  ];
}

type Adapter = {
  discover(): SkillInstance[];
  setEnabled(instance: SkillInstance, enabled: boolean): void;
};

class CodexAdapter implements Adapter {
  readonly roots: string[];
  readonly configPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.roots = [join(home, ".agents", "skills"), join(home, ".codex", "skills")];
    this.configPath = join(home, ".codex", "config.toml");
  }

  discover(): SkillInstance[] {
    const configured = readCodexSkillEnabled(this.configPath);
    return this.roots.flatMap((root) =>
      discoverSkillFiles(root).map((path) => {
        const resolved = resolve(path);
        const values = skillFrontmatter(path);
        return new SkillInstance(
          "codex",
          values.name || basename(dirname(path)),
          path,
          configured.get(resolved) ?? true,
          provenanceFromFrontmatter(values),
        );
      }),
    );
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    setCodexSkillEnabled(this.configPath, instance.path, enabled);
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
    const settings = readJson(this.settingsPath);
    const overrides = readObject(settings.skillOverrides);
    return discoverSkillFiles(this.root).map((path) => {
      const values = skillFrontmatter(path);
      const name = values.name || basename(dirname(path));
      return new SkillInstance(
        "claude-code",
        name,
        path,
        overrides[name] !== "off",
        provenanceFromFrontmatter(values),
      );
    });
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    const settings = readJson(this.settingsPath);
    settings.skillOverrides = readObject(settings.skillOverrides);
    (settings.skillOverrides as Record<string, unknown>)[instance.name] = enabled ? "on" : "off";
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
      const disabled = values["disable-model-invocation"]?.toLowerCase() === "true";
      return new SkillInstance(
        "cursor",
        values.name || basename(dirname(path)),
        path,
        !disabled,
        provenanceFromFrontmatter(values),
      );
    });
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    updateFrontmatterKey(instance.path, "disable-model-invocation", !enabled);
  }
}

class CopilotAdapter implements Adapter {
  readonly roots: string[];
  readonly settingsPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.roots = [join(home, ".copilot", "skills"), join(home, ".agents", "skills")];
    this.settingsPath = join(home, ".copilot", "settings.json");
  }

  discover(): SkillInstance[] {
    const settings = readJson(this.settingsPath);
    const disabled = new Set(readStringArray(settings.disabledSkills));
    return this.roots.flatMap((root) =>
      discoverSkillFiles(root).map((path) => {
        const values = skillFrontmatter(path);
        const name = values.name || basename(dirname(path));
        return new SkillInstance(
          "github-copilot",
          name,
          path,
          !disabled.has(name),
          provenanceFromFrontmatter(values),
        );
      }),
    );
  }

  setEnabled(instance: SkillInstance, enabled: boolean): void {
    const settings = readJson(this.settingsPath);
    settings.disabledSkills = enabled
      ? removeString(settings.disabledSkills, instance.name)
      : addString(settings.disabledSkills, instance.name);
    writeJson(this.settingsPath, settings);
  }
}

class OpenCodeAdapter implements Adapter {
  readonly roots: string[];
  readonly configPath: string;
  readonly home: string;

  constructor(home: string) {
    this.home = home;
    this.roots = [
      join(home, ".config", "opencode", "skills"),
      join(home, ".claude", "skills"),
      join(home, ".agents", "skills"),
    ];
    this.configPath = join(home, ".config", "opencode", "opencode.json");
  }

  discover(): SkillInstance[] {
    const config = readJson(this.configPath);
    const skillPermissions = readSkillPermissions(config);
    return this.roots.flatMap((root) =>
      discoverSkillFiles(root).map((path) => {
        const values = skillFrontmatter(path);
        const name = values.name || basename(dirname(path));
        return new SkillInstance(
          "opencode",
          name,
          path,
          skillPermissionFor(skillPermissions, name) !== "deny",
          provenanceFromFrontmatter(values),
        );
      }),
    );
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
    const settings = readJson(this.settingsPath);
    const skills = readObject(settings.skills);
    const globallyEnabled = skills.enabled !== false;
    const disabled = new Set(readStringArray(skills.disabled));
    return discoverSkillFiles(this.root).map((path) => {
      const values = skillFrontmatter(path);
      const name = values.name || basename(dirname(path));
      return new SkillInstance(
        "gemini-cli",
        name,
        path,
        globallyEnabled && !disabled.has(name),
        provenanceFromFrontmatter(values),
      );
    });
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

  scan(): SkillRow[] {
    const rows = new Map<string, SkillRow>();
    for (const agent of AGENTS) {
      for (const instance of this.adapters[agent].discover()) {
        const row = rows.get(instance.name) ?? new SkillRow(instance.name);
        row.instances[agent].push(instance);
        rows.set(instance.name, row);
      }
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  applyState(skillName: string, agents: AgentName[], enabled: boolean): AgentName[] {
    const row = this.scan().find((item) => item.name === skillName);
    if (!row) {
      return [];
    }

    const changed: AgentName[] = [];
    for (const agent of agents) {
      const instances = row.instances[agent];
      if (instances.length === 0) {
        continue;
      }
      for (const instance of instances) {
        this.adapters[agent].setEnabled(instance, enabled);
      }
      changed.push(agent);
    }
    return changed;
  }

  buildInstallMissingCommands(
    skillName: string,
    agents: AgentName[] = [...AGENTS],
  ): InstallCommand[] {
    const row = this.scan().find((item) => item.name === skillName);
    if (!row) {
      throw new Error(`No installed skill named ${JSON.stringify(skillName)}.`);
    }

    const source = AGENTS.flatMap((agent) => row.instances[agent]).find(
      (instance) => instance.provenance !== null,
    )?.provenance;
    if (!source) {
      throw new Error(`No GitHub provenance metadata found for ${JSON.stringify(skillName)}.`);
    }

    return agents
      .filter((agent) => row.instances[agent].length === 0)
      .map((agent) => {
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
          agent,
          args,
          command: ["gh", ...args].map(shellQuote).join(" "),
        };
      });
  }

  formatTable(rows = this.scan()): string {
    const nameWidth = Math.max("Skill".length, ...rows.map((row) => row.name.length));
    const lines = [
      [
        "Skill".padEnd(nameWidth),
        ...AGENTS.map((agent) => AGENT_LABELS[agent].padEnd(AGENT_COLUMN_WIDTHS[agent])),
      ].join("  "),
      [
        "-".repeat(nameWidth),
        ...AGENTS.map((agent) => "-".repeat(AGENT_COLUMN_WIDTHS[agent])),
      ].join("  "),
    ];
    for (const row of rows) {
      const values = AGENTS.map((agent) => formatStatus(row.status(agent)));
      lines.push(
        [
          row.name.padEnd(nameWidth),
          ...AGENTS.map((agent, index) => values[index].padEnd(AGENT_COLUMN_WIDTHS[agent])),
        ].join("  "),
      );
    }
    return lines.join("\n");
  }
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
