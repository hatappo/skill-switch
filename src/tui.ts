import readline from "node:readline";
import {
  checkGhCommand,
  COLUMN_LABELS,
  COLUMN_WIDTHS,
  COLUMNS,
  type AgentName,
  type ColumnName,
  type InstallAction,
  SkillManager,
  type SkillSnapshot,
  type SkillRow,
} from "./core.ts";

type PendingKey = `${string}\0${ColumnName}`;
type DisplayStatus = string;
type InstallPlan = {
  skill: string;
  actions: InstallAction[];
};
type DeletePlan = {
  skill: string;
  targets: string[];
};
type TuiOptions = {
  snapshot?: SkillSnapshot;
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

export async function runTui(manager: SkillManager, options: TuiOptions = {}): Promise<number> {
  const tui = new SkillTui(manager, options);
  return tui.run();
}

class SkillTui {
  private readonly manager: SkillManager;
  private rows: SkillRow[] = [];
  private columns: ColumnName[] = [];
  private activeColumns: ColumnName[] = [];
  private activeAgentsColumnTargetAgents: AgentName[] = [];
  private rowIndex = 0;
  private agentIndex = 0;
  private readonly pending = new Map<PendingKey, boolean>();
  private installPlan: InstallPlan | null = null;
  private deletePlan: DeletePlan | null = null;
  private message = "";
  private showAllColumns = false;
  private expandFrontmatter = false;
  private showHelp = false;
  private readonly initialSnapshot?: SkillSnapshot;

  constructor(manager: SkillManager, options: TuiOptions) {
    this.manager = manager;
    this.initialSnapshot = options.snapshot;
  }

  async run(): Promise<number> {
    this.reload();
    if (this.initialSnapshot) {
      this.importSnapshot(this.initialSnapshot);
    }
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    this.draw();
    return new Promise((resolve) => {
      const onKeypress = (chunk: string, key: readline.Key) => {
        if (this.handleKey(chunk, key)) {
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
    this.refreshColumns();
    this.rowIndex = Math.min(this.rowIndex, Math.max(0, this.rows.length - 1));
    this.agentIndex = Math.min(this.agentIndex, Math.max(0, this.columns.length - 1));
    this.message = `Loaded ${this.rows.length} skills across ${this.columns.length} ${this.columnModeLabel()} columns.`;
  }

  private refreshColumns(): void {
    this.activeColumns = this.manager.activeColumns();
    this.activeAgentsColumnTargetAgents = this.manager.activeAgentsColumnTargetAgents();
    this.columns = this.showAllColumns ? [...COLUMNS] : this.activeColumns;
  }

  private handleKey(input: string, key: readline.Key): boolean {
    if (key.ctrl && key.name === "c") {
      return true;
    }
    if (this.showHelp) {
      return this.handleHelpKey(input, key);
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
      this.agentIndex = Math.min(Math.max(0, this.columns.length - 1), this.agentIndex + 1);
    } else if (key.name === "space") {
      this.toggleCell();
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
    } else if (key.name === "v") {
      this.toggleColumnView();
    } else if (key.name === "f") {
      this.toggleFrontmatterExpansion();
    } else if (this.isQuestionKey(input, key)) {
      this.showHelp = true;
    }
    return false;
  }

  private handleHelpKey(input: string, key: readline.Key): boolean {
    if (key.name === "q" || key.name === "escape" || this.isQuestionKey(input, key)) {
      this.showHelp = false;
    }
    return false;
  }

  private isQuestionKey(input: string, key: readline.Key): boolean {
    return input === "?" || key.sequence === "?";
  }

  private toggleFrontmatterExpansion(): void {
    this.expandFrontmatter = !this.expandFrontmatter;
    this.message = `Frontmatter pane: ${this.expandFrontmatter ? "expanded" : "compact"}.`;
  }

  private toggleColumnView(): void {
    this.showAllColumns = !this.showAllColumns;
    this.refreshColumns();
    this.agentIndex = Math.min(this.agentIndex, Math.max(0, this.columns.length - 1));
    this.message = `Column view: ${this.columnModeLabel()} columns.`;
  }

  private columnModeLabel(): string {
    return this.showAllColumns ? "all" : "active";
  }

  private draw(): void {
    const width = process.stdout.columns || 100;
    const height = process.stdout.rows || 30;
    if (this.showHelp) {
      this.drawHelp(width, height);
      return;
    }

    const controlsHeight = 5;
    const footerHeight = 1;
    const baseDetailHeight = height >= 18 ? 6 : Math.max(3, Math.floor(height / 4));
    const maxDetailHeight = Math.max(3, height - controlsHeight - footerHeight - 3);
    const detailHeight = this.expandFrontmatter
      ? Math.min(maxDetailHeight, Math.max(baseDetailHeight, this.expandedDetailHeight(width)))
      : baseDetailHeight;
    const skillsHeight = Math.max(3, height - controlsHeight - detailHeight - footerHeight);
    const tableHeight = Math.max(0, skillsHeight - 3);
    const agentColumnsWidth = this.columns.reduce(
      (total, column) => total + 2 + COLUMN_WIDTHS[column],
      0,
    );
    const nameWidth = Math.max(12, Math.min(42, width - 4 - agentColumnsWidth));
    const top = Math.min(
      Math.max(0, this.rowIndex - tableHeight + 1),
      Math.max(0, this.rows.length - tableHeight),
    );

    process.stdout.write("\x1b[?25l\x1b[H\x1b[2J");
    this.writeLines(
      this.renderBox(
        `Keys ${ANSI.dim}(press ? for help)${ANSI.reset}`,
        [
          `${this.keyText("Space")}=toggle cell | ${this.keyText("o")}=row on | ${this.keyText("x")}=row off`,
          `${this.keyText("s")}=save | ${this.keyText("r")}=reload | ${this.keyText("q")}=quit`,
          `${this.keyText("d")}=delete skill | ${this.keyText("i")}=install missing`,
        ],
        width,
        controlsHeight,
      ),
      width,
    );

    this.writeLines(this.detailPaneLines(width, detailHeight), width);

    const tableLines = [
      [
        "Skill".padEnd(nameWidth),
        ...this.columns.map((column) => this.renderColumnHeader(column)),
      ].join("  "),
    ];

    for (let offset = 0; offset < tableHeight - 1; offset += 1) {
      const row = this.rows[top + offset];
      if (!row) {
        tableLines.push("");
        continue;
      }
      const selectedRow = top + offset === this.rowIndex;
      const rowName = row.name.slice(0, nameWidth).padEnd(nameWidth);
      let line = selectedRow ? `${ANSI.reverse}${rowName}${ANSI.reset}` : rowName;
      for (const column of this.columns) {
        const selectedCell = selectedRow && column === this.columns[this.agentIndex];
        line += `  ${this.renderStatusCell(row, column, selectedCell, COLUMN_WIDTHS[column])}`;
      }
      tableLines.push(line);
    }
    this.writeLines(this.renderBox("Skills", tableLines, width, skillsHeight), width);

    const footer = `${this.message}  Pending: ${this.pending.size}`;
    this.writeFinalLine(`${this.footerStyle()}${footer}`, width);
  }

  private drawHelp(width: number, height: number): void {
    process.stdout.write("\x1b[?25l\x1b[H\x1b[2J");
    this.writeFrame(
      this.renderBox("Help", this.helpLines(width - 2, height - 2), width, height),
      width,
    );
  }

  private helpLines(width: number, height: number): string[] {
    return [
      `${ANSI.bold}Navigation${ANSI.reset}`,
      this.helpLine("Up/Down, j/k", "move row", width),
      this.helpLine("Left/Right, h/l", "move column", width),
      "",
      `${ANSI.bold}Toggle${ANSI.reset}`,
      this.helpLine("Space", "toggle selected cell", width),
      this.helpLine("o / x", "turn selected row on / off", width),
      "",
      `${ANSI.bold}Install/Delete${ANSI.reset}`,
      this.helpLine("i", "install for missing agents", width),
      this.helpLine("d", "delete skill", width),
      this.helpLine("y / n / Esc", "confirm / cancel install or delete", width),
      "",
      `${ANSI.bold}Save${ANSI.reset}`,
      this.helpLine("s", "save pending changes", width),
      this.helpLine("r", "reload from disk and clear pending changes", width),
      "",
      `${ANSI.bold}View${ANSI.reset}`,
      this.helpLine("f", "expand / collapse frontmatter", width),
      this.helpLine("v", "toggle active / all supported agent columns", width),
      "",
      `${ANSI.bold}Quit/Help${ANSI.reset}`,
      this.helpLine("?", "open / close help", width),
      this.helpLine("Esc", "close help or cancel prompt", width),
      this.helpLine("q", "quit; closes help when help is open", width),
    ].slice(0, height);
  }

  private helpLine(keys: string, description: string, width: number): string {
    const keyWidth = Math.min(20, Math.max(10, Math.floor(width * 0.28)));
    return `${this.padVisible(this.keyText(keys), keyWidth)} ${description}`;
  }

  private keyText(text: string): string {
    return `${ANSI.bold}${text}${ANSI.reset}`;
  }

  private footerStyle(): string {
    if (this.installPlan || this.deletePlan) {
      return ANSI.reverse + ANSI.bold + ANSI.yellow;
    }
    return ANSI.reverse + ANSI.bold;
  }

  private detailPaneLines(width: number, height: number): string[] {
    if (width >= 100 && height >= 4) {
      const [descriptionWidth, frontmatterWidth] = this.detailPaneWidths(width);
      const frontmatterLines = this.frontmatterPaneLines(frontmatterWidth - 2, height - 2);
      const hiddenCount = this.hiddenLineCount(
        this.selectedFrontmatterLinesForWidth(frontmatterWidth - 2),
        height - 2,
      );
      const descriptionBox = this.renderBox(
        this.descriptionPaneTitle(descriptionWidth - 2),
        this.descriptionPaneLines(descriptionWidth - 2, height - 2),
        descriptionWidth,
        height,
      );
      const frontmatterBox = this.renderBox(
        this.frontmatterPaneTitle(frontmatterWidth - 2, hiddenCount),
        frontmatterLines,
        frontmatterWidth,
        height,
      );
      return descriptionBox.map((line, index) => `${line}${frontmatterBox[index] ?? ""}`);
    }

    if (height < 6) {
      return this.renderBox(
        this.descriptionPaneTitle(width - 2),
        this.descriptionPaneLines(width - 2, height - 2),
        width,
        height,
      );
    }

    const descriptionHeight = this.expandFrontmatter ? 3 : Math.ceil(height / 2);
    const frontmatterHeight = height - descriptionHeight;
    const frontmatterLines = this.frontmatterPaneLines(width - 2, frontmatterHeight - 2);
    const hiddenCount = this.hiddenLineCount(
      this.selectedFrontmatterLinesForWidth(width - 2),
      frontmatterHeight - 2,
    );
    return [
      ...this.renderBox(
        this.descriptionPaneTitle(width - 2),
        this.descriptionPaneLines(width - 2, descriptionHeight - 2),
        width,
        descriptionHeight,
      ),
      ...this.renderBox(
        this.frontmatterPaneTitle(width - 2, hiddenCount),
        frontmatterLines,
        width,
        frontmatterHeight,
      ),
    ];
  }

  private expandedDetailHeight(width: number): number {
    if (width >= 100) {
      const [, frontmatterWidth] = this.detailPaneWidths(width);
      return this.selectedFrontmatterLinesForWidth(frontmatterWidth - 2).length + 2;
    }

    return this.selectedFrontmatterLinesForWidth(width - 2).length + 5;
  }

  private descriptionPaneLines(width: number, height: number): string[] {
    const row = this.currentRow();
    if (!row) {
      return ["No skill selected."];
    }

    const column = this.columns[this.agentIndex];
    if (!column) {
      return [`${ANSI.dim}Not installed${ANSI.reset}`];
    }

    const descriptionLines = this.selectedDescriptionLines(row, column, width);
    return descriptionLines.slice(0, height);
  }

  private frontmatterPaneLines(width: number, height: number): string[] {
    const row = this.currentRow();
    if (!row) {
      return ["No skill selected."];
    }

    const column = this.columns[this.agentIndex];
    if (!column) {
      return [`${ANSI.dim}Not installed${ANSI.reset}`];
    }

    return this.limitPaneLines(this.selectedFrontmatterLines(row, column, width), height);
  }

  private selectedFrontmatterLinesForWidth(width: number): string[] {
    const row = this.currentRow();
    const column = this.columns[this.agentIndex];
    if (!row || !column) {
      return [`${ANSI.dim}Not installed${ANSI.reset}`];
    }
    return this.selectedFrontmatterLines(row, column, width);
  }

  private selectedDescriptionLines(row: SkillRow, column: ColumnName, width: number): string[] {
    const description = row.description(column);
    if (description === null) {
      return [`${ANSI.dim}Not installed${ANSI.reset}`];
    }
    if (!description) {
      return [`${ANSI.dim}(no description)${ANSI.reset}`];
    }
    return this.wrapText(description, width);
  }

  private selectedFrontmatterLines(row: SkillRow, column: ColumnName, width: number): string[] {
    const frontmatter = row.frontmatter(column);
    if (frontmatter === null) {
      return [`${ANSI.dim}Not installed${ANSI.reset}`];
    }

    const lines = Object.entries(frontmatter)
      .filter(([key, value]) => key !== "name" && key !== "description" && value !== "")
      .flatMap(([key, value]) => this.wrapText(`${key}: ${value}`, width));
    return lines.length > 0 ? lines : [`${ANSI.dim}(no frontmatter)${ANSI.reset}`];
  }

  private limitPaneLines(lines: string[], height: number): string[] {
    return lines.slice(0, Math.max(0, height));
  }

  private hiddenLineCount(lines: string[], height: number): number {
    return Math.max(0, lines.length - Math.max(0, height));
  }

  private detailPaneWidths(width: number): [number, number] {
    const descriptionWidth = Math.floor(width * 0.58);
    return [descriptionWidth, width - descriptionWidth];
  }

  private descriptionPaneTitle(innerWidth: number): string {
    const row = this.currentRow();
    const column = this.columns[this.agentIndex];
    const path = row && column ? row.path(column) : null;
    return this.detailPaneTitle("Description", innerWidth, path);
  }

  private frontmatterPaneTitle(innerWidth: number, hiddenCount: number): string {
    const suffix = this.frontmatterTitleSuffix(hiddenCount);
    return this.detailPaneTitle("Frontmatter", innerWidth, suffix);
  }

  private frontmatterTitleSuffix(hiddenCount: number): string | null {
    if (this.expandFrontmatter) {
      return hiddenCount > 0
        ? `(+${hiddenCount} more; press f to collapse)`
        : "(press f to collapse)";
    }
    return hiddenCount > 0 ? `(+${hiddenCount} more; press f to expand)` : null;
  }

  private detailPaneTitle(label: string, innerWidth: number, suffix: string | null): string {
    if (!suffix) {
      return label;
    }

    const available = innerWidth - label.length - 3;
    if (available < 8) {
      return label;
    }
    const suffixText =
      label === "Description" ? this.truncateStart(suffix, available) : suffix.slice(0, available);
    return `${label}  ${ANSI.dim}${suffixText}${ANSI.reset}`;
  }

  private truncateStart(text: string, width: number): string {
    if (text.length <= width) {
      return text;
    }
    if (width <= 1) {
      return "…".slice(0, width);
    }
    return `…${text.slice(-(width - 1))}`;
  }

  private wrapText(text: string, width: number): string[] {
    if (width <= 0) {
      return [""];
    }

    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let current = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (word.length > width) {
          if (current) {
            lines.push(current);
            current = "";
          }
          for (let index = 0; index < word.length; index += width) {
            lines.push(word.slice(index, index + width));
          }
          continue;
        }

        const next = current ? `${current} ${word}` : word;
        if (next.length > width) {
          lines.push(current);
          current = word;
        } else {
          current = next;
        }
      }
      if (current || paragraph === "") {
        lines.push(current);
      }
    }
    return lines.length > 0 ? lines : [""];
  }

  private renderBox(title: string, lines: string[], width: number, height: number): string[] {
    const boxWidth = Math.max(2, width);
    const innerWidth = Math.max(0, boxWidth - 2);
    const contentHeight = Math.max(0, height - 2);
    const safeTitle = ` ${title} `;
    const renderedTitle = this.truncateVisible(safeTitle, innerWidth);
    const titleWidth = Math.min(this.stripAnsi(renderedTitle).length, innerWidth);
    const top = `┌${renderedTitle}${"─".repeat(Math.max(0, innerWidth - titleWidth))}┐`;
    const bottom = `└${"─".repeat(innerWidth)}┘`;
    const rendered = [top];
    for (let index = 0; index < contentHeight; index += 1) {
      rendered.push(`│${this.padVisible(lines[index] ?? "", innerWidth)}│`);
    }
    rendered.push(bottom);
    return rendered;
  }

  private writeLines(lines: string[], width: number): void {
    for (const line of lines) {
      this.writeLine(line, width);
    }
  }

  private writeFrame(lines: string[], width: number): void {
    const lastIndex = lines.length - 1;
    for (let index = 0; index < lines.length; index += 1) {
      if (index === lastIndex) {
        this.writeFinalLine(lines[index], width);
      } else {
        this.writeLine(lines[index], width);
      }
    }
  }

  private writeLine(text: string, width: number, bold = false): void {
    process.stdout.write(`${this.renderLine(text, width, bold)}\n`);
  }

  private writeFinalLine(text: string, width: number, bold = false): void {
    process.stdout.write(this.renderLine(text, width, bold));
  }

  private renderLine(text: string, width: number, bold = false): string {
    const visible = this.stripAnsi(text);
    const rendered = text.includes("\x1b[") ? text : text.slice(0, width);
    const padding = " ".repeat(Math.max(0, width - Math.min(visible.length, width)));
    return `${bold ? ANSI.bold : ""}${rendered}${padding}${ANSI.reset}`;
  }

  private padVisible(text: string, width: number): string {
    const visible = this.stripAnsi(text);
    const rendered = text.includes("\x1b[") ? text : text.slice(0, width);
    const padding = " ".repeat(Math.max(0, width - Math.min(visible.length, width)));
    return `${rendered}${padding}`;
  }

  private truncateVisible(text: string, width: number): string {
    if (this.stripAnsi(text).length <= width) {
      return text;
    }
    if (!text.includes("\x1b[")) {
      return text.slice(0, width);
    }

    let output = "";
    let visibleLength = 0;
    for (let index = 0; index < text.length && visibleLength < width; index += 1) {
      if (text[index] === "\x1b" && text[index + 1] === "[") {
        const start = index;
        index += 2;
        while (index < text.length && text[index] !== "m") {
          index += 1;
        }
        output += text.slice(start, index + 1);
      } else {
        output += text[index];
        visibleLength += 1;
      }
    }
    return `${output}${ANSI.reset}`;
  }

  private renderColumnHeader(column: ColumnName): string {
    const label = COLUMN_LABELS[column].padStart(COLUMN_WIDTHS[column]);
    return this.isActiveColumn(column) ? label : `${ANSI.dim}${label}${ANSI.reset}`;
  }

  private isActiveColumn(column: ColumnName): boolean {
    return this.activeColumns.includes(column);
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
      this.message = "Confirm install: press y to run gh skill install, or n/Esc to cancel.";
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
      this.message = "Confirm delete: press y to delete skill directories, or n/Esc to cancel.";
    }
    return false;
  }

  private displayStatus(row: SkillRow, column: ColumnName): DisplayStatus {
    const staged = this.pending.get(this.key(row.name, column));
    if (staged !== undefined) {
      return staged ? "ON" : "OFF";
    }
    return row.statusLabel(column, this.activeAgentsColumnTargetAgents);
  }

  private renderStatusCell(
    row: SkillRow,
    column: ColumnName,
    selected: boolean,
    width: number,
  ): string {
    const pending = this.pending.has(this.key(row.name, column));
    const label = `${this.displayStatus(row, column)}${pending ? "*" : ""}`.padStart(width);
    const color = this.statusColor(this.displayStatus(row, column), pending);
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
    if (/^\d+\/\d+$/.test(status)) {
      return ANSI.yellow;
    }
    return ANSI.dim;
  }

  private toggleCell(): void {
    const row = this.currentRow();
    const agent = this.columns[this.agentIndex];
    if (!row || !agent) {
      return;
    }
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

  private setRow(enabled: boolean): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    for (const agent of this.columns) {
      if (row.status(agent) !== "-") {
        this.pending.set(this.key(row.name, agent), enabled);
      }
    }
    this.message = `Staged ${row.name} across installed columns -> ${enabled ? "on" : "off"}.`;
  }

  private save(): void {
    let changed = 0;
    for (const [key, enabled] of this.pending) {
      const [skill, agent] = key.split("\0") as [string, ColumnName];
      changed += this.manager.applyState(skill, [agent], enabled).length;
    }
    this.pending.clear();
    this.reload();
    this.message = `Saved ${changed} agent changes.`;
  }

  private importSnapshot(snapshot: SkillSnapshot): void {
    const plan = this.manager.planSnapshot(snapshot);
    for (const change of plan.changes) {
      this.pending.set(this.key(change.skill, change.agent), change.enabled);
    }
    this.message =
      `Imported ${plan.changes.length} pending changes. ` +
      `Unchanged ${plan.unchanged.length}. Skipped ${plan.skipped.length}.`;
  }

  private prepareInstallMissing(): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    if (this.pending.size > 0) {
      this.message = "Apply or reload pending changes before installing missing skills.";
      return;
    }

    let actions: InstallAction[];
    try {
      actions = this.manager.buildInstallMissingActions(row.name);
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error);
      return;
    }

    if (actions.length === 0) {
      this.message = `${row.name} is already installed for all supported agents.`;
      return;
    }

    const ghError = actions.some((action) => action.kind === "gh") ? checkGhCommand() : null;
    if (ghError) {
      this.message = ghError;
      return;
    }

    this.installPlan = { skill: row.name, actions };
    const agents = actions.map((action) => COLUMN_LABELS[action.agent]).join(", ");
    const method = actions[0]?.kind === "copy" ? "copy locally" : "run gh";
    this.message = `Confirm install: ${row.name} for ${agents}? Press y to ${method}, n/Esc to cancel.`;
  }

  private prepareDelete(): void {
    const row = this.currentRow();
    if (!row) {
      return;
    }
    if (this.pending.size > 0) {
      this.message = "Apply or reload pending changes before deleting skills.";
      return;
    }

    const targets = this.manager.deleteTargets(row.name);
    if (targets.length === 0) {
      this.message = `No installed directories found for ${row.name}.`;
      return;
    }

    this.deletePlan = { skill: row.name, targets };
    this.message = `Confirm delete: ${row.name} from ${targets.length} directories? Press y to delete, n/Esc to cancel.`;
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
    for (const action of plan.actions) {
      console.log(`$ ${action.command}`);
      try {
        this.manager.executeInstallAction(action);
      } catch (error) {
        resultMessage = `Install failed for ${COLUMN_LABELS[action.agent]}: ${error instanceof Error ? error.message : String(error)}`;
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

  private key(skill: string, agent: ColumnName): PendingKey {
    return `${skill}\0${agent}`;
  }
}
