import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  checkGhCommand,
  discoverSkillFiles,
  formatSnapshot,
  GH_MISSING_MESSAGE,
  GH_SKILL_MISSING_MESSAGE,
  parseFrontmatter,
  parseSnapshot,
  provenanceFromFrontmatter,
  readCodexSkillEnabled,
  removeFrontmatterKey,
  sanitizeSkillFrontmatter,
  setCodexSkillEnabled,
  SkillManager,
  updateFrontmatterKey,
} from "../src/core.ts";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "skill-switch-"));
}

function writeSkill(path: string, name: string, extraFrontmatter = ""): void {
  ensureDir(dirname(path));
  writeFileSync(
    path,
    `---\nname: ${name}\ndescription: Test skill\n${extraFrontmatter}---\n\n# ${name}\n`,
    "utf8",
  );
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

test("parseFrontmatter parses simple YAML frontmatter", () => {
  const parsed = parseFrontmatter("---\nname: test\ndescription: Hi\n---\nBody\n");
  assert.equal(parsed.values.name, "test");
  assert.equal(parsed.values.description, "Hi");
  assert.deepEqual(parsed.bounds, [0, 3]);
});

test("provenanceFromFrontmatter reads GitHub metadata", () => {
  const parsed = parseFrontmatter(
    [
      "---",
      "name: demo",
      "metadata:",
      "    github-path: skills/demo",
      "    github-ref: refs/tags/v1.2.3",
      "    github-repo: https://github.com/example/skills",
      "---",
      "",
    ].join("\n"),
  );

  assert.deepEqual(provenanceFromFrontmatter(parsed.values), {
    repository: "example/skills",
    skillPath: "skills/demo",
    pin: "v1.2.3",
  });
});

test("updateFrontmatterKey replaces existing key", () => {
  const home = tmpHome();
  const skill = join(home, "skill", "SKILL.md");
  writeSkill(skill, "skill", "disable-model-invocation: false\n");

  updateFrontmatterKey(skill, "disable-model-invocation", true);

  const text = readFileSync(skill, "utf8");
  assert.match(text, /disable-model-invocation: true/);
  assert.doesNotMatch(text, /disable-model-invocation: false/);
});

test("removeFrontmatterKey removes a top-level key and its nested block", () => {
  const home = tmpHome();
  const skill = join(home, "skill", "SKILL.md");
  ensureDir(dirname(skill));
  writeFileSync(
    skill,
    [
      "---",
      "name: skill",
      "x-agent-private:",
      "  enabled: false",
      "description: Test skill",
      "---",
      "",
      "# skill",
      "",
    ].join("\n"),
    "utf8",
  );

  assert.equal(removeFrontmatterKey(skill, "x-agent-private"), true);

  const text = readFileSync(skill, "utf8");
  assert.doesNotMatch(text, /x-agent-private/);
  assert.doesNotMatch(text, /enabled: false/);
  assert.match(text, /description: Test skill/);
});

test("sanitizeSkillFrontmatter keeps only portable top-level keys", () => {
  const home = tmpHome();
  const skill = join(home, "skill", "SKILL.md");
  ensureDir(dirname(skill));
  writeFileSync(
    skill,
    [
      "---",
      "name: skill",
      "description: Test skill",
      "metadata:",
      "  github-repo: example/skills",
      "  github-path: skills/skill",
      "allowed-tools: Bash(git:*) Read",
      "disable-model-invocation: true",
      "  stale-child: true",
      "x-agent-private:",
      "  enabled: false",
      "compatibility: Requires git",
      "---",
      "",
      "# skill",
      "",
    ].join("\n"),
    "utf8",
  );

  assert.equal(sanitizeSkillFrontmatter(skill), true);

  const text = readFileSync(skill, "utf8");
  assert.match(text, /metadata:\n  github-repo: example\/skills\n  github-path: skills\/skill/);
  assert.match(text, /allowed-tools: Bash\(git:\*\) Read/);
  assert.match(text, /compatibility: Requires git/);
  assert.doesNotMatch(text, /disable-model-invocation/);
  assert.doesNotMatch(text, /stale-child/);
  assert.doesNotMatch(text, /x-agent-private/);
});

test("discoverSkillFiles ignores hidden directories", () => {
  const home = tmpHome();
  const root = join(home, "skills");
  const visible = join(root, "demo", "SKILL.md");
  const hidden = join(root, ".system", "builtin", "SKILL.md");
  writeSkill(visible, "demo");
  writeSkill(hidden, "builtin");

  assert.deepEqual(discoverSkillFiles(root), [visible]);
});

test("checkGhCommand reports a missing command clearly", () => {
  assert.equal(checkGhCommand("skill-switch-gh-command-that-does-not-exist"), GH_MISSING_MESSAGE);
});

test("checkGhCommand reports a command without gh skill support", () => {
  assert.equal(checkGhCommand("node"), GH_SKILL_MISSING_MESSAGE);
});

test("setCodexSkillEnabled adds and updates one block", () => {
  const home = tmpHome();
  const config = join(home, ".codex", "config.toml");
  const skill = join(home, ".agents", "skills", "demo", "SKILL.md");
  writeSkill(skill, "demo");

  setCodexSkillEnabled(config, skill, false);
  assert.equal(readCodexSkillEnabled(config).get(resolve(skill)), false);

  setCodexSkillEnabled(config, skill, true);
  assert.equal(readCodexSkillEnabled(config).get(resolve(skill)), true);
  assert.equal(readFileSync(config, "utf8").match(/\[\[skills\.config\]\]/g)?.length, 1);
});

test("Codex adapter writes OFF and removes config entry for ON", () => {
  const home = tmpHome();
  const codexSkill = join(home, ".agents", "skills", "demo", "SKILL.md");
  writeSkill(codexSkill, "demo");
  const codexConfig = join(home, ".codex", "config.toml");
  setCodexSkillEnabled(codexConfig, codexSkill, true);

  const manager = new SkillManager(home);
  assert.deepEqual(manager.applyState("demo", ["codex"], false), ["codex"]);
  assert.equal(readCodexSkillEnabled(codexConfig).get(resolve(codexSkill)), false);

  assert.deepEqual(manager.applyState("demo", ["codex"], true), ["codex"]);
  assert.equal(readCodexSkillEnabled(codexConfig).has(resolve(codexSkill)), false);
});

test("Claude adapter writes OFF and removes override for ON", () => {
  const home = tmpHome();
  const claudeSkill = join(home, ".claude", "skills", "demo", "SKILL.md");
  writeSkill(claudeSkill, "demo");
  const claudeSettings = join(home, ".claude", "settings.json");
  ensureDir(dirname(claudeSettings));
  writeFileSync(claudeSettings, JSON.stringify({ skillOverrides: { demo: "on" } }), "utf8");

  const manager = new SkillManager(home);
  assert.deepEqual(manager.applyState("demo", ["claude-code"], false), ["claude-code"]);
  assert.equal(JSON.parse(readFileSync(claudeSettings, "utf8")).skillOverrides.demo, "off");

  assert.deepEqual(manager.applyState("demo", ["claude-code"], true), ["claude-code"]);
  assert.deepEqual(JSON.parse(readFileSync(claudeSettings, "utf8")).skillOverrides, {});
});

test("Cursor adapter writes OFF and removes frontmatter key for ON", () => {
  const home = tmpHome();
  const cursorSkill = join(home, ".cursor", "skills", "demo", "SKILL.md");
  writeSkill(cursorSkill, "demo", "disable-model-invocation: false\n");

  const manager = new SkillManager(home);
  assert.deepEqual(manager.applyState("demo", ["cursor"], false), ["cursor"]);
  assert.match(readFileSync(cursorSkill, "utf8"), /disable-model-invocation: true/);

  assert.deepEqual(manager.applyState("demo", ["cursor"], true), ["cursor"]);
  assert.doesNotMatch(readFileSync(cursorSkill, "utf8"), /disable-model-invocation/);
});

test("SkillManager matches skills by name across agents", () => {
  const home = tmpHome();
  writeSkill(join(home, ".agents", "skills", "demo", "SKILL.md"), "demo");
  writeSkill(join(home, ".claude", "skills", "demo", "SKILL.md"), "demo");
  writeSkill(
    join(home, ".cursor", "skills", "demo", "SKILL.md"),
    "demo",
    "disable-model-invocation: true\n",
  );

  const rows = new SkillManager(home).scan();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "demo");
  assert.equal(rows[0].status("codex"), "on");
  assert.equal(rows[0].status("claude-code"), "on");
  assert.equal(rows[0].status("cursor"), "off");
});

