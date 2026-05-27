import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
  discoverSkillFiles,
  parseFrontmatter,
  readCodexSkillEnabled,
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

test("updateFrontmatterKey replaces existing key", () => {
  const home = tmpHome();
  const skill = join(home, "skill", "SKILL.md");
  writeSkill(skill, "skill", "disable-model-invocation: false\n");

  updateFrontmatterKey(skill, "disable-model-invocation", true);

  const text = readFileSync(skill, "utf8");
  assert.match(text, /disable-model-invocation: true/);
  assert.doesNotMatch(text, /disable-model-invocation: false/);
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
