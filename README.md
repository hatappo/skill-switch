<p align="center">
  en | <a href="./README_ja.md">ja</a>
</p>

# skill-switch

`skill-switch` is a TUI for switching AI agent skills across agents.

![skill-switch TUI screenshot](./docs/img/screenshot-tui.png)

## Features

- Toggle, install, and delete user-level skills across agents from one table.
- Toggle state is stored through each agent's native enable/disable settings instead of renaming skill directories.
- Install integrates with `gh skill install`, and falls back to local copy when provenance metadata is unavailable.
- Has no runtime package dependencies.

## Supported agents

Agent IDs follow the names in parentheses used by `gh skill install --help`.
`universal` is skill-switch's column for `~/.agents/skills`; installs to it use the
`universal` gh agent. It is shown at the left edge of the table.

| Agent              | ID               | User skill folders          | Toggle mechanism                                                                       |
| ------------------ | ---------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| Universal          | `universal`      | `~/.agents/skills`          | Applies settings for Universal-compatible agents except Claude Code and Cline          |
| Codex              | `codex`          | `~/.codex/skills`           | Writes `[[skills.config]]` entries in `~/.codex/config.toml` with `path` and `enabled` |
| Claude Code        | `claude-code`    | `~/.claude/skills`          | Writes `skillOverrides` in `~/.claude/settings.json`                                   |
| Cursor             | `cursor`         | `~/.cursor/skills`          | Writes `disable-model-invocation` in each skill's `SKILL.md` frontmatter               |
| GitHub Copilot CLI | `github-copilot` | `~/.copilot/skills`         | Writes `disabledSkills` in `~/.copilot/settings.json`                                  |
| OpenCode           | `opencode`       | `~/.config/opencode/skills` | Writes `permission.skill` in `~/.config/opencode/opencode.json`                        |
| Gemini CLI         | `gemini-cli`     | `~/.gemini/skills`          | Writes `skills.disabled` in `~/.gemini/settings.json`                                  |
| Cline              | `cline`          | `~/.cline/skills`           | Writes `globalSkillsToggles` in `~/.cline/data/settings/global-settings.json`          |

Only columns whose user skill folder exists are shown in the TUI and `list`
output. Row-wide actions and default `install-missing` targets use those active
columns only. Agent IDs can still be passed explicitly to `install-missing` for
bootstrap workflows.

For investigated agents that are not currently a good fit for full toggle
support, see [Agent support notes](./docs/agent-support-notes.md).

Cursor does not currently expose the same path-based enable/disable config used by Codex. For Cursor, this tool uses the documented/observed frontmatter control that prevents automatic model invocation while keeping explicit invocation possible.

Cursor's `~/.cursor/skills-cursor` directory is managed by Cursor itself and is intentionally ignored.

Skill matching uses the `name` field in `SKILL.md` frontmatter, falling back to the parent directory name when `name` is missing.

Enable/disable writes follow these rules:

| Agent              | OFF write                                                                                                  | ON write                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Codex              | Add/update `enabled = false`                                                                               | Remove that skill's `[[skills.config]]` entry                          |
| Claude Code        | Set `skillOverrides[name] = off`                                                                           | Remove `skillOverrides[name]`                                          |
| Cursor             | Set `disable-model-invocation`                                                                             | Remove `disable-model-invocation`                                      |
| GitHub Copilot CLI | Add to `disabledSkills`                                                                                    | Remove from `disabledSkills`                                           |
| OpenCode           | Set `permission.skill[name]=deny`                                                                          | Set `permission.skill[name]=allow` to override broader deny rules      |
| Gemini CLI         | Add to `skills.disabled`                                                                                   | Remove from `skills.disabled` and keep `skills.enabled = true` if set  |
| Cline              | Set `globalSkillsToggles[path]=false`                                                                      | Remove `globalSkillsToggles[path]`                                     |
| Universal          | Applies OFF writes to Codex, Cursor, Copilot CLI, OpenCode, and Gemini CLI for the `~/.agents/skills` path | Applies ON writes to those same agents for the `~/.agents/skills` path |

If an explicit ON entry already exists, an OFF action overwrites it with the
agent's OFF form. For example, Codex `enabled = true` becomes `enabled = false`,
Claude Code `skillOverrides[name] = on` becomes `off`, Cursor
`disable-model-invocation: false` becomes `true`, and OpenCode `allow` becomes
`deny`.

Agent-specific columns only control skills in that agent's primary user skill
folder. They do not change a same-named Universal skill. The Universal column
only controls the `~/.agents/skills` copy by writing settings for
Universal-compatible agents. Claude Code is excluded because its official skill
locations do not include `~/.agents/skills`. Cline is excluded for the same
reason.

Universal toggle targets:

| Agent              | Targeted by Universal | Setting touched for `~/.agents/skills` |
| ------------------ | --------------------- | -------------------------------------- |
| Codex              | Yes                   | `~/.codex/config.toml` path entry      |
| Claude Code        | No                    | Not touched                            |
| Cursor             | Yes                   | Universal skill `SKILL.md` frontmatter |
| GitHub Copilot CLI | Yes                   | `~/.copilot/settings.json`             |
| OpenCode           | Yes                   | `~/.config/opencode/opencode.json`     |
| Gemini CLI         | Yes                   | `~/.gemini/settings.json`              |
| Cline              | No                    | Not touched                            |

