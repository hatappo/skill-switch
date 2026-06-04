# Agent Support Notes

このメモは、skill-switch で調査したものの、現時点では未対応としている Agent の記録です。
full support の条件は、skill directory を rename/delete せずに更新できる、native かつ安定した
skill 単位の有効/無効設定があることです。

調査日: 2026-06-03.

| Agent       | ID            | documented skill locations                                                                                                                       | 見つかった toggle signal                                                                                                                     | 現時点の判断                                                                                                    |
| ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Antigravity | `antigravity` | CLI docs では `~/.gemini/antigravity-cli/skills`。IDE/global docs では `~/.gemini/config/skills` など Gemini config 系 path へ変遷が見られます。 | 公式 docs では信頼できる skill 単位の enable/disable 設定を確認できませんでした。community reports でも version 間の path 混乱が目立ちます。 | full support は見送り。install path をローカル検証できれば read/list/install/delete-only adapter はありえます。 |
| Windsurf    | `windsurf`    | `~/.codeium/windsurf/skills`, `.windsurf/skills`。cross-agent compatibility として `.agents/skills`, `~/.agents/skills` も discovery 対象。      | UI で skill 管理はできますが、安定した filesystem 上の skill 単位設定は確認できませんでした。                                                | full toggle support には向きません。独自 frontmatter や rename toggle は避けます。                              |
| Replit      | `replit`      | project `/.agents/skills`。docs では user-level / enterprise scope も説明されています。                                                          | Replit UI では enable/disable 可能。ただし skill-switch が扱える local user-level settings file は特定できませんでした。                     | 見送り。現在の user-level local model より project/cloud 寄りです。                                             |
| Amp         | `amp`         | `~/.config/amp/skills`, `~/.config/agents/skills`, `.agents/skills`, Claude-compatible directories。                                             | `amp.skills.disableClaudeCodeSkills` は Claude Code skill directory source を無効化する設定で、skill 単位の toggle ではありません。          | full toggle support には向きません。list/install/delete-only 対応なら可能性あり。                               |
| Warp        | `warp`        | `~/.warp/skills`, `.warp/skills`, `.agents/skills` ほか多数の agent-compatible directories。                                                     | skill 単位の enable/disable settings file は公式 docs で確認できませんでした。                                                               | full toggle support には向きません。list/install/delete-only 対応なら可能性あり。                               |
| AdaL        | `adal`        | `~/.adal/skills`, `.adal/skills`, plugin-installed skill group 用の `~/.adal/plugin-cache`。                                                     | skill 単位の enable/disable 設定は確認できませんでした。plugin install/uninstall はありますが toggle ではありません。                        | full toggle support には向きません。list/install/delete-only 対応なら可能性あり。                               |

Sources:

- Antigravity Skills: https://antigravity.google/docs/skills
- Antigravity CLI Plugins: https://antigravity.google/docs/cli-plugins
- Windsurf Skills: https://docs.windsurf.com/windsurf/cascade/skills
- Replit Agent Skills: https://docs.replit.com/references/agent/skills
- Amp manual: https://ampcode.com/manual
- Warp Skills: https://docs.warp.dev/agent-platform/capabilities/skills
- AdaL Skills & Plugins: https://docs.sylph.ai/features/plugins-and-skills

## gh Supported Agents

`gh skill install --help` に表示される Agent 一覧です。

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