test("applyState uses agent-specific storage", () => {
  const home = tmpHome();
  const codexSkill = join(home, ".agents", "skills", "demo", "SKILL.md");
  const claudeSkill = join(home, ".claude", "skills", "demo", "SKILL.md");
  const cursorSkill = join(home, ".cursor", "skills", "demo", "SKILL.md");
  writeSkill(codexSkill, "demo");
  writeSkill(claudeSkill, "demo");
  writeSkill(cursorSkill, "demo");

  const changed = new SkillManager(home).applyState(
    "demo",
    ["codex", "claude-code", "cursor"],
    false,
  );

  assert.deepEqual(changed, ["codex", "claude-code", "cursor"]);
  assert.equal(
    readCodexSkillEnabled(join(home, ".codex", "config.toml")).get(resolve(codexSkill)),
    false,
  );

  const claudeSettings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(claudeSettings.skillOverrides.demo, "off");
  assert.match(readFileSync(cursorSkill, "utf8"), /disable-model-invocation: true/);
});

test("createSnapshot serializes on and off states only", () => {
  const home = tmpHome();
  const codexSkill = join(home, ".agents", "skills", "demo", "SKILL.md");
  const cursorSkill = join(home, ".cursor", "skills", "demo", "SKILL.md");
  writeSkill(codexSkill, "demo");
  writeSkill(cursorSkill, "demo", "disable-model-invocation: true\n");

  const manager = new SkillManager(home);
  const snapshot = manager.createSnapshot();

  assert.deepEqual(snapshot, {
    version: 1,
    skills: {
      demo: {
        codex: "on",
        cursor: "off",
        "github-copilot": "on",
        opencode: "on",
      },
    },
  });
  assert.equal(parseSnapshot(formatSnapshot(snapshot)).skills.demo?.codex, "on");
});

