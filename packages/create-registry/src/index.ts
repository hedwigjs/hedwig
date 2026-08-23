#!/usr/bin/env node
/**
 * @hedwigjs/create-registry — initializer entry point.
 *
 * Invoked via `npm create @hedwigjs/registry [<directory>] [options]`.
 *
 * Pipeline:
 *  1. parseArgs(argv) — extract <directory> and flags
 *  2. runPrompts()    — interactive UX (or accept pre-supplied)
 *  3. validate target — check existence/empty/--force
 *  4. copyTemplates() — walk templates/, substitute placeholders
 *  5. (optional) npm install
 *  6. print next-step instructions
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runPrompts, confirm, type InitAnswers } from "./prompts.js";

// ────────────────────────────────────────────────────────────────────
// Locate templates/ relative to the compiled bin
// ────────────────────────────────────────────────────────────────────
//
// This file (compiled) lives at <pkg>/dist/index.js
// templates/ lives at      <pkg>/templates/
// → relative path is ../templates

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "templates");

// ────────────────────────────────────────────────────────────────────
// CLI parsing
// ────────────────────────────────────────────────────────────────────

interface CliOptions {
  directory?: string;
  packageName?: string;
  /** undefined = ask interactively */
  install?: boolean;
  yes: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { yes: false, force: false };

  let i = 0;
  // First positional → directory
  if (argv[0] && !argv[0].startsWith("-")) {
    opts.directory = argv[0];
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--name":
        opts.packageName = argv[++i];
        if (!opts.packageName) {
          throw new Error("--name requires a value");
        }
        break;
      case "--install":
        opts.install = true;
        break;
      case "--no-install":
        opts.install = false;
        break;
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--force":
      case "-f":
        opts.force = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
        throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return opts;
}

function printHelp(): void {
  process.stdout.write(`
Usage: npm create @hedwigjs/registry [<directory>] [options]

Initializes a new directory as a topics registry package for @hedwigjs/broker.
Created package is fully self-contained — no runtime dependency on @hedwigjs/*.

Options:
  --name <name>      Package name (e.g. @your_org/topics). Asked interactively if omitted.
  --install          Install dependencies after scaffold.
  --no-install       Skip npm install.
  --yes, -y          Accept all defaults; combine with positional/--name.
  --force, -f        Overwrite non-empty target directory.
  --help, -h         Show this help.

Examples:
  npm create @hedwigjs/registry hse-topics
  npm create @hedwigjs/registry hse-topics --name @your-org/topics --yes
`);
}

// ────────────────────────────────────────────────────────────────────
// Target directory
// ────────────────────────────────────────────────────────────────────

function isDirectoryEmpty(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    return true;
  }
}

function clearDirectory(path: string): void {
  for (const entry of readdirSync(path)) {
    rmSync(join(path, entry), { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────────────
// Template copy + substitution
// ────────────────────────────────────────────────────────────────────

interface TemplateContext {
  PACKAGE_NAME: string;
}

function substitute(content: string, ctx: TemplateContext): string {
  const map = ctx as unknown as Record<string, string>;
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key in map) return map[key]!;
    throw new Error(`Unknown placeholder: {{${key}}} in template`);
  });
}

function copyTemplates(
  srcDir: string,
  destDir: string,
  ctx: TemplateContext
): void {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    let destName = entry.name;

    // Special renames (npm strips .gitignore from published packages)
    if (destName === "_gitignore") destName = ".gitignore";

    if (entry.isDirectory()) {
      copyTemplates(srcPath, join(destDir, destName), ctx);
      continue;
    }

    let content = readFileSync(srcPath, "utf-8");

    if (destName.endsWith(".tmpl")) {
      destName = destName.slice(0, -".tmpl".length);
      content = substitute(content, ctx);
    }

    writeFileSync(join(destDir, destName), content);
  }
}

// ────────────────────────────────────────────────────────────────────
// Package manager detection + install
// ────────────────────────────────────────────────────────────────────

function detectPackageManager(startDir: string): "npm" | "yarn" | "pnpm" {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(dir, "yarn.lock"))) return "yarn";
    if (existsSync(join(dir, "package-lock.json"))) return "npm";
    const parent = dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  return "npm";
}

function runInstall(targetDir: string): void {
  const pm = detectPackageManager(dirname(targetDir));
  process.stdout.write(`\nInstalling dependencies with ${pm}...\n`);
  const result = spawnSync(pm, ["install"], {
    cwd: targetDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${pm} install failed (exit code ${result.status})`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const answers: InitAnswers = await runPrompts({
    directory: opts.directory,
    packageName: opts.packageName,
    skipPrompts: opts.yes,
  });

  const targetDir = resolve(process.cwd(), answers.directory);

  // Validate target
  if (existsSync(targetDir) && !isDirectoryEmpty(targetDir)) {
    if (!opts.force) {
      throw new Error(
        `Directory '${answers.directory}' already exists and is not empty.\n` +
          `  Run with --force to overwrite.`
      );
    }
    clearDirectory(targetDir);
  }
  mkdirSync(targetDir, { recursive: true });

  // Copy templates
  copyTemplates(TEMPLATES_DIR, targetDir, {
    PACKAGE_NAME: answers.packageName,
  });

  process.stdout.write(`\n✔ Created ${answers.directory}/\n`);

  // Install dependencies
  let install = opts.install;
  if (install === undefined) {
    install = opts.yes ? true : await confirm("Install dependencies now?", true);
  }
  if (install) {
    runInstall(targetDir);
  }

  // Print next steps
  process.stdout.write(`
Done! Next steps:

  cd ${answers.directory}
  ${install ? "" : "npm install\n  "}npm run dev    # watch-сборка
  npm run add    # scaffold нового события
`);
}

main().catch((err: Error) => {
  process.stderr.write(`✗ ${err.message}\n`);
  process.exit(1);
});
