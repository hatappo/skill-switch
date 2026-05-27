<p align="center">
  <a href="./README.md">en</a> | <a href="./README_ja.md">ja</a>
</p>

# skill-switch

`skill-switch` は、Codex、Claude Code、Cursor の user-level Agent Skills を横断して一覧表示し、On/Off を切り替える依存パッケージなしの TypeScript TUI/CLI です。

Skill の一致判定は `SKILL.md` frontmatter の `name` で行います。`name` がない場合は親ディレクトリ名を使います。

## 対応 Agent

Agent ID は `gh skill install --help` の括弧内の名称に合わせています。例: `codex`、`claude-code`、`cursor`

| Agent       | ID            | User skill folders                    | 反映先                                                                          |
| ----------- | ------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Codex       | `codex`       | `~/.agents/skills`, `~/.codex/skills` | `~/.codex/config.toml` の `[[skills.config]]` に `path` と `enabled` を書き込み |
| Claude Code | `claude-code` | `~/.claude/skills`                    | `~/.claude/settings.json` の `skillOverrides` を書き込み                        |
| Cursor      | `cursor`      | `~/.cursor/skills`                    | 各 skill の `SKILL.md` frontmatter に `disable-model-invocation` を書き込み     |

Cursor は Codex のような path ベースの一括 On/Off 設定を公開していないため、このツールでは `disable-model-invocation` を使います。これは自動呼び出しを止める設定で、明示呼び出しの扱いは Cursor 側の仕様に従います。

`~/.cursor/skills-cursor` は Cursor が管理するディレクトリなので、このツールでは対象外です。

## 使い方

`skill-switch` コマンドとして使いたい場合:

```bash
pnpm link --global
skill-switch
```

リポジトリから直接起動する場合:

```bash
pnpm start
```

引数なしで起動すると TUI を開きます。

```bash
node src/cli.ts list
node src/cli.ts list --format json
node src/cli.ts set sample-skill all off
node src/cli.ts set sample-skill codex claude-code on
```

## TUI

ステータス色:

| Status     | 色                   |
| ---------- | -------------------- |
| `ON`       | 緑                   |
| `OFF`      | 赤                   |
| `MIX`      | 黄                   |
| `-`        | グレー               |
| 未保存変更 | `*` 付きの太字シアン |

キー操作:

| Key                     | 動作                                             |
| ----------------------- | ------------------------------------------------ |
| `Up`/`Down`, `j`/`k`    | skill 行を移動                                   |
| `Left`/`Right`, `h`/`l` | Agent 列を移動                                   |
| `Space`                 | 選択中のセルだけ On/Off                          |
| `a`                     | 選択中の skill 行を、存在する Agent 全体でトグル |
| `o`                     | 選択中の skill 行を、存在する Agent 全体で ON    |
| `x`                     | 選択中の skill 行を、存在する Agent 全体で OFF   |
| `s`                     | 未保存変更を保存                                 |
| `r`                     | ディスクから再読み込みし、未保存変更を破棄       |
| `q`                     | 終了                                             |

## チェック

```bash
pnpm check
pnpm lint
pnpm format:check
pnpm format
```

## 参考

- Codex Agent Skills docs: https://developers.openai.com/codex/skills
- Claude Code Skills docs: https://code.claude.com/docs/en/skills
- Cursor Agent Skills forum guidance: https://forum.cursor.com/t/can-i-run-cursor-cli-without-loading-skills-or-with-only-specific-skill/152608
