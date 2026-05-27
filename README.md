<p align="center">
  <a href="./README.md">en</a> | <a href="./README_ja.md">ja</a>
</p>

# skill-switch

`skill-switch` is a dependency-free TypeScript TUI/CLI for viewing and toggling user-level Agent Skills across Codex, Claude Code, and Cursor.

It matches skills by the `name` field in `SKILL.md` frontmatter, falling back to the parent directory name when `name` is missing.

## Supported agents

Agent IDs follow the names in parentheses used by `gh skill install --help`, such as `codex`, `claude-code`, and `cursor`.

| Agent       | ID            | User skill folders                    | Toggle mechanism                                                                       |
| ----------- | ------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex       | `codex`       | `~/.agents/skills`, `~/.codex/skills` | Writes `[[skills.config]]` entries in `~/.codex/config.toml` with `path` and `enabled` |
| Claude Code | `claude-code` | `~/.claude/skills`                    | Writes `skillOverrides` in `~/.claude/settings.json`                                   |
| Cursor      | `cursor`      | `~/.cursor/skills`                    | Writes `disable-model-invocation` in each skill's `SKILL.md` frontmatter               |

Cursor does not currently expose the same path-based enable/disable config used by Codex. For Cursor, this tool uses the documented/observed frontmatter control that prevents automatic model invocation while keeping explicit invocation possible.

Cursor's `~/.cursor/skills-cursor` directory is managed by Cursor itself and is intentionally ignored.

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

```bash
node src/cli.ts list
node src/cli.ts list --format json
node src/cli.ts set sample-skill all off
node src/cli.ts set sample-skill codex claude-code on
node src/cli.ts install-missing frontend-design
node src/cli.ts install-missing frontend-design cursor --execute
```

`install-missing` reads `metadata.github-repo` and `metadata.github-path` from an
installed skill's `SKILL.md`, then builds `gh skill install --scope user --agent ...`
commands for agents where that skill is missing. It prints commands by default;
pass `--execute` to run them.

The TUI also supports this workflow: select a skill row, press `i`, then confirm
with `y` to install that skill for every supported agent where it is missing.

TUI keys:

Status colors:

| Status         | Color              |
| -------------- | ------------------ |
| `ON`           | Green              |
| `OFF`          | Red                |
| `MIX`          | Yellow             |
| `-`            | Dim gray           |
| Unsaved change | Bold cyan with `*` |

| Key                     | Action                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `Up`/`Down`, `j`/`k`    | Move between skills                                               |
| `Left`/`Right`, `h`/`l` | Move between agent columns                                        |
| `Space`                 | Toggle the selected skill for the selected agent                  |
| `a`                     | Toggle the selected skill row across all agents where it exists   |
| `o`                     | Enable the selected skill row across all agents where it exists   |
| `x`                     | Disable the selected skill row across all agents where it exists  |
| `i`                     | Prepare `gh skill install` for missing agents on the selected row |
| `y`/`n`                 | Confirm or cancel a prepared install                              |
| `s`                     | Save pending changes                                              |
| `r`                     | Reload from disk and clear pending changes                        |
| `q`                     | Quit                                                              |

## Checks

```bash
pnpm verify
pnpm format:check
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm test
pnpm fix
```

## References

- Codex Agent Skills docs: https://developers.openai.com/codex/skills
- Claude Code Skills docs: https://code.claude.com/docs/en/skills
- Cursor Agent Skills forum guidance: https://forum.cursor.com/t/can-i-run-cursor-cli-without-loading-skills-or-with-only-specific-skill/152608

### gh

```sh
 $ gh skill install --help | grep '  - '
  - GitHub Copilot (github-copilot)
  - Claude Code (claude-code)
  - Cursor (cursor)
  - Codex (codex)
  - Gemini CLI (gemini-cli)
  - Antigravity (antigravity)
  - AdaL (adal)
  - Amp (amp)
  - Augment (augment)
  - IBM Bob (bob)
  - Cline (cline)
  - CodeBuddy (codebuddy)
  - Command Code (command-code)
  - Continue (continue)
  - Cortex Code (cortex)
  - Crush (crush)
  - Deep Agents (deepagents)
  - Droid (droid)
  - Firebender (firebender)
  - Goose (goose)
  - iFlow CLI (iflow-cli)
  - Junie (junie)
  - Kilo Code (kilo)
  - Kimi Code CLI (kimi-cli)
  - Kiro CLI (kiro-cli)
  - Kode (kode)
  - MCPJam (mcpjam)
  - Mistral Vibe (mistral-vibe)
  - Mux (mux)
  - Neovate (neovate)
  - OpenClaw (openclaw)
  - OpenCode (opencode)
  - OpenHands (openhands)
  - Pi (pi)
  - Pochi (pochi)
  - Qoder (qoder)
  - Qwen Code (qwen-code)
  - Replit (replit)
  - Roo Code (roo)
  - Trae (trae)
  - Trae CN (trae-cn)
  - Universal (universal)
  - Warp (warp)
  - Windsurf (windsurf)
  - Zencoder (zencoder)
```
