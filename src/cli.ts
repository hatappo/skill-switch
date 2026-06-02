#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  COLUMNS,
  type ColumnName,
  checkGhCommand,
  formatSnapshot,
  parseSnapshot,
  SkillManager,
} from "./core.ts";
import { runTui } from "./tui.ts";

type ParsedArgs = {
  home: string;
  command?: string;
  rest: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  let home = homedir();
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--home") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--home requires a path");
      }
      home = resolve(next);
      index += 1;
    } else if (value.startsWith("--home=")) {
      home = resolve(value.slice("--home=".length));
    } else {
      rest.push(value);
    }
  }

  return { home, command: rest[0], rest: rest.slice(1) };
}

function usage(): string {
  return [
    "Usage:",
    "  skill-switch [--home PATH] [tui]",
    "  skill-switch help",
    "  skill-switch version",
    "",
    "Advanced:",
    "  skill-switch [--home PATH] list [--format table|json]",
    "  skill-switch [--home PATH] export",
    "  skill-switch [--home PATH] import <snapshot.json>",
    "  skill-switch [--home PATH] apply <snapshot.json>",
    "  skill-switch [--home PATH] install-missing <skill> [agent|universal|all]... [--execute]",
  ].join("\n");
}

function packageVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (!packageJson || typeof packageJson.version !== "string") {
    throw new Error("package.json version is missing");
  }
  return packageJson.version;
}

function parseAgents(values: string[], allColumns: ColumnName[] = [...COLUMNS]): ColumnName[] {
  if (values.includes("all")) {
    return [...allColumns];
  }

  return values.map((value) => {
    if (!COLUMNS.includes(value as ColumnName)) {
      throw new Error(`unsupported agent: ${value}`);
    }
    return value as ColumnName;
  });
}

function readSnapshot(path: string) {
  const resolved = resolve(path);
  return parseSnapshot(readFileSync(resolved, "utf8"), resolved);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 2;
  }

  const manager = new SkillManager(args.home);
  const command = args.command ?? "tui";

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(packageVersion());
    return 0;
  }

  if (command === "tui") {
    return runTui(manager);
  }

  if (command === "list") {
    const formatIndex = args.rest.indexOf("--format");
    const format = formatIndex >= 0 ? args.rest[formatIndex + 1] : "table";
    if (format !== "table" && format !== "json") {
      console.error("--format must be table or json");
      return 2;
    }

    const rows = manager.scan();
    const columns = manager.activeColumns();
    if (format === "json") {
      console.log(
        JSON.stringify(
          rows.map((row) => row.toJSON(columns)),
          null,
          2,
        ),
      );
    } else {
      console.log(manager.formatTable(rows, columns));
    }
    return 0;
  }

  if (command === "export") {
    process.stdout.write(formatSnapshot(manager.createSnapshot()));
    return 0;
  }

  if (command === "import") {
    const [path] = args.rest;
    if (!path) {
      console.error("import requires <snapshot.json>");
      console.error(usage());
      return 2;
    }

    try {
      return runTui(manager, { snapshot: readSnapshot(path) });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === "apply") {
    const [path] = args.rest;
    if (!path) {
      console.error("apply requires <snapshot.json>");
      console.error(usage());
      return 2;
    }

    try {
      const plan = manager.applySnapshot(readSnapshot(path));
      for (const skipped of plan.skipped) {
        const target = skipped.agent ? `${skipped.skill}.${skipped.agent}` : skipped.skill;
        console.error(`Skipped ${target}: ${skipped.reason}`);
      }
      console.log(
        `Applied ${plan.changes.length} changes. Unchanged ${plan.unchanged.length}. Skipped ${plan.skipped.length}.`,
      );
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === "install-missing") {
    const [skill, ...values] = args.rest;
    if (!skill) {
      console.error("install-missing requires <skill>");
      console.error(usage());
      return 2;
    }

    const execute = values.includes("--execute");
    const agentValues = values.filter((value) => value !== "--execute");
    let agents: ColumnName[];
    try {
      agents = parseAgents(agentValues.length > 0 ? agentValues : ["all"], manager.activeColumns());
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }

    let actions;
    try {
      actions = manager.buildInstallMissingActions(skill, agents);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }

    if (actions.length === 0) {
      console.log(`No missing agents for ${skill}.`);
      return 0;
    }

    if (execute && actions.some((action) => action.kind === "gh")) {
      const ghError = checkGhCommand();
      if (ghError) {
        console.error(ghError);
        return 1;
      }
    }

    for (const action of actions) {
      console.log(action.command);
      if (execute) {
        try {
          manager.executeInstallAction(action);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          return 1;
        }
      }
    }

    if (!execute) {
      console.log("Dry run. Add --execute to run these commands.");
    }
    return 0;
  }

  console.error(`unknown command: ${command}`);
  console.error(usage());
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
