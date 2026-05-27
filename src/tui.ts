import readline from "node:readline";
import { AGENT_LABELS, AGENTS, type AgentName, formatStatus, SkillManager, type SkillRow } from "./core.ts";

type PendingKey = `${string}\0${AgentName}`;
type DisplayStatus = "ON" | "OFF" | "MIX" | "-";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  reverse: "\x1b[7m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
};

export async function runTui(manager: SkillManager): Promise<number> {
  const tui = new SkillTui(manager);
  return tui.run();
}

class SkillTui {
  private readonly manager: SkillManager;
  private rows: SkillRow[] = [];
  private rowIndex = 0;
  private agentIndex = 0;
  private readonly pending = new Map<PendingKey, boolean>();
  private message = "";

  constructor(manager: SkillManager) {
    this.manager = manager;
  }

  async run(): Promise<number> {
    this.reload();
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    this.draw();
    return new Promise((resolve) => {
      const onKeypress = (_chunk: string, key: readline.Key) => {
        if (this.handleKey(key)) {
          process.stdin.off("keypress", onKeypress);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.pause();
          process.stdout.write("\x1b[?25h\x1b[0m\n");
          resolve(0);
          return;
        }
        this.draw();
      };
      process.stdin.on("keypress", onKeypress);
    });
  }

  private reload(): void {
    this.rows = this.manager.scan();
    this.rowIndex = Math.min(this.rowIndex, Math.max(0, this.rows.length - 1));
    this.message = `Loaded ${this.rows.length} skills.`;
  }

  private handleKey(key: readline.Key): boolean {
    if (key.ctrl && key.name === "c") {
      return true;
    }
    if (key.name === "q" || key.name === "escape") {
      if (this.pending.size > 0) {
        this.message = "Pending changes remain. Press s to save or r to discard.";
        return false;
      }
      return true;
    }
    if (key.name === "up" || key.name === "k") {
      this.rowIndex = Math.max(0, this.rowIndex - 1);
    } else if (key.name === "down" || key.name === "j") {
      this.rowIndex = Math.min(Math.max(0, this.rows.length - 1), this.rowIndex + 1);
    } else if (key.name === "left" || key.name === "h") {
      this.agentIndex = Math.max(0, this.agentIndex - 1);
    } else if (key.name === "right" || key.name === "l") {
      this.agentIndex = Math.min(AGENTS.length - 1, this.agentIndex + 1);
    } else if (key.name === "space") {
      this.toggleCell();
    } else if (key.name === "a") {
      this.toggleRow();
    } else if (key.name === "o") {
      this.setRow(true);
    } else if (key.name === "x") {
      this.setRow(false);
    } else if (key.name === "s") {
      this.save();
    } else if (key.name === "r") {
      this.pending.clear();
      this.reload();
    }
    return false;
  }

  private draw(): void {
    const width = process.stdout.columns || 100;
    const height = process.stdout.rows || 30;
    const nameWidth = Math.max(18, Math.min(42, width - 40));
    const visibleHeight = Math.max(0, height - 5);
    const top = Math.min(
      Math.max(0, this.rowIndex - visibleHeight + 1),
      Math.max(0, this.rows.length - visibleHeight),
    );

    process.stdout.write("\x1b[?25l\x1b[H\x1b[2J");
    this.writeLine("skill-switch | Space=cell | a=row toggle | o=row on | x=row off", width, true);
    this.writeLine("             | s=save | r=reload | q=quit", width);
    this.writeLine(
      `${"Skill".padEnd(nameWidth)}  ${AGENT_LABELS.codex.padStart(6)}  ${AGENT_LABELS["claude-code"].padStart(11)}  ${AGENT_LABELS.cursor.padStart(6)}`,
      width,
    );

    for (let offset = 0; offset < visibleHeight; offset += 1) {
      const row = this.rows[top + offset];
      if (!row) {
        this.writeLine("", width);
        continue;
      }
      const selectedRow = top + offset === this.rowIndex;
      const rowName = row.name.slice(0, nameWidth).padEnd(nameWidth);
      let line = selectedRow ? `${ANSI.reverse}${rowName}${ANSI.reset}` : rowName;
      for (const agent of AGENTS) {
        const selectedCell = selectedRow && agent === AGENTS[this.agentIndex];
        line += `  ${this.renderStatusCell(row, agent, selectedCell, agent === "claude-code" ? 11 : 6)}`;
      }
      this.writeLine(line, width);
    }

    const footer = `${this.message}  Pending: ${this.pending.size}`;
    this.writeLine(footer, width);
  }

  private writeLine(text: string, width: number, bold = false): void {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
    const rendered = text.includes("\x1b[") ? text : text.slice(0, width);
    const padding = " ".repeat(Math.max(0, width - Math.min(visible.length, width)));
    process.stdout.write(`${bold ? ANSI.bold : ""}${rendered}${padding}${ANSI.reset}\n`);
  }

  private currentRow(): SkillRow | undefined {
    return this.rows[this.rowIndex];
  }

  private displayStatus(row: SkillRow, agent: AgentName): DisplayStatus {
    const staged = this.pending.get(this.key(row.name, agent));
    if (staged !== undefined) {
      return staged ? "ON" : "OFF";
    }
    return formatStatus(row.status(agent)) as DisplayStatus;
  }

  private renderStatusCell(row: SkillRow, agent: AgentName, selected: boolean, width: number): string {
    const pending = this.pending.has(this.key(row.name, agent));
    const label = `${this.displayStatus(row, agent)}${pending ? "*" : ""}`.padStart(width);
    const color = this.statusColor(this.displayStatus(row, agent), pending);
    const decorated = `${color}${label}${ANSI.reset}`;
    return selected ? `${ANSI.reverse}${decorated}${ANSI.reset}` : decorated;
  }

  private statusColor(status: DisplayStatus, pending: boolean): string {
    if (pending) {
      return ANSI.cyan + ANSI.bold;
    }
    if (status === "ON") {
      return ANSI.green;
    }
    if (status === "OFF") {
      return ANSI.red;
    }
    if (status === "MIX") {
      return ANSI.yellow;
    }
    return ANSI.dim;
  }

  private toggleCell(): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    const agent = AGENTS[this.agentIndex];
    const status = row.status(agent);
    if (status === "-") {
      this.message = `${row.name} is not installed for ${agent}.`;
      return;
    }
    const key = this.key(row.name, agent);
    const current = this.pending.get(key) ?? status === "on";
    this.pending.set(key, !current);
    this.message = `Staged ${row.name} ${agent} -> ${!current ? "on" : "off"}.`;
  }

  private toggleRow(): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    const values = AGENTS.flatMap((agent) => {
      const status = row.status(agent);
      if (status === "-") {
        return [];
      }
      return [this.pending.get(this.key(row.name, agent)) ?? status === "on"];
    });
    if (values.length > 0) {
      this.setRow(!values.every(Boolean));
    }
  }

  private setRow(enabled: boolean): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    for (const agent of AGENTS) {
      if (row.status(agent) !== "-") {
        this.pending.set(this.key(row.name, agent), enabled);
      }
    }
    this.message = `Staged ${row.name} across installed agents -> ${enabled ? "on" : "off"}.`;
  }

  private save(): void {
    let changed = 0;
    for (const [key, enabled] of this.pending) {
      const [skill, agent] = key.split("\0") as [string, AgentName];
      changed += this.manager.applyState(skill, [agent], enabled).length;
    }
    this.pending.clear();
    this.reload();
    this.message = `Saved ${changed} agent changes.`;
  }

  private key(skill: string, agent: AgentName): PendingKey {
    return `${skill}\0${agent}`;
  }
}
