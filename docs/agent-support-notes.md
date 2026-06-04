# Agent Support Notes

This note tracks agents that were investigated but are not currently supported
by skill-switch. The main requirement for full support is a native, documented,
per-skill enable/disable setting that can be updated without renaming or
deleting skill directories.

Research date: 2026-06-03.

| Agent       | ID            | Documented skill locations                                                                                                                          | Toggle signal found                                                                                                                                                     | Current decision                                                                                                         |
| ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Antigravity | `antigravity` | CLI docs mention `~/.gemini/antigravity-cli/skills`; IDE/global docs have shifted around `~/.gemini/config/skills` and related Gemini config paths. | No reliable per-skill enable/disable setting found in official docs. Community reports show path confusion across versions.                                             | Defer full support. A read/list/install/delete-only adapter may be possible after the install path is validated locally. |
| Windsurf    | `windsurf`    | `~/.codeium/windsurf/skills`, `.windsurf/skills`, plus `.agents/skills` and `~/.agents/skills` for cross-agent compatibility.                       | No documented per-skill filesystem setting. UI supports skill management, but no stable config file was identified.                                                     | Not a good fit for full toggle support. Avoid inventing frontmatter or rename-based toggles.                             |
| Replit      | `replit`      | Project `/.agents/skills`; docs also describe user-level and enterprise scopes.                                                                     | Replit UI can enable/disable skills. Some Replit docs mention project skill management, but no local user-level settings file suitable for skill-switch was identified. | Defer. Project/cloud-oriented behavior does not fit the current user-level local model.                                  |
| Amp         | `amp`         | `~/.config/amp/skills`, `~/.config/agents/skills`, `.agents/skills`, and Claude-compatible directories.                                             | `amp.skills.disableClaudeCodeSkills` disables loading Claude Code skill directories as a source, but it is not a per-skill toggle.                                      | Not a good fit for full toggle support. list/install/delete-only support may be possible.                                |
| Warp        | `warp`        | `~/.warp/skills`, `.warp/skills`, `.agents/skills`, and many other agent-compatible directories.                                                    | No documented per-skill enable/disable settings file. Skills are discovered from broad scope paths.                                                                     | Not a good fit for full toggle support. list/install/delete-only support may be possible.                                |
| AdaL        | `adal`        | `~/.adal/skills`, `.adal/skills`, and `~/.adal/plugin-cache` for plugin-installed skill groups.                                                     | No documented per-skill enable/disable setting. Plugin install/uninstall exists, but that is not a toggle.                                                              | Not a good fit for full toggle support. list/install/delete-only support may be possible.                                |

Sources:

- Antigravity Skills: https://antigravity.google/docs/skills
- Antigravity CLI Plugins: https://antigravity.google/docs/cli-plugins
- Windsurf Skills: https://docs.windsurf.com/windsurf/cascade/skills
- Replit Agent Skills: https://docs.replit.com/references/agent/skills
- Amp manual: https://ampcode.com/manual
- Warp Skills: https://docs.warp.dev/agent-platform/capabilities/skills
- AdaL Skills & Plugins: https://docs.sylph.ai/features/plugins-and-skills

## gh Supported Agents

This is the agent list shown by `gh skill install --help`.

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