test("applySnapshot applies existing entries and reports skipped entries", () => {
  const home = tmpHome();
  const codexSkill = join(home, ".agents", "skills", "demo", "SKILL.md");
  const cursorSkill = join(home, ".cursor", "skills", "demo", "SKILL.md");
  writeSkill(codexSkill, "demo");
  writeSkill(cursorSkill, "demo");

  const manager = new SkillManager(home);
  const plan = manager.applySnapshot(
    parseSnapshot(
      JSON.stringify({
        version: 1,
        skills: {
          demo: {
            codex: "off",
            cursor: "on",
            "claude-code": "off",
          },
          missing: {
            codex: "off",
          },
        },
      }),
    ),
  );

  assert.deepEqual(plan.changes, [{ skill: "demo", agent: "codex", enabled: false }]);
  assert.deepEqual(plan.unchanged, [{ skill: "demo", agent: "cursor", enabled: true }]);
  assert.deepEqual(plan.skipped, [
    { skill: "demo", agent: "claude-code", reason: "skill is not installed for agent" },
    { skill: "missing", agent: "codex", reason: "skill is not installed" },
  ]);
  assert.equal(
    readCodexSkillEnabled(join(home, ".codex", "config.toml")).get(resolve(codexSkill)),
    false,
  );
});

test("parseSnapshot rejects unsupported agents and statuses", () => {
  assert.throws(
    () => parseSnapshot(JSON.stringify({ version: 1, skills: { demo: { unknown: "on" } } })),
    /unsupported agent/,
  );
  assert.throws(
    () => parseSnapshot(JSON.stringify({ version: 1, skills: { demo: { codex: "mixed" } } })),
    /must be "on" or "off"/,
  );
});

