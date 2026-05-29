<p align="center">
  <a href="./README.md">en</a> | ja
</p>

# skwitch

`skwitch` は、複数の Agent Skill の有効/無効をエージェント横断でまとめて切り替える TUI です。

![skwitch TUI screenshot](./docs/img/screenshot-tui.png)

## 特長

- 各 Agent の user level skill をひとつのテーブルで横断的に On/Off、インストール、削除できます。
- On/Off の切り替えは skill ディレクトリの rename ではなく、各 Agent の native な有効/無効設定を更新します。
- インストールは `gh skill install` コマンドと連携し、provenance metadata がない場合は local copy に fallback します。
- runtime package dependency はありません。

## 対応 Agent

Agent ID は `gh skill install --help` の括弧内の名称に合わせています。

| Agent              | ID               | User skill folders                                                  | 反映先                                                                          |
| ------------------ | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Codex              | `codex`          | `~/.agents/skills`, `~/.codex/skills`                               | `~/.codex/config.toml` の `[[skills.config]]` に `path` と `enabled` を書き込み |
| Claude Code        | `claude-code`    | `~/.claude/skills`                                                  | `~/.claude/settings.json` の `skillOverrides` を書き込み                        |
| Cursor             | `cursor`         | `~/.cursor/skills`                                                  | 各 skill の `SKILL.md` frontmatter に `disable-model-invocation` を書き込み     |
| GitHub Copilot CLI | `github-copilot` | `~/.copilot/skills`, `~/.agents/skills`                             | `~/.copilot/settings.json` の `disabledSkills` を書き込み                       |
| OpenCode           | `opencode`       | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | `~/.config/opencode/opencode.json` の `permission.skill` を書き込み             |
| Gemini CLI         | `gemini-cli`     | `~/.gemini/skills`                                                  | `~/.gemini/settings.json` の `skills.disabled` を書き込み                       |

Cursor は Codex のような path ベースの一括 On/Off 設定を公開していないため、このツールでは `disable-model-invocation` を使います。これは自動呼び出しを止める設定で、明示呼び出しの扱いは Cursor 側の仕様に従います。

`~/.cursor/skills-cursor` は Cursor が管理するディレクトリなので、このツールでは対象外です。

Skill の一致判定は `SKILL.md` frontmatter の `name` で行います。`name` がない場合は親ディレクトリ名を使います。

## 使い方

`skwitch` コマンドとして使いたい場合:

```bash
pnpm link --global
skwitch
```

リポジトリから直接起動する場合:

```bash
pnpm start
```

引数なしで起動すると TUI を開きます。

確認、snapshot、dry-run install 用の補助コマンドを用意しています。

```bash
node src/cli.ts help
node src/cli.ts --version
node src/cli.ts list
node src/cli.ts list --format json
node src/cli.ts export > skills.json
node src/cli.ts import skills.json
node src/cli.ts apply skills.json
node src/cli.ts install-missing frontend-design
node src/cli.ts install-missing frontend-design cursor --execute
```

`export` は再現可能な `on`/`off` 状態を JSON snapshot として出力します。`mixed` と
missing 状態は省略します。

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

`import skills.json` は snapshot との差分を未適用変更として読み込んだ状態で TUI を開きます。
確認してから `a` で apply できます。`apply skills.json` は TUI を開かずに同じ snapshot を
直接反映するため、dotfiles や bootstrap script に向いています。

`install-missing` は、既にインストール済みの skill の `SKILL.md` から
`metadata.github-repo` と `metadata.github-path` を読み取り、その skill が存在しない
Agent 向けの `gh skill install --scope user --agent ...` コマンドを作ります。デフォルトでは
コマンド表示だけを行い、`--execute` を付けた場合だけ実行します。
GitHub provenance がない場合は、既存の local skill directory を missing Agent の primary
user skill folder へコピーします。
local copy 時は `SKILL.md` frontmatter を sanitize し、Agent Skills spec の field である
`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` だけを残します。
複数 Agent をインストール元として使える場合は、Codex、Claude Code、Cursor、
GitHub Copilot CLI、OpenCode、Gemini CLI の順で最初に見つかったものを使います。

TUI でも同じ操作ができます。skill 行を選んで `i` を押し、`y` で確認すると、その skill が
存在しない対応 Agent へまとめてインストールします。
GitHub provenance を使う経路では `gh skill install` が必要です。local copy fallback では
`gh` は不要です。

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

| Key                     | コマンド        | 動作                                             |
| ----------------------- | --------------- | ------------------------------------------------ |
| `Up`/`Down`, `j`/`k`    | move row        | skill 行を移動                                   |
| `Left`/`Right`, `h`/`l` | move column     | Agent 列を移動                                   |
| `Space`                 | toggle cell     | 選択中のセルだけ On/Off                          |
| `t`                     | toggle row      | 選択中の skill 行を、存在する Agent 全体でトグル |
| `o`                     | row on          | 選択中の skill 行を、存在する Agent 全体で ON    |
| `x`                     | row off         | 選択中の skill 行を、存在する Agent 全体で OFF   |
| `d`                     | delete row      | 選択中の skill 行を、存在する Agent 全体で削除   |
| `i`                     | install missing | 選択中の skill を未導入 Agent へ入れる準備       |
| `y`/`n`                 | confirm/cancel  | 準備したインストールの実行/キャンセル            |
| `a`                     | apply           | 未保存変更を各 Agent の設定へ反映                |
| `r`                     | reload          | ディスクから再読み込みし、未保存変更を破棄       |
| `q`                     | quit            | 終了                                             |

## 参考

- Codex Agent Skills docs: https://developers.openai.com/codex/skills
- Claude Code Skills docs: https://code.claude.com/docs/en/skills
- Cursor Agent Skills forum guidance: https://forum.cursor.com/t/can-i-run-cursor-cli-without-loading-skills-or-with-only-specific-skill/152608
- GitHub Copilot CLI docs: https://docs.github.com/copilot/reference/copilot-cli-reference/cli-command-reference
- OpenCode Agent Skills docs: https://opencode.ai/docs/skills/
- Gemini CLI configuration docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md
