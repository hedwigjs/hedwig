#!/usr/bin/env node
/**
 * scripts/build.mjs — codegen реестра топиков.
 *
 * Сканирует src/domains/<domain>/<action>.v<N>.ts, валидирует и пишет
 * src/index.generated.ts.
 *
 * Контракт пути:
 *   src/domains/<domain>/<action>.v<N>.ts
 *   где <domain> и <action> — kebab-case (^[a-z][a-z0-9-]*$),
 *   <N> — целое число.
 *
 * Топик строится как: <domain>.<action>.v<N>
 *
 * Валидация:
 *   - Глубина вложенности ровно 1 (домен в src/domains/, файл внутри)
 *   - Имя файла соответствует паттерну
 *   - Поле name внутри файла совпадает с derived-именем из пути
 *   - Нет дублей name
 *   - `kind` (если указан) — один из event | request | state; у request
 *     обязателен `response`, у остальных его быть не должно. Контракт без
 *     `kind` считается событием (сводное предупреждение в конце сборки).
 *
 * Флаги:
 *   --watch  — наблюдать за src/domains/, инкрементально пересобирать
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const DOMAINS_DIR = join(ROOT, "src/domains");
const OUTPUT_FILE = join(ROOT, "src/index.generated.ts");

const DOMAIN_PATTERN = /^[a-z][a-z0-9-]*$/;
const FILE_NAME_PATTERN = /^([a-z][a-z0-9-]*)\.v(\d+)\.ts$/;

// ────────────────────────────────────────────────────────────────────
// File discovery
// ────────────────────────────────────────────────────────────────────

async function listEventFiles() {
  if (!existsSync(DOMAINS_DIR)) return [];

  const files = [];
  const domainEntries = await readdir(DOMAINS_DIR, { withFileTypes: true });

  for (const domainEntry of domainEntries) {
    if (!domainEntry.isDirectory()) continue;
    if (domainEntry.name.startsWith(".")) continue;

    const domainDir = join(DOMAINS_DIR, domainEntry.name);
    const fileEntries = await readdir(domainDir, { withFileTypes: true });

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile()) continue;
      if (!fileEntry.name.endsWith(".ts")) continue;
      files.push({
        absolutePath: join(domainDir, fileEntry.name),
        domain: domainEntry.name,
        fileName: fileEntry.name,
      });
    }
  }

  return files;
}

// ────────────────────────────────────────────────────────────────────
// Path → contract derivation
// ────────────────────────────────────────────────────────────────────

function pascalCase(parts) {
  return parts
    .flatMap((p) => p.split(/[-]/))
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

function deriveContract(file) {
  if (!DOMAIN_PATTERN.test(file.domain)) {
    throw new Error(
      `Invalid domain '${file.domain}' in src/domains/${file.domain}/${file.fileName}\n` +
        `  Domain must match ${DOMAIN_PATTERN}`
    );
  }

  const match = file.fileName.match(FILE_NAME_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid file name 'src/domains/${file.domain}/${file.fileName}'\n` +
        `  Expected: <action>.v<N>.ts (kebab-case action, integer version)`
    );
  }

  const [, action, version] = match;
  const topic = `${file.domain}.${action}.v${version}`;
  const identifier = pascalCase([file.domain, action, `V${version}`]);
  const importPath = `./domains/${file.domain}/${action}.v${version}`;
  const topicsKey = topic.replace(/[.\-]/g, "_").toUpperCase();

  return {
    relPath: `${file.domain}/${file.fileName}`,
    absolutePath: file.absolutePath,
    domain: file.domain,
    action,
    version,
    topic,
    identifier,
    importPath,
    topicsKey,
  };
}

// ────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────

const KINDS = new Set(["event", "request", "state"]);

/**
 * Reads `kind` (and whether `response` is declared) straight from the
 * source text: the registry is TypeScript, so evaluating it here would
 * need a compiler. A field on its own line, `kind: "request",` is all the
 * convention asks for.
 */
