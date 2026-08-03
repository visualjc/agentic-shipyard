#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import {
  deriveExplorerView,
  evaluateFreshness,
  initialExplorerState,
  reduceExplorer,
} from "./model.mjs";

const exercise = process.argv.includes("--exercise");
const keep = process.argv.includes("--keep");

const reviewed = {
  codegraph: {
    repository: "https://github.com/colbymchenry/codegraph.git",
    commit: "49c11fc2e0c02170742be8411e66a31af611f4b7",
  },
  graphify: {
    repository: "https://github.com/Graphify-Labs/graphify.git",
    commit: "00efd6e7969837ae4a9f11d8d504dcd3b20b09df",
  },
  understandAnything: {
    repository: "https://github.com/Egonex-AI/Understand-Anything.git",
    commit: "fe8c5bc591716aafd79b4765549328f08ef5a52e",
  },
};

function run(command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
    maxBuffer: 20 * 1024 * 1024,
  });
  const durationMs = performance.now() - started;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    durationMs,
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
  git(cwd, "config", "user.name", "Shipyard Graph Prototype");
  git(cwd, "config", "user.email", "shipyard-graph@example.invalid");
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function addMachineLocalExclude(cwd, pattern) {
  const excludePath = resolve(cwd, git(cwd, "rev-parse", "--git-path", "info/exclude"));
  const current = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const lines = new Set(current.split("\n").filter(Boolean));
  lines.add(pattern);
  writeFileSync(excludePath, `${[...lines].join("\n")}\n`);
}