test("deleteSkill removes skill directories and stale disable settings", () => {
  const home = tmpHome();
  const sharedSkill = join(home, ".agents", "skills", "demo", "SKILL.md");
  const claudeSkill = join(home, ".claude", "skills", "demo", "SKILL.md");
  const geminiSkill = join(home, ".gemini", "skills", "demo", "SKILL.md");
  const codexConfig = join(home, ".codex", "config.toml");
  const claudeSettings = join(home, ".claude", "settings.json");
  const copilotSettings = join(home, ".copilot", "settings.json");
  const opencodeConfig = join(home, ".config", "opencode", "opencode.json");
  const geminiSettings = join(home, ".gemini", "settings.json");
  writeSkill(sharedSkill, "demo");
  writeSkill(claudeSkill, "demo");
  writeSkill(geminiSkill, "demo");
  setCodexSkillEnabled(codexConfig, sharedSkill, false);
  ensureDir(dirname(claudeSettings));
  writeFileSync(claudeSettings, JSON.stringify({ skillOverrides: { demo: "off" } }), "utf8");
  ensureDir(dirname(copilotSettings));
  writeFileSync(copilotSettings, JSON.stringify({ disabledSkills: ["demo"] }), "utf8");
  ensureDir(dirname(opencodeConfig));
  writeFileSync(
    opencodeConfig,
    JSON.stringify({ permission: { skill: { demo: "deny" } } }),
    "utf8",
  );
  ensureDir(dirname(geminiSettings));
  writeFileSync(geminiSettings, JSON.stringify({ skills: { disabled: ["demo"] } }), "utf8");

  const manager = new SkillManager(home);
  assert.deepEqual(manager.deleteTargets("demo"), [
    resolve(dirname(sharedSkill)),
    resolve(dirname(claudeSkill)),
    resolve(dirname(geminiSkill)),
  ]);

  const deleted = manager.deleteSkill("demo");

  assert.deepEqual(deleted, [
    resolve(dirname(sharedSkill)),
    resolve(dirname(claudeSkill)),
    resolve(dirname(geminiSkill)),
  ]);
  assert.equal(existsSync(dirname(sharedSkill)), false);
  assert.equal(existsSync(dirname(claudeSkill)), false);
  assert.equal(existsSync(dirname(geminiSkill)), false);
  assert.equal(readCodexSkillEnabled(codexConfig).has(resolve(sharedSkill)), false);
  assert.deepEqual(JSON.parse(readFileSync(claudeSettings, "utf8")).skillOverrides, {});
  assert.deepEqual(JSON.parse(readFileSync(copilotSettings, "utf8")).disabledSkills, []);
  assert.deepEqual(JSON.parse(readFileSync(opencodeConfig, "utf8")).permission.skill, {});
  assert.deepEqual(JSON.parse(readFileSync(geminiSettings, "utf8")).skills.disabled, []);
  assert.equal(
    manager.scan().some((row) => row.name === "demo"),
    false,
  );
});

test("Copilot adapter writes OFF and removes disabled entry for ON", () => {
  const home = tmpHome();
  const skill = join(home, ".copilot", "skills", "demo", "SKILL.md");
  const settings = join(home, ".copilot", "settings.json");
  writeSkill(skill, "demo");
  ensureDir(dirname(settings));
  writeFileSync(settings, JSON.stringify({ disabledSkills: ["demo"] }), "utf8");

  const manager = new SkillManager(home);
  assert.equal(
    manager
      .scan()
      .find((row) => row.name === "demo")
      ?.status("github-copilot"),
    "off",
  );

  assert.deepEqual(manager.applyState("demo", ["github-copilot"], true), ["github-copilot"]);
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")).disabledSkills, []);

  assert.deepEqual(manager.applyState("demo", ["github-copilot"], false), ["github-copilot"]);
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")).disabledSkills, ["demo"]);
});

test("OpenCode adapter writes explicit deny for OFF and explicit allow for ON", () => {
  const home = tmpHome();
  const skill = join(home, ".config", "opencode", "skills", "demo", "SKILL.md");
  const config = join(home, ".config", "opencode", "opencode.json");
  writeSkill(skill, "demo");
  ensureDir(dirname(config));
  writeFileSync(config, JSON.stringify({ permission: { skill: { demo: "deny" } } }), "utf8");

  const manager = new SkillManager(home);
  assert.equal(
    manager
      .scan()
      .find((row) => row.name === "demo")
      ?.status("opencode"),
    "off",
  );

  assert.deepEqual(manager.applyState("demo", ["opencode"], true), ["opencode"]);
  assert.equal(JSON.parse(readFileSync(config, "utf8")).permission.skill.demo, "allow");

  assert.deepEqual(manager.applyState("demo", ["opencode"], false), ["opencode"]);
  assert.equal(JSON.parse(readFileSync(config, "utf8")).permission.skill.demo, "deny");
});