function readKind(contract, content) {
  const kindMatch = content.match(/^\s*kind\s*:\s*["']([^"']+)["']/m);
  const hasResponse = /^\s*response\s*:/m.test(content);
  const kind = kindMatch ? kindMatch[1] : null;
  if (kind !== null && !KINDS.has(kind)) {
    throw new Error(
      `src/domains/${contract.relPath}: unknown kind "${kind}".\n` +
        `  Expected one of: ${[...KINDS].join(" | ")}`
    );
  }
  if (kind === "request" && !hasResponse) {
    throw new Error(
      `src/domains/${contract.relPath}: a request contract must declare \`response\` ` +
        `(the handler's answer type, e.g. \`response: {} as { ok: true }\`).`
    );
  }
  if (kind !== "request" && hasResponse) {
    throw new Error(
      `src/domains/${contract.relPath}: \`response\` is only meaningful on a request; ` +
        `set \`kind: "request"\` or remove it.`
    );
  }
  return { kind: kind ?? "event", explicit: kind !== null };
}

async function validateNameMatchesPath(contract) {
  const content = await readFile(contract.absolutePath, "utf-8");
  const nameMatch = content.match(/name\s*:\s*["']([^"']+)["']/);

  if (!nameMatch) {
    throw new Error(
      `src/domains/${contract.relPath}: cannot find 'name' field.\n` +
        `  Expected: name: "${contract.topic}",`
    );
  }

  const declared = nameMatch[1];
  if (declared !== contract.topic) {
    throw new Error(
      `src/domains/${contract.relPath}: name mismatch.\n` +
        `  Declared: "${declared}"\n` +
        `  Expected (from path): "${contract.topic}"`
    );
  }

  const { kind, explicit } = readKind(contract, content);
  contract.kind = kind;
  contract.kindExplicit = explicit;
}

function detectDuplicates(contracts) {
  const seen = new Map();
  for (const c of contracts) {
    const previous = seen.get(c.topic);
    if (previous) {
      throw new Error(
        `Duplicate topic '${c.topic}':\n` +
          `  - src/domains/${previous.relPath}\n` +
          `  - src/domains/${c.relPath}`
      );
    }
    seen.set(c.topic, c);
  }
}

function detectDuplicateIdentifiers(contracts) {
  const seen = new Map();
  for (const c of contracts) {
    const previous = seen.get(c.identifier);
    if (previous) {
      throw new Error(
        `Duplicate identifier '${c.identifier}' in generated registry:\n` +
          `  - src/domains/${previous.relPath} → ${previous.topic}\n` +
          `  - src/domains/${c.relPath} → ${c.topic}\n` +
          `  Rename one of the actions to disambiguate.`
      );
    }
    seen.set(c.identifier, c);
  }
}

// ────────────────────────────────────────────────────────────────────
// Output rendering
// ────────────────────────────────────────────────────────────────────

const HEADER = `// AUTO-GENERATED. DO NOT EDIT.
// Run \`npm run build\` to regenerate.
`;

function renderEmpty() {
  return `${HEADER}
import type { TopicKind } from "./lib/contract";

export const registry = {} as const;
export type Topic = keyof typeof registry;
export type TopicPayloads = {};
export type TopicKinds = {};
export type EventTopic = never;
export type RequestTopic = never;
export type StateTopic = never;
export type TopicResponses = {};
export type TopicContracts = {};
export const TOPICS = {} as const;
export const TOPIC_KINDS = {} as const satisfies Record<string, TopicKind>;
`;
}

