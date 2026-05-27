#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { AGENTS, type AgentName, SkillManager } from "./core.ts";
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
    "",
    "Advanced:",
    "  skill-switch [--home PATH] list [--format table|json]",
    "  skill-switch [--home PATH] install-missing <skill> [agent|all]... [--execute]",
  ].join("\n");
}

function parseAgents(values: string[]): AgentName[] {
  if (values.includes("all")) {
    return [...AGENTS];
  }

  return values.map((value) => {
    if (!AGENTS.includes(value as AgentName)) {
      throw new Error(`unsupported agent: ${value}`);
    }
    return value as AgentName;
  });
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
    if (format === "json") {
      console.log(
        JSON.stringify(
          rows.map((row) => row.toJSON()),
          null,
          2,
        ),
      );
    } else {
      console.log(manager.formatTable(rows));
    }
    return 0;
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
    let agents: AgentName[];
    try {
      agents = parseAgents(agentValues.length > 0 ? agentValues : ["all"]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }

    let commands;
    try {
      commands = manager.buildInstallMissingCommands(skill, agents);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }

    if (commands.length === 0) {
      console.log(`No missing agents for ${skill}.`);
      return 0;
    }

    for (const command of commands) {
      console.log(command.command);
      if (execute) {
        const result = spawnSync("gh", command.args, { stdio: "inherit" });
        if (result.status !== 0) {
          return result.status ?? 1;
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