test("Gemini adapter writes OFF and removes disabled entry for ON", () => {
  const home = tmpHome();
  const skill = join(home, ".gemini", "skills", "demo", "SKILL.md");
  const settings = join(home, ".gemini", "settings.json");
  writeSkill(skill, "demo");
  ensureDir(dirname(settings));
  writeFileSync(
    settings,
    JSON.stringify({ skills: { enabled: false, disabled: ["demo"] } }),
    "utf8",
  );

  const manager = new SkillManager(home);
  assert.equal(
    manager
      .scan()
      .find((row) => row.name === "demo")
      ?.status("gemini-cli"),
    "off",
  );

  assert.deepEqual(manager.applyState("demo", ["gemini-cli"], true), ["gemini-cli"]);
  const enabledSettings = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(enabledSettings.skills.enabled, true);
  assert.deepEqual(enabledSettings.skills.disabled, []);

  assert.deepEqual(manager.applyState("demo", ["gemini-cli"], false), ["gemini-cli"]);
  assert.deepEqual(JSON.parse(readFileSync(settings, "utf8")).skills.disabled, ["demo"]);
});

test("buildInstallMissingCommands uses provenance from installed agents", () => {
  const home = tmpHome();
  writeSkill(
    join(home, ".claude", "skills", "demo", "SKILL.md"),
    "demo",
    [
      "metadata:",
      "    github-path: skills/demo",
      "    github-ref: refs/heads/main",
      "    github-repo: https://github.com/example/skills",
      "",
    ].join("\n"),
  );

  const commands = new SkillManager(home).buildInstallMissingCommands("demo", ["codex", "cursor"]);

  assert.deepEqual(
    commands.map((command) => command.args),
    [
      ["skill", "install", "example/skills", "skills/demo", "--scope", "user", "--agent", "codex"],
      ["skill", "install", "example/skills", "skills/demo", "--scope", "user", "--agent", "cursor"],
    ],
  );
});

test("install-missing falls back to local copy without provenance", () => {
  const home = tmpHome();
  const sourceSkill = join(home, ".claude", "skills", "demo", "SKILL.md");
  const copilotSettings = join(home, ".copilot", "settings.json");
  writeSkill(
    sourceSkill,
    "demo",
    "allowed-tools: Bash(git:*) Read\ncompatibility: Requires git\ndisable-model-invocation: true\n",
  );
  ensureDir(dirname(copilotSettings));
  writeFileSync(copilotSettings, JSON.stringify({ disabledSkills: ["demo"] }), "utf8");

  const manager = new SkillManager(home);
  const actions = manager.buildInstallMissingActions("demo", ["github-copilot"]);

  assert.deepEqual(actions, [
    {
      kind: "copy",
      agent: "github-copilot",
      skillName: "demo",
      sourcePath: resolve(dirname(sourceSkill)),
      targetPath: join(home, ".copilot", "skills", "demo"),
      command: `copy ${resolve(dirname(sourceSkill))} -> ${join(home, ".copilot", "skills", "demo")}`,
    },
  ]);

  manager.executeInstallAction(actions[0]);

  const copiedSkill = join(home, ".copilot", "skills", "demo", "SKILL.md");
  assert.equal(existsSync(copiedSkill), true);
  assert.match(readFileSync(copiedSkill, "utf8"), /allowed-tools: Bash\(git:\*\) Read/);
  assert.match(readFileSync(copiedSkill, "utf8"), /compatibility: Requires git/);
  assert.doesNotMatch(readFileSync(copiedSkill, "utf8"), /disable-model-invocation/);
  assert.deepEqual(JSON.parse(readFileSync(copilotSettings, "utf8")).disabledSkills, []);
  assert.equal(
    manager
      .scan()
      .find((row) => row.name === "demo")
      ?.status("github-copilot"),
    "on",
  );
});
