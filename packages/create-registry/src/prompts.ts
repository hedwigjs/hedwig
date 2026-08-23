/**
 * Interactive prompts for create-registry initializer.
 *
 * Two prompts:
 *   1. Directory name (skipped if passed via argv)
 *   2. Package name   (always asked, default derived from directory name)
 *
 * Uses node:readline/promises — no third-party dependency.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface InitAnswers {
  /** Directory name on disk (e.g. "hse-topics") */
  directory: string;
  /** npm package name (e.g. "@your-org/topics") */
  packageName: string;
}

export interface PromptInput {
  /** Pre-supplied directory name (from argv positional) */
  directory?: string;
  /** Pre-supplied package name (from --name flag) */
  packageName?: string;
  /** Skip prompts: accept defaults silently. Used with --yes. */
  skipPrompts?: boolean;
}

const DIRECTORY_PATTERN = /^[a-zA-Z0-9._-]+$/;
const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function validateDirectory(value: string): string | null {
  if (!value) return "directory name is required";
  if (value === "." || value === "..") return "use an explicit directory name";
  if (value.includes("/") || value.includes("\\"))
    return "must be a single segment (no path separators)";
  if (!DIRECTORY_PATTERN.test(value))
    return `must match ${DIRECTORY_PATTERN}`;
  return null;
}

function validatePackageName(value: string): string | null {
  if (!value) return "package name is required";
  if (!PACKAGE_NAME_PATTERN.test(value))
    return "invalid npm package name (e.g. @scope/name or just name)";
  return null;
}

function defaultPackageName(directory: string): string {
  // Most reasonable default: directory name as-is, no scope.
  // User typically overrides with @org/name.
  return directory;
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options: { defaultValue?: string; validate?: (v: string) => string | null }
): Promise<string> {
  const { defaultValue, validate } = options;
  while (true) {
    const prompt = defaultValue
      ? `? ${question} (${defaultValue}): `
      : `? ${question}: `;
    const raw = await rl.question(prompt);
    const value = (raw.trim() || defaultValue || "").trim();

    if (validate) {
      const error = validate(value);
      if (error) {
        process.stdout.write(`  ✗ ${error}\n`);
        continue;
      }
    }
    return value;
  }
}

export async function runPrompts(input_: PromptInput): Promise<InitAnswers> {
  // Resolve directory
  let directory = input_.directory;
  if (directory) {
    const error = validateDirectory(directory);
    if (error) {
      throw new Error(`Invalid directory '${directory}': ${error}`);
    }
  }

  // Resolve package name
  let packageName = input_.packageName;
  if (packageName) {
    const error = validatePackageName(packageName);
    if (error) {
      throw new Error(`Invalid package name '${packageName}': ${error}`);
    }
  }

  // skipPrompts (--yes) requires both to be pre-supplied or defaulted
  if (input_.skipPrompts) {
    if (!directory) {
      throw new Error(
        "--yes requires <directory> to be passed as positional argument"
      );
    }
    if (!packageName) {
      packageName = defaultPackageName(directory);
    }
    return { directory, packageName };
  }

  // Interactive mode
  const rl = createInterface({ input, output });
  try {
    if (!directory) {
      directory = await ask(rl, "Directory name", {
        validate: validateDirectory,
      });
    }
    if (!packageName) {
      packageName = await ask(rl, "Package name", {
        defaultValue: defaultPackageName(directory),
        validate: validatePackageName,
      });
    }
  } finally {
    rl.close();
  }

  return { directory, packageName };
}

export async function confirm(
  question: string,
  defaultYes: boolean
): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const def = defaultYes ? "Y/n" : "y/N";
    const raw = await rl.question(`? ${question} [${def}]: `);
    const value = raw.trim().toLowerCase();
    if (!value) return defaultYes;
    return value.startsWith("y");
  } finally {
    rl.close();
  }
}