## Usage

Install it locally if you want the `skill-switch` command:

```bash
pnpm link --global
skill-switch
```

Or run it directly from the repository:

```bash
pnpm start
```

Run without arguments to open the TUI.

Helper commands are kept for inspection, snapshot workflows, and dry-run install workflows:

```bash
node src/cli.ts help
node src/cli.ts --version
node src/cli.ts list
node src/cli.ts list --format json
node src/cli.ts export > skills.json
node src/cli.ts import skills.json
node src/cli.ts apply skills.json
node src/cli.ts install-missing frontend-design
node src/cli.ts install-missing frontend-design universal cursor --execute
```

`export` writes a JSON snapshot of reproducible `on`/`off` states. `mixed` and
missing states are omitted.

```json
{
  "version": 1,
  "skills": {
    "frontend-design": {
      "codex": "on",
      "claude-code": "off"
    }
  }
}
```

`import skills.json` opens the TUI with snapshot differences loaded as pending
changes. Review them, then press `s` to save. `apply skills.json` applies the
same snapshot directly without opening the TUI, which is useful for dotfiles and
bootstrap scripts.

`install-missing` reads `metadata.github-repo` and `metadata.github-path` from an
installed skill's `SKILL.md`, then builds `gh skill install --scope user --agent ...`
commands for agents where that skill is missing. It prints commands by default;
pass `--execute` to run them.
When no GitHub provenance is available, it falls back to copying an installed
local skill directory to the missing agents' primary user skill folders.
During local copy, `SKILL.md` frontmatter is sanitized to keep only Agent Skills
spec fields: `name`, `description`, `license`, `compatibility`, `metadata`, and
`allowed-tools`.
When multiple installed columns can be used as a source, the first match is used
in this order: Universal, Codex, Claude Code, Cursor, GitHub Copilot CLI,
OpenCode, Gemini CLI, Cline.

The TUI also supports this workflow: select a skill row, press `i`, then confirm
with `y` to install that skill for every supported agent where it is missing.
The GitHub provenance path requires `gh skill install` to be available. The
local copy fallback does not require `gh`.

TUI keys:

Status colors:

| Status         | Color              |
| -------------- | ------------------ |
| `ON`           | Green              |
| `OFF`          | Red                |
| `MIX`          | Yellow             |
| `-`            | Dim gray           |
| Unsaved change | Bold cyan with `*` |

For Universal mixed state, the status is shown as `enabled/total`, such as
`2/3`. The denominator is the number of active Universal-aligned agents, and the
numerator is the number of those agents where the Universal skill is enabled.

| Key                     | Command         | Action                                                            |
| ----------------------- | --------------- | ----------------------------------------------------------------- |
| `Up`/`Down`, `j`/`k`    | move row        | Move between skills                                               |
| `Left`/`Right`, `h`/`l` | move column     | Move between agent columns                                        |
| `Space`                 | toggle cell     | Toggle the selected skill for the selected agent                  |
| `Enter`                 | toggle row      | Toggle the selected skill row across all agents where it exists   |
| `o`                     | row on          | Enable the selected skill row across all agents where it exists   |
| `x`                     | row off         | Disable the selected skill row across all agents where it exists  |
| `d`                     | delete skill    | Delete the selected skill across all agents where it exists       |
| `i`                     | install missing | Prepare `gh skill install` for missing agents on the selected row |
| `y`/`n`                 | confirm/cancel  | Confirm or cancel a prepared install                              |
| `s`                     | save            | Save pending changes                                              |
| `r`                     | reload          | Reload from disk and clear pending changes                        |
| `?`                     | help            | Open or close the help view                                       |
| `q`                     | quit            | Quit                                                              |

Advanced keys:

| Key | Command     | Action                                                                                       |
| --- | ----------- | -------------------------------------------------------------------------------------------- |
| `f` | frontmatter | Expand or collapse the Frontmatter pane. Remaining hidden lines are shown in the pane title. |
| `v` | column view | Toggle between active columns and all supported columns. Inactive column headers are dimmed. |

## References

- Codex Agent Skills docs: https://developers.openai.com/codex/skills
- Claude Code Skills docs: https://code.claude.com/docs/en/skills
- Cursor Agent Skills forum guidance: https://forum.cursor.com/t/can-i-run-cursor-cli-without-loading-skills-or-with-only-specific-skill/152608
- GitHub Copilot CLI docs: https://docs.github.com/copilot/reference/copilot-cli-reference/cli-command-reference
- OpenCode Agent Skills docs: https://opencode.ai/docs/skills/
- Gemini CLI configuration docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md
- Cline Skills docs: https://docs.cline.bot/customization/skills

## Planned Ideas

- Support Claude Code `skillOverrides` values beyond two-state ON/OFF:
  `"name-only"` and `"user-invocable-only"`.
