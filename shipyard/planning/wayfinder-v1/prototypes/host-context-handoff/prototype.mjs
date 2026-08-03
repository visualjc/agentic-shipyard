#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createDispatch,
  deriveExplorerView,
  initialExplorerState,
  reduceExplorer,
  roles,
  validateDispatch,
} from "./model.mjs";

const exercise = process.argv.includes("--exercise");
const keep = process.argv.includes("--keep");
const ccpmCommit = "cdb97474904ab2cdc7d391aa17393b444a28be3e";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`);
  }
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    signal: result.signal,
  };
}

function git(cwd, ...args) {
  return run("git", args, { cwd }).stdout.trim();
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function configureGit(cwd) {
  git(cwd, "config", "user.name", "Shipyard Host Prototype");
  git(cwd, "config", "user.email", "shipyard-host@example.invalid");
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function check(results, label, condition, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  results.push(label);
  process.stdout.write(`\u001b[32mPASS\u001b[0m ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function addMachineLocalExclude(repo, pattern) {
  const path = resolve(repo, git(repo, "rev-parse", "--git-path", "info/exclude"));
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = new Set(current.split("\n").filter(Boolean));
  lines.add(pattern);
  writeFileSync(path, `${[...lines].join("\n")}\n`);
}

function cloneCcpm(lab) {
  const source = join(lab, "sources", "ccpm");
  mkdirSync(dirname(source), { recursive: true });
  run("git", ["clone", "--quiet", "https://github.com/visualjc/ccpm.git", source]);
  git(source, "checkout", "--quiet", ccpmCommit);
  if (git(source, "rev-parse", "HEAD") !== ccpmCommit) throw new Error("CCPM source pin mismatch");
  return source;
}

function skillBody(marker, orchestrator) {
  return `---
name: shipyard-handoff
description: Synthetic Shipyard context-envelope handoff probe. Invoke only when explicitly requested by the prototype.
---

# Shipyard handoff probe

This is a read-only synthetic adapter for the ${orchestrator} lane.

1. Do not delegate and do not modify files.
2. The user provides one envelope path.
3. Run exactly: \`node .shipyard-prototype/worker-probe.mjs <envelope-path>\`.
4. Parse its stdout JSON and add \`"skillMarker":"${marker}"\`.
5. Return only that one compact JSON object with no Markdown.
`;
}

function installProjectSkills(repo, ccpmSource) {
  const ccpmSkill = join(ccpmSource, "skill", "ccpm");
  cpSync(ccpmSkill, join(repo, ".agents", "skills", "ccpm"), { recursive: true });
  write(
    join(repo, ".agents", "skills", "shipyard-handoff", "SKILL.md"),
    skillBody("codex-ccpm-explicit-envelope-v1", "CCPM/Codex"),
  );
}

function recordPaths() {
  return {
    contract: "deliveries/HOST-PROBE/contract.md",
    task: "deliveries/HOST-PROBE/task.md",
    acceptance: "deliveries/HOST-PROBE/acceptance.md",
    review: "deliveries/HOST-PROBE/review.md",
    chatter: "deliveries/HOST-PROBE/implementation-notes.md",
  };
}

function writeLedgerRecords(ledger, productSha) {
  const paths = recordPaths();
  write(join(ledger, paths.contract), `# Contract\n[CANARY:CONTRACT:${productSha.slice(0, 12)}]\n`);
  write(join(ledger, paths.task), "# Task\n[CANARY:IMPLEMENTER-ONLY]\n");
  write(join(ledger, paths.acceptance), "# Acceptance\n[CANARY:ACCEPTANCE-EVIDENCE]\n");
  write(join(ledger, paths.review), "# Review\n[CANARY:INDEPENDENT-REVIEW]\n");
  write(join(ledger, paths.chatter), "# Chatter\n[CANARY:FORBIDDEN-IMPLEMENTATION-CHATTER]\n");
  return paths;
}

function workerProbeBody() {
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const path = process.argv[2];
if (!path) throw new Error("envelope path required");
const envelope = JSON.parse(readFileSync(path, "utf8"));
const git = (...args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "git failed");
  return r.stdout.trim();
};
const current = git("rev-parse", "HEAD");
if (current !== envelope.productSha) {
  process.stderr.write("STALE_ENVELOPE: product SHA changed\\n");
  process.exit(42);
}
const loaded = envelope.records.map(({ key, path: recordPath }) => {
  const content = git("show", envelope.ledgerSha + ":" + recordPath);
  const canaries = [...content.matchAll(/\\[CANARY:([^\\]]+)\\]/g)].map((match) => match[1]);
  return { key, canaries };
});
process.stdout.write(JSON.stringify({
  role: envelope.role,
  productSha: envelope.productSha,
  ledgerSha: envelope.ledgerSha,
  loaded,
}) + "\\n");
`;
}

function writeEnvelope(repo, host, role, productSha, ledgerSha, paths, marker) {
  const dispatch = createDispatch({
    host,
    role,
    productSha,
    ledgerSha,
    records: paths,
    adapterMarker: marker,
  });
  const path = join(repo, ".shipyard-prototype", "envelopes", `${host}-${role}.json`);
  write(path, `${JSON.stringify(dispatch, null, 2)}\n`);
  return { path, relativePath: `.shipyard-prototype/envelopes/${host}-${role}.json`, dispatch };
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error(`host did not return JSON: ${trimmed.slice(0, 500)}`);
}

function runCodex(repo, relativeEnvelope, outputPath) {
  const prompt = `$shipyard-handoff ${relativeEnvelope}\nReturn only the JSON object required by the invoked skill. Do not modify files or delegate.`;
  run(
    "codex",
    [
      "exec",
      "--cd",
      repo,
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "--output-last-message",
      outputPath,
      prompt,
    ],
    { cwd: repo },
  );
  return extractJson(readFileSync(outputPath, "utf8"));
}

function validateHostResult(result, host, role, marker) {
  if (result.skillMarker !== marker) throw new Error(`${host}/${role} did not discover its adapter skill`);
  if (result.role !== role) throw new Error(`${host}/${role} returned wrong role`);
  const keys = result.loaded.map((item) => item.key);
  const canaries = result.loaded.flatMap((item) => item.canaries);
  if (role === "implementer") {
    if (keys.join(",") !== "contract,task" || canaries.includes("FORBIDDEN-IMPLEMENTATION-CHATTER")) {
      throw new Error(`${host} implementer context broadened`);
    }
  } else if (role === "reviewer") {
    if (keys.join(",") !== "contract,acceptance,review" || canaries.includes("IMPLEMENTER-ONLY")) {
      throw new Error(`${host} reviewer context broadened`);
    }
  } else if (role === "status" && (keys.length !== 0 || canaries.length !== 0)) {
    throw new Error(`${host} status loaded delivery records`);
  }
  return true;
}

async function runExercise() {
  const lab = mkdtempSync(join(tmpdir(), "shipyard-host-handoff-"));
  const repo = join(lab, "repo");
  const ledger = join(lab, "ledger");
  const results = [];
  process.stdout.write(`Shipyard host-handoff lab: ${lab}\n\n`);

  try {
    const ccpmSource = cloneCcpm(lab);
    check(results, "maintained CCPM source is pinned", git(ccpmSource, "rev-parse", "HEAD") === ccpmCommit);
    check(results, "Claude live dispatch is deferred by the explicit identity boundary", true);
    check(results, "Cursor/Pstack live dispatch is deferred by the explicit identity boundary", true);

    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-b", "main");
    configureGit(repo);
    write(join(repo, "src", "product.js"), "export const syntheticProduct = 1;\n");
    const productSha1 = commitAll(repo, "Initial synthetic product");
    addMachineLocalExclude(repo, ".shipyard-prototype/");
    addMachineLocalExclude(repo, ".agents/");
    installProjectSkills(repo, ccpmSource);
    write(join(repo, ".shipyard-prototype", "worker-probe.mjs"), workerProbeBody());

    const emptyTree = run("git", ["mktree"], { cwd: repo, input: "" }).stdout.trim();
    const ledgerRoot = run("git", ["commit-tree", emptyTree, "-m", "Host probe ledger"], {
      cwd: repo,
      env: {
        GIT_AUTHOR_NAME: "Shipyard Host Prototype",
        GIT_AUTHOR_EMAIL: "shipyard-host@example.invalid",
        GIT_COMMITTER_NAME: "Shipyard Host Prototype",
        GIT_COMMITTER_EMAIL: "shipyard-host@example.invalid",
      },
    }).stdout.trim();
    git(repo, "branch", "shipyard-ledger", ledgerRoot);
    git(repo, "worktree", "add", ledger, "shipyard-ledger");
    configureGit(ledger);
    const paths1 = writeLedgerRecords(ledger, productSha1);
    const ledgerSha1 = commitAll(ledger, "Record first host context");
    const staleEnvelope = writeEnvelope(
      repo,
      "local",
      "reviewer",
      productSha1,
      ledgerSha1,
      paths1,
      "local-stale-probe",
    );

    write(join(repo, "src", "product.js"), "export const syntheticProduct = 2;\n");
    const productSha2 = commitAll(repo, "Advance synthetic product");
    const stale = run("node", [join(repo, ".shipyard-prototype", "worker-probe.mjs"), staleEnvelope.path], {
      cwd: repo,
      allowFailure: true,
    });
    check(
      results,
      "stale envelope is rejected before any ledger record loads",
      stale.status === 42 && stale.stderr.includes("STALE_ENVELOPE"),
    );

    const paths2 = writeLedgerRecords(ledger, productSha2);
    const ledgerSha2 = commitAll(ledger, "Refresh host context for current product");
    const marker = "codex-ccpm-explicit-envelope-v1";
    const envelopes = {};
    for (const role of roles) {
      envelopes[role] = writeEnvelope(repo, "codex", role, productSha2, ledgerSha2, paths2, marker);
      validateDispatch({ dispatch: envelopes[role].dispatch, currentProductSha: productSha2 });
    }
    check(results, "generic dispatch interface is host-neutral", true, "{host, role, envelopePath, repoRoot}");

    for (const role of roles) {
      const outputPath = join(repo, ".shipyard-prototype", `codex-${role}-last.json`);
      const codexResult = runCodex(repo, envelopes[role].relativePath, outputPath);
      check(
        results,
        `Codex ${role} receives only its explicit envelope`,
        validateHostResult(codexResult, "codex", role, marker),
      );
    }

    check(
      results,
      "product branch remains free of prototype skills and envelopes",
      git(repo, "status", "--porcelain=v1") === "",
    );
    check(
      results,
      "independent reviewer processes receive no implementation-only canary",
      true,
      "separate ephemeral Codex invocations",
    );

    process.stdout.write(`\n${results.length} host-handoff assertions passed.\n`);
  } finally {
    if (keep) {
      process.stdout.write(`Temporary lab retained at ${lab}\n`);
    } else {
      rmSync(lab, { recursive: true, force: true });
      process.stdout.write(`Temporary lab removed: ${lab}\n`);
    }
  }
}

function runTui() {
  let state = initialExplorerState();
  function render() {
    const view = deriveExplorerView(state);
    console.clear();
    process.stdout.write("\u001b[1mShipyard host context-handoff prototype\u001b[0m\n\n");
    process.stdout.write(`\u001b[1mhost\u001b[0m       ${view.host}\n`);
    process.stdout.write(`\u001b[1mrole\u001b[0m       ${view.role}\n`);
    process.stdout.write(`\u001b[1midentity\u001b[0m   ${view.identity.status}: ${view.identity.reason}\n`);
    process.stdout.write(`\u001b[1mfreshness\u001b[0m  ${view.freshness.status}${view.freshness.reason ? `: ${view.freshness.reason}` : ""}\n\n`);
    process.stdout.write(`${JSON.stringify(view.dispatch, null, 2)}\n`);
    process.stdout.write("\n\u001b[1m[h]\u001b[0m host  \u001b[1m[r]\u001b[0m role  \u001b[1m[s]\u001b[0m stale  \u001b[1m[i]\u001b[0m identity  \u001b[1m[q]\u001b[0m quit\n");
  }
  if (!process.stdin.isTTY) {
    process.stdout.write("Interactive TUI requires a terminal. Run with --exercise for host probes.\n");
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  render();
  process.stdin.on("data", (key) => {
    if (key === "q" || key === "\u0003") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      return;
    }
    const action =
      key === "h"
        ? { type: "cycle-host" }
        : key === "r"
          ? { type: "cycle-role" }
          : key === "s"
            ? { type: "toggle-stale" }
            : key === "i"
              ? { type: "toggle-identity" }
              : { type: "unknown" };
    state = reduceExplorer(state, action);
    render();
  });
}

if (exercise) {
  try {
    await runExercise();
  } catch (error) {
    process.stderr.write(`\n\u001b[31mFAIL\u001b[0m ${error.stack || error}\n`);
    process.exitCode = 1;
  }
} else {
  runTui();
}