function check(results, label, condition, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  results.push(label);
  process.stdout.write(`\u001b[32mPASS\u001b[0m ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function timed(timings, key, operation) {
  const started = performance.now();
  const value = operation();
  timings[key] = Math.round(performance.now() - started);
  return value;
}

function sourceFingerprint(cwd) {
  const files = git(cwd, "ls-files", "-co", "--exclude-standard", "--", "src")
    .split("\n")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(`${path.length}:${path}:`);
    hash.update(readFileSync(join(cwd, path)));
  }
  return hash.digest("hex");
}

function cloneExact(spec, destination) {
  run("git", ["clone", "--quiet", spec.repository, destination]);
  git(destination, "checkout", "--quiet", spec.commit);
  const actual = git(destination, "rev-parse", "HEAD");
  if (actual !== spec.commit) throw new Error(`source checkout mismatch for ${spec.repository}`);
}

function resolvePreparedTools() {
  const pointer = "/tmp/shipyard-graph-tool-lab-current";
  const researchPointer = "/tmp/shipyard-research-current";
  if (!existsSync(pointer) || !existsSync(researchPointer)) return null;
  const root = readFileSync(pointer, "utf8").trim();
  const researchRoot = readFileSync(researchPointer, "utf8").trim();
  const candidate = {
    codegraphNode: existsSync("/Users/jimcarter/.nvm/versions/node/v24.13.1/bin/node")
      ? "/Users/jimcarter/.nvm/versions/node/v24.13.1/bin/node"
      : process.execPath,
    codegraphSource: join(root, "codegraph"),
    codegraphBin: join(root, "codegraph", "dist", "bin", "codegraph.js"),
    graphifySource: join(researchRoot, "graphify"),
    graphifyBin: join(root, "graphify-venv", "bin", "graphify"),
    uaSource: join(root, "understand-anything"),
    uaScanner: join(
      root,
      "understand-anything",
      "understand-anything-plugin",
      "skills",
      "understand",
      "scan-project.mjs",
    ),
  };
  if (!Object.values(candidate).every(existsSync)) return null;
  if (git(candidate.codegraphSource, "rev-parse", "HEAD") !== reviewed.codegraph.commit) return null;
  if (git(candidate.graphifySource, "rev-parse", "HEAD") !== reviewed.graphify.commit) return null;
  if (git(candidate.uaSource, "rev-parse", "HEAD") !== reviewed.understandAnything.commit) return null;
  return candidate;
}

function prepareTools(lab) {
  const prepared = resolvePreparedTools();
  if (prepared) return { ...prepared, reusedPreparedEnvironment: true };

  const toolsRoot = join(lab, "tools");
  const codegraphSource = join(toolsRoot, "codegraph");
  const graphifySource = join(toolsRoot, "graphify");
  const uaSource = join(toolsRoot, "understand-anything");
  mkdirSync(toolsRoot, { recursive: true });
  cloneExact(reviewed.codegraph, codegraphSource);
  cloneExact(reviewed.graphify, graphifySource);
  cloneExact(reviewed.understandAnything, uaSource);

  run("npm", ["--prefix", codegraphSource, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    env: { NPM_CONFIG_CACHE: join(lab, "npm-cache") },
  });
  run("npm", ["--prefix", codegraphSource, "run", "build"], {
    env: { NPM_CONFIG_CACHE: join(lab, "npm-cache") },
  });

  const graphifyEnvironment = join(toolsRoot, "graphify-venv");
  run(
    "uv",
    ["sync", "--project", graphifySource, "--python", "3.12", "--no-dev"],
    {
      env: {
        UV_CACHE_DIR: join(lab, "uv-cache"),
        UV_PROJECT_ENVIRONMENT: graphifyEnvironment,
      },
    },
  );

  run(
    "pnpm",
    ["--dir", uaSource, "--store-dir", join(lab, "pnpm-store"), "install", "--frozen-lockfile"],
  );

  return {
    codegraphNode: existsSync("/Users/jimcarter/.nvm/versions/node/v24.13.1/bin/node")
      ? "/Users/jimcarter/.nvm/versions/node/v24.13.1/bin/node"
      : process.execPath,
    codegraphSource,
    codegraphBin: join(codegraphSource, "dist", "bin", "codegraph.js"),
    graphifySource,
    graphifyBin: join(graphifyEnvironment, "bin", "graphify"),
    uaSource,
    uaScanner: join(
      uaSource,
      "understand-anything-plugin",
      "skills",
      "understand",
      "scan-project.mjs",
    ),
    reusedPreparedEnvironment: false,
  };
}

function codegraph(tools, cwd, args) {
  return run(tools.codegraphNode, [tools.codegraphBin, ...args], {
    cwd,
    env: {
      CODEGRAPH_NO_DAEMON: "1",
      CODEGRAPH_TELEMETRY: "0",
      DO_NOT_TRACK: "1",
      NODE_NO_WARNINGS: "1",
    },
  });
}

function codegraphContains(tools, cwd, symbol) {
  const result = codegraph(tools, cwd, ["query", symbol, "--json"]);
  return result.stdout.includes(symbol);
}

function graphify(tools, cwd, outputRoot) {
  return run(
    tools.graphifyBin,
    ["extract", cwd, "--out", outputRoot, "--code-only", "--no-cluster"],
    {
      cwd,
      env: {
        GRAPHIFY_OUT: join(outputRoot, "graphify-out"),
        GRAPHIFY_QUERY_LOG_DISABLE: "1",
        DO_NOT_TRACK: "1",
      },
    },
  );
}

function graphifyPath(outputRoot) {
  return join(outputRoot, "graphify-out", "graph.json");
}

function deepContains(value, needle) {
  if (typeof value === "string") return value === needle || value.includes(needle);
  if (Array.isArray(value)) return value.some((item) => deepContains(item, needle));
  if (value && typeof value === "object") return Object.values(value).some((item) => deepContains(item, needle));
  return false;
}

function graphifyContains(outputRoot, symbol) {
  return deepContains(JSON.parse(readFileSync(graphifyPath(outputRoot), "utf8")), symbol);
}

function uaResolvedRoot(cwd, noRedirect = false) {
  const commonRaw = git(cwd, "rev-parse", "--git-common-dir");
  const gitRaw = git(cwd, "rev-parse", "--git-dir");
  const common = realpathSync(resolve(cwd, commonRaw));
  const gitDir = realpathSync(resolve(cwd, gitRaw));
  if (common !== gitDir && !noRedirect) return dirname(common);
  return realpathSync(cwd);
}

function uaScan(tools, cwd, outputPath, noRedirect = false) {
  const root = uaResolvedRoot(cwd, noRedirect);
  mkdirSync(dirname(outputPath), { recursive: true });
  run("node", [tools.uaScanner, root, outputPath, "--exclude-analysis-data"], { cwd });
  return { root, result: JSON.parse(readFileSync(outputPath, "utf8")) };
}

function writeBaseProduct(main) {
  write(
    join(main, "src", "math.js"),
    "export function shipyardAdd(left, right) {\n  return left + right;\n}\n",
  );
  write(
    join(main, "src", "service.js"),
    "import { shipyardAdd } from './math.js';\nexport function shipyardPrice(value) {\n  return shipyardAdd(value, 1);\n}\n",
  );
  write(join(main, "package.json"), '{"name":"shipyard-graph-fixture","type":"module"}\n');
}

function writeFeatureA(worktree, includeDivide = false) {
  write(
    join(worktree, "src", "math.js"),
    `export function shipyardAdd(left, right) {\n  return left + right;\n}\n\nexport function shipyardMultiply(left, right) {\n  return left * right;\n}\n${
      includeDivide
        ? "\nexport function shipyardDivide(left, right) {\n  return left / right;\n}\n"
        : ""
    }`,
  );
  write(
    join(worktree, "src", "service.js"),
    "import { shipyardAdd, shipyardMultiply } from './math.js';\nexport function shipyardPrice(value) {\n  return shipyardMultiply(shipyardAdd(value, 1), 2);\n}\n",
  );
}

function writeFeatureB(worktree) {
  write(
    join(worktree, "src", "math.js"),
    "export function shipyardAdd(left, right) {\n  return left + right;\n}\n\nexport function shipyardSubtract(left, right) {\n  return left - right;\n}\n",
  );
  write(
    join(worktree, "src", "service.js"),
    "import { shipyardSubtract } from './math.js';\nexport function shipyardPrice(value) {\n  return shipyardSubtract(value, 1);\n}\n",
  );
}

async function runExercise() {
  const lab = mkdtempSync(join(tmpdir(), "shipyard-graph-freshness-"));
  const main = join(lab, "repo");
  const featureA = join(lab, "worktrees", "feature-A");
  const featureB = join(lab, "worktrees", "feature-B");
  const cache = join(lab, "cache");
  const results = [];
  const timings = {};
  process.stdout.write(`Shipyard graph-freshness lab: ${lab}\n\n`);

  try {
    const tools = timed(timings, "toolPreparationMs", () => prepareTools(lab));
    check(
      results,
      "exact reviewed graph-tool sources are available",
      git(tools.codegraphSource, "rev-parse", "HEAD") === reviewed.codegraph.commit &&
        git(tools.graphifySource, "rev-parse", "HEAD") === reviewed.graphify.commit &&
        git(tools.uaSource, "rev-parse", "HEAD") === reviewed.understandAnything.commit,
      tools.reusedPreparedEnvironment ? "reused temporary prepared environment" : "built temporary environments",
    );
    const ftsProbe = run(
      tools.codegraphNode,
      [
        "-e",
        "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('create virtual table t using fts5(x)')",
      ],
      { env: { NODE_NO_WARNINGS: "1" } },
    );
    check(
      results,
      "CodeGraph runtime provides SQLite FTS5",
      ftsProbe.status === 0,
      `${tools.codegraphNode} (default Node ${process.version} does not on this machine)`,
    );

    mkdirSync(main, { recursive: true });
    git(main, "init", "-b", "main");
    configureGit(main);
    writeBaseProduct(main);
    const baseSha = commitAll(main, "Baseline call graph");
    addMachineLocalExclude(main, ".codegraph/");
    mkdirSync(dirname(featureA), { recursive: true });
    git(main, "worktree", "add", "-b", "feature/A", featureA, "main");
    git(main, "worktree", "add", "-b", "feature/B", featureB, "main");
    writeFeatureA(featureA);
    const featureASha1 = commitAll(featureA, "Feature A changes call graph");
    writeFeatureB(featureB);
    commitAll(featureB, "Feature B changes call graph independently");

    const graphifyBaselineRoot = join(cache, "graphify", "baseline", baseSha);
    timed(timings, "graphifyInitialMs", () => graphify(tools, main, graphifyBaselineRoot));
    check(results, "Graphify baseline builds outside the product checkout", existsSync(graphifyPath(graphifyBaselineRoot)));
    check(results, "Graphify baseline contains the baseline symbol", graphifyContains(graphifyBaselineRoot, "shipyardAdd"));

    const graphifyA = join(cache, "graphify", "worktree-A");
    const graphifyB = join(cache, "graphify", "worktree-B");
    timed(timings, "graphifySeedCopyMs", () => cpSync(graphifyBaselineRoot, graphifyA, { recursive: true }));
    cpSync(graphifyBaselineRoot, graphifyB, { recursive: true });
    timed(timings, "graphifyFeatureRefreshMs", () => graphify(tools, featureA, graphifyA));
    graphify(tools, featureB, graphifyB);
    check(
      results,
      "Graphify absolute output contract leaves worktrees untouched",
      !existsSync(join(featureA, "graphify-out")) && !existsSync(join(featureB, "graphify-out")),
    );
    check(
      results,
      "Graphify seed refresh observes feature A's changed call graph",
      graphifyContains(graphifyA, "shipyardMultiply"),
    );
    check(
      results,
      "Graphify sibling cache remains isolated",
      graphifyContains(graphifyB, "shipyardSubtract") && !graphifyContains(graphifyB, "shipyardMultiply"),
    );

    timed(timings, "codegraphInitialMs", () => codegraph(tools, main, ["init"]));
    check(results, "CodeGraph baseline contains the baseline symbol", codegraphContains(tools, main, "shipyardAdd"));
    timed(timings, "codegraphSeedCopyMs", () => cpSync(join(main, ".codegraph"), join(featureA, ".codegraph"), { recursive: true }));
    cpSync(join(main, ".codegraph"), join(featureB, ".codegraph"), { recursive: true });
    timed(timings, "codegraphFeatureRefreshMs", () => codegraph(tools, featureA, ["sync"]));
    codegraph(tools, featureB, ["sync"]);
    check(
      results,
      "CodeGraph copied baseline refresh observes feature A",
      codegraphContains(tools, featureA, "shipyardMultiply"),
    );
    check(
      results,
      "CodeGraph sibling index remains isolated",
      codegraphContains(tools, featureB, "shipyardSubtract") &&
        !codegraphContains(tools, featureB, "shipyardMultiply"),
    );

    const uaMain = uaScan(tools, main, join(cache, "ua", "main.json"), true);
    const uaDefaultA = uaScan(tools, featureA, join(cache, "ua", "feature-a-default.json"), false);
    const uaOverrideA = uaScan(tools, featureA, join(cache, "ua", "feature-a-override.json"), true);
    const uaOverrideB = uaScan(tools, featureB, join(cache, "ua", "feature-b-override.json"), true);
    check(
      results,
      "Understand Anything defaults a linked worktree to the main checkout",
      uaDefaultA.root === realpathSync(main) && uaDefaultA.result.contentDigest === uaMain.result.contentDigest,
    );
    check(
      results,
      "Understand Anything override fingerprints each divergent worktree",
      uaOverrideA.root === realpathSync(featureA) &&
        uaOverrideA.result.contentDigest !== uaMain.result.contentDigest &&
        uaOverrideA.result.contentDigest !== uaOverrideB.result.contentDigest,
    );

    const beforeDirtyFingerprint = sourceFingerprint(featureA);
    writeFeatureA(featureA, true);
    const dirtyFingerprint = sourceFingerprint(featureA);
    const staleState = evaluateFreshness({
      available: true,
      descriptor: {
        toolSource: reviewed.graphify.commit,
        indexedCommit: featureASha1,
        workingTreeFingerprint: beforeDirtyFingerprint,
      },
      currentCommit: git(featureA, "rev-parse", "HEAD"),
      currentFingerprint: dirtyFingerprint,
      expectedToolSource: reviewed.graphify.commit,
      lock: null,
    });
    check(results, "wrapper marks an uncommitted edit stale before refresh", staleState.status === "stale");
    timed(timings, "graphifyDirtyRefreshMs", () => graphify(tools, featureA, graphifyA));
    timed(timings, "codegraphDirtyRefreshMs", () => codegraph(tools, featureA, ["sync"]));
    const uaDirty = uaScan(tools, featureA, join(cache, "ua", "feature-a-dirty.json"), true);
    check(
      results,
      "all local structural adapters observe an uncommitted call-graph edit",
      graphifyContains(graphifyA, "shipyardDivide") &&
        codegraphContains(tools, featureA, "shipyardDivide") &&
        uaDirty.result.contentDigest !== uaOverrideA.result.contentDigest,
    );
    git(featureA, "restore", "src/math.js", "src/service.js");
    graphify(tools, featureA, graphifyA);
    codegraph(tools, featureA, ["sync"]);
    check(
      results,
      "fresh processes remove reverted uncommitted symbols",
      !graphifyContains(graphifyA, "shipyardDivide") && !codegraphContains(tools, featureA, "shipyardDivide"),
    );
    check(
      results,
      "separate CLI invocations retain refreshed feature state",
      graphifyContains(graphifyA, "shipyardMultiply") && codegraphContains(tools, featureA, "shipyardMultiply"),
    );

    write(
      join(main, "src", "format.js"),
      "export function shipyardFormat(value) {\n  return `$${value}`;\n}\n",
    );
    const advancedMainSha = commitAll(main, "Advance authoritative main");
    git(featureA, "rebase", "main");
    const rebasedFeatureSha = git(featureA, "rev-parse", "HEAD");
    graphify(tools, featureA, graphifyA);
    codegraph(tools, featureA, ["sync"]);
    const uaRebased = uaScan(tools, featureA, join(cache, "ua", "feature-a-rebased.json"), true);
    check(
      results,
      "incremental refresh after rebase contains main and feature symbols",
      rebasedFeatureSha !== featureASha1 &&
        graphifyContains(graphifyA, "shipyardFormat") &&
        graphifyContains(graphifyA, "shipyardMultiply") &&
        codegraphContains(tools, featureA, "shipyardFormat") &&
        codegraphContains(tools, featureA, "shipyardMultiply") &&
        uaRebased.result.files.some((file) => file.path === "src/format.js"),
    );

    git(featureA, "checkout", "--detach", `${rebasedFeatureSha}^`);
    graphify(tools, featureA, graphifyA);
    codegraph(tools, featureA, ["sync"]);
    check(
      results,
      "checkout refresh removes the feature symbol but keeps advanced main",
      graphifyContains(graphifyA, "shipyardFormat") &&
        !graphifyContains(graphifyA, "shipyardMultiply") &&
        codegraphContains(tools, featureA, "shipyardFormat") &&
        !codegraphContains(tools, featureA, "shipyardMultiply"),
    );
    git(featureA, "checkout", "feature/A");
    graphify(tools, featureA, graphifyA);
    codegraph(tools, featureA, ["sync"]);

    const codegraphBackup = join(cache, "codegraph", "worktree-A-backup");
    mkdirSync(dirname(codegraphBackup), { recursive: true });
    cpSync(join(featureA, ".codegraph"), codegraphBackup, { recursive: true });
    const uaBeforeRecreate = uaScan(tools, featureA, join(cache, "ua", "before-recreate.json"), true);
    git(main, "worktree", "remove", "--force", featureA);
    git(main, "worktree", "add", featureA, "feature/A");
    cpSync(codegraphBackup, join(featureA, ".codegraph"), { recursive: true });
    graphify(tools, featureA, graphifyA);
    codegraph(tools, featureA, ["sync"]);
    const uaAfterRecreate = uaScan(tools, featureA, join(cache, "ua", "after-recreate.json"), true);
    check(
      results,
      "same-path worktree recreation can reuse private caches empirically",
      graphifyContains(graphifyA, "shipyardMultiply") &&
        codegraphContains(tools, featureA, "shipyardMultiply") &&
        uaAfterRecreate.result.contentDigest === uaBeforeRecreate.result.contentDigest,
    );

    const staleLock = evaluateFreshness({
      available: true,
      descriptor: {
        toolSource: reviewed.graphify.commit,
        indexedCommit: rebasedFeatureSha,
        workingTreeFingerprint: sourceFingerprint(featureA),
      },
      currentCommit: rebasedFeatureSha,
      currentFingerprint: sourceFingerprint(featureA),
      expectedToolSource: reviewed.graphify.commit,
      lock: { createdAt: Date.now() - 120_000 },
    });
    const unavailable = evaluateFreshness({
      available: false,
      descriptor: null,
      currentCommit: rebasedFeatureSha,
      currentFingerprint: sourceFingerprint(featureA),
      expectedToolSource: reviewed.graphify.commit,
      lock: null,
    });
    check(
      results,
      "stale locks block authority while unavailable tools fall back safely",
      staleLock.status === "blocked" && !staleLock.authoritative &&
        unavailable.status === "fallback" && !unavailable.authoritative,
    );
    check(
      results,
      "no generated graph output entered a tracked product tree",
      !git(featureA, "status", "--porcelain=v1").split("\n").some((line) => /graphify-out|\.ua/.test(line)),
    );

    process.stdout.write(`\n${results.length} graph-freshness assertions passed.\n`);
    process.stdout.write(`${JSON.stringify({ baseSha, advancedMainSha, rebasedFeatureSha, timings }, null, 2)}\n`);
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
    process.stdout.write("\u001b[1mShipyard graph freshness prototype\u001b[0m\n\n");
    process.stdout.write(`\u001b[1mtool\u001b[0m       ${view.tool}\n`);
    process.stdout.write(`\u001b[1mavailable\u001b[0m  ${state.available}\n`);
    process.stdout.write(`\u001b[1mnew commit\u001b[0m ${state.commitAdvanced}\n`);
    process.stdout.write(`\u001b[1mdirty tree\u001b[0m ${state.dirty}\n`);
    process.stdout.write(`\u001b[1mstale lock\u001b[0m ${state.locked}\n\n`);
    process.stdout.write(`${JSON.stringify(view.result, null, 2)}\n`);
    process.stdout.write("\n\u001b[1m[t]\u001b[0m tool  \u001b[1m[c]\u001b[0m commit  \u001b[1m[d]\u001b[0m dirty  \u001b[1m[a]\u001b[0m available  \u001b[1m[l]\u001b[0m lock  \u001b[1m[r]\u001b[0m refresh  \u001b[1m[q]\u001b[0m quit\n");
  }
  if (!process.stdin.isTTY) {
    process.stdout.write("Interactive TUI requires a terminal. Run with --exercise for the tool scenario.\n");
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
      key === "t"
        ? { type: "cycle-tool" }
        : key === "c"
          ? { type: "toggle-commit" }
          : key === "d"
            ? { type: "toggle-dirty" }
            : key === "a"
              ? { type: "toggle-available" }
              : key === "l"
                ? { type: "toggle-lock" }
                : key === "r"
                  ? { type: "refresh" }
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