function renderRegistry(contracts) {
  contracts.sort((a, b) => a.topic.localeCompare(b.topic));

  const imports = contracts
    .map((c) => `import ${c.identifier} from "${c.importPath}";`)
    .join("\n");

  const registryEntries = contracts
    .map((c) => `  "${c.topic}": ${c.identifier},`)
    .join("\n");

  const topicsEntries = contracts
    .map((c) => `  ${c.topicsKey}: "${c.topic}",`)
    .join("\n");

  const kindEntries = contracts
    .map((c) => `  "${c.topic}": "${c.kind}",`)
    .join("\n");

  return `${HEADER}
import type { TopicKind } from "./lib/contract";

${imports}

export const registry = {
${registryEntries}
} as const;

export type Topic = keyof typeof registry;

export type TopicPayloads = {
  [K in Topic]: (typeof registry)[K] extends { payload: infer P } ? P : never;
};

/** Род каждого топика; контракт без \`kind\` — событие. */
export type TopicKinds = {
  [K in Topic]: (typeof registry)[K] extends { kind: infer Kd extends TopicKind } ? Kd : "event";
};

export type EventTopic = { [K in Topic]: TopicKinds[K] extends "event" ? K : never }[Topic];
export type RequestTopic = { [K in Topic]: TopicKinds[K] extends "request" ? K : never }[Topic];
export type StateTopic = { [K in Topic]: TopicKinds[K] extends "state" ? K : never }[Topic];

/** Тип ответа каждого запроса — из поля \`response\` контракта. */
export type TopicResponses = {
  [K in RequestTopic]: (typeof registry)[K] extends { response: infer R } ? R : unknown;
};

/**
 * Род и тип ответа в одной карте — третий параметр
 * \`createClient<Topic, TopicPayloads, TopicContracts>()\`: \`emit\` принимает
 * только события и состояние, \`request\` только запросы, и выводит ответ.
 */
export type TopicContracts = {
  [K in Topic]: {
    kind: TopicKinds[K];
    response: K extends RequestTopic ? TopicResponses[K] : never;
  };
};

export const TOPICS = {
${topicsEntries}
} as const;

/** Роды топиков для рантайма: \`initBroker({ topics: TOPIC_KINDS })\`. */
export const TOPIC_KINDS = {
${kindEntries}
} as const satisfies Record<Topic, TopicKind>;
`;
}

// ────────────────────────────────────────────────────────────────────
// Main build
// ────────────────────────────────────────────────────────────────────

async function build() {
  const files = await listEventFiles();
  const contracts = files.map(deriveContract);

  for (const c of contracts) {
    await validateNameMatchesPath(c);
  }

  detectDuplicates(contracts);
  detectDuplicateIdentifiers(contracts);

  const output = contracts.length === 0 ? renderEmpty() : renderRegistry(contracts);

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, output, "utf-8");

  const count = contracts.length;
  const noun = count === 1 ? "topic" : "topics";
  const byKind = { event: 0, request: 0, state: 0 };
  let implicit = 0;
  for (const c of contracts) {
    byKind[c.kind] += 1;
    if (!c.kindExplicit) implicit += 1;
  }
  console.log(
    `✔ Generated src/index.generated.ts (${count} ${noun}: ` +
      `${byKind.event} event, ${byKind.request} request, ${byKind.state} state)`
  );
  if (implicit > 0) {
    console.warn(
      `  ${implicit} contract(s) without \`kind\` treated as events — add \`kind: "event"\` to make it explicit.`
    );
  }
}

async function buildSafe(throwOnError) {
  try {
    await build();
    return true;
  } catch (err) {
    console.error(`✗ Build failed:\n  ${err.message}`);
    if (throwOnError) throw err;
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────
// CLI entry
// ────────────────────────────────────────────────────────────────────

const watchMode = process.argv.includes("--watch");

if (watchMode) {
  await buildSafe(false);
  console.log(`Watching ${DOMAINS_DIR} for changes...`);

  if (!existsSync(DOMAINS_DIR)) {
    await mkdir(DOMAINS_DIR, { recursive: true });
  }

  let timer = null;
  const debouncedRebuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.log("Change detected, rebuilding...");
      buildSafe(false);
    }, 100);
  };

  watch(DOMAINS_DIR, { recursive: true }, debouncedRebuild);
} else {
  const ok = await buildSafe(false);
  if (!ok) process.exit(1);
}
