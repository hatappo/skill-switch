import { spawnSync } from "node:child_process";
import readline from "node:readline";
import {
  AGENT_LABELS,
  AGENT_COLUMN_WIDTHS,
  AGENTS,
  type AgentName,
  checkGhCommand,
  formatStatus,
  type InstallCommand,
  SkillManager,
  type SkillRow,
} from "./core.ts";

type PendingKey = `${string}\0${AgentName}`;
type DisplayStatus = "ON" | "OFF" | "MIX" | "-";
type InstallPlan = {
  skill: string;
  commands: InstallCommand[];
};
type DeletePlan = {
  skill: string;
  targets: string[];
};

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
  private installPlan: InstallPlan | null = null;
  private deletePlan: DeletePlan | null = null;
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
    if (this.installPlan) {
      return this.handleInstallConfirmation(key);
    }
    if (this.deletePlan) {
      return this.handleDeleteConfirmation(key);
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
    } else if (key.name === "t") {
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
    } else if (key.name === "i") {
      this.prepareInstallMissing();
    } else if (key.name === "d") {
      this.prepareDelete();
    }
    return false;
  }

  private draw(): void {
    const width = process.stdout.columns || 100;
    const height = process.stdout.rows || 30;
    const agentColumnsWidth = AGENTS.reduce(
      (total, agent) => total + 2 + AGENT_COLUMN_WIDTHS[agent],
      0,
    );
    const nameWidth = Math.max(12, Math.min(42, width - agentColumnsWidth));
    const visibleHeight = Math.max(0, height - 5);
    const top = Math.min(
      Math.max(0, this.rowIndex - visibleHeight + 1),
      Math.max(0, this.rows.length - visibleHeight),
    );

    process.stdout.write("\x1b[?25l\x1b[H\x1b[2J");
    this.writeLine("skwitch | Space=cell | t=toggle row | o=row on | x=row off", width, true);
    this.writeLine(
      "        | d=delete row | i=install missing | s=save | r=reload | q=quit",
      width,
      true,
    );
    this.writeLine(
      [
        "Skill".padEnd(nameWidth),
        ...AGENTS.map((agent) => AGENT_LABELS[agent].padStart(AGENT_COLUMN_WIDTHS[agent])),
      ].join("  "),
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
        line += `  ${this.renderStatusCell(row, agent, selectedCell, AGENT_COLUMN_WIDTHS[agent])}`;
      }
      this.writeLine(line, width);
    }

    const footer = `${this.message}  Pending: ${this.pending.size}`;
    this.writeLine(`${ANSI.reverse}${ANSI.bold}${footer}`, width);
  }

  private writeLine(text: string, width: number, bold = false): void {
    const visible = this.stripAnsi(text);
    const rendered = text.includes("\x1b[") ? text : text.slice(0, width);
    const padding = " ".repeat(Math.max(0, width - Math.min(visible.length, width)));
    process.stdout.write(`${bold ? ANSI.bold : ""}${rendered}${padding}${ANSI.reset}\n`);
  }

  private stripAnsi(text: string): string {
    let output = "";
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\x1b" && text[index + 1] === "[") {
        index += 2;
        while (index < text.length && text[index] !== "m") {
          index += 1;
        }
      } else {
        output += text[index];
      }
    }
    return output;
  }

  private currentRow(): SkillRow | undefined {
    return this.rows[this.rowIndex];
  }

  private handleInstallConfirmation(key: readline.Key): boolean {
    const plan = this.installPlan;
    if (!plan) {
      return false;
    }
    if (key.name === "y") {
      this.executeInstallPlan();
    } else if (key.name === "n" || key.name === "escape") {
      this.installPlan = null;
      this.message = `Cancelled install for ${plan.skill}.`;
    } else {
      this.message = "Install is ready. Press y to run gh skill install, or n to cancel.";
    }
    return false;
  }

  private handleDeleteConfirmation(key: readline.Key): boolean {
    const plan = this.deletePlan;
    if (!plan) {
      return false;
    }
    if (key.name === "y") {
      this.executeDeletePlan();
    } else if (key.name === "n" || key.name === "escape") {
      this.deletePlan = null;
      this.message = `Cancelled delete for ${plan.skill}.`;
    } else {
      this.message = "Delete is ready. Press y to delete skill directories, or n to cancel.";
    }
    return false;
  }

  private displayStatus(row: SkillRow, agent: AgentName): DisplayStatus {
    const staged = this.pending.get(this.key(row.name, agent));
    if (staged !== undefined) {
      return staged ? "ON" : "OFF";
    }
    return formatStatus(row.status(agent)) as DisplayStatus;
  }

  private renderStatusCell(
    row: SkillRow,
    agent: AgentName,
    selected: boolean,
    width: number,
  ): string {
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

  private prepareInstallMissing(): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    if (this.pending.size > 0) {
      this.message = "Save or reload pending changes before installing missing skills.";
      return;
    }

    const ghError = checkGhCommand();
    if (ghError) {
      this.message = ghError;
      return;
    }

    let commands: InstallCommand[];
    try {
      commands = this.manager.buildInstallMissingCommands(row.name);
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
      return;
    }

    if (commands.length === 0) {
      this.message = `${row.name} is already installed for all supported agents.`;
      return;
    }

    this.installPlan = { skill: row.name, commands };
    const agents = commands.map((command) => AGENT_LABELS[command.agent]).join(", ");
    this.message = `Install ${row.name} for ${agents}? Press y to run gh, n to cancel.`;
  }

  private prepareDelete(): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    if (this.pending.size > 0) {
      this.message = "Save or reload pending changes before deleting skills.";
      return;
    }

    const targets = this.manager.deleteTargets(row.name);
    if (targets.length === 0) {
      this.message = `No installed directories found for ${row.name}.`;
      return;
    }

    this.deletePlan = { skill: row.name, targets };
    this.message = `Delete ${row.name} from ${targets.length} directories? Press y to delete, n to cancel.`;
  }

  private executeInstallPlan(): void {
    const plan = this.installPlan;
    if (!plan) {
      return;
    }
    this.installPlan = null;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write("\x1b[?25h\x1b[0m\n");

    let installed = 0;
    let resultMessage = "";
    for (const command of plan.commands) {
      console.log(`$ ${command.command}`);
      const result = spawnSync("gh", command.args, { stdio: "inherit" });
      if (result.error) {
        resultMessage = `Failed to run gh: ${result.error.message}`;
        break;
      }
      if (result.status !== 0) {
        resultMessage = `Install failed for ${AGENT_LABELS[command.agent]} with exit ${result.status ?? 1}.`;
        break;
      }
      installed += 1;
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    this.reload();
    this.message = resultMessage || `Installed ${plan.skill} for ${installed} missing agents.`;
  }

  private executeDeletePlan(): void {
    const plan = this.deletePlan;
    if (!plan) {
      return;
    }
    this.deletePlan = null;

    let deleted: string[];
    try {
      deleted = this.manager.deleteSkill(plan.skill);
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
      return;
    }

    this.reload();
    this.message = `Deleted ${plan.skill} from ${deleted.length} directories.`;
  }

  private key(skill: string, agent: AgentName): PendingKey {
    return `${skill}\0${agent}`;
  }
}
