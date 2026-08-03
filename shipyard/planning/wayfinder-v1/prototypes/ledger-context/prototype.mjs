#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  createEnvelope,
  deriveExplorerView,
  initialExplorerState,
  reduceExplorer,
  resolveDelivery,
  roles,
  validateEnvelope,
} from "./model.mjs";

const exercise = process.argv.includes("--exercise");
const keep = process.argv.includes("--keep");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function git(cwd, ...args) {
  return run("git", args, { cwd }).stdout;
}

function gitMayFail(cwd, ...args) {
  return run("git", args, { cwd, allowFailure: true });
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function configureGit(cwd) {
  git(cwd, "config", "user.name", "Shipyard Ledger Prototype");
  git(cwd, "config", "user.email", "shipyard-ledger@example.invalid");
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function commonDir(cwd) {
  return realpathSync(resolve(cwd, git(cwd, "rev-parse", "--git-common-dir")));
}

function check(results, label, condition, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  results.push(label);
  process.stdout.write(`\u001b[32mPASS\u001b[0m ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function expectBlocked(results, label, operation, pattern) {
  try {
    operation();
  } catch (error) {
    const message = String(error.message || error);
    check(results, label, pattern.test(message), message.split("\n")[0]);
    return;
  }
  throw new Error(`${label}: unexpectedly succeeded`);
}

function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  let fd;
  try {
    fd = openSync(path, "wx");
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("ledger mutation locked");
    throw error;
  }
  return () => unlinkSync(path);
}

function recordSet(deliveryId, productSha, previousLedgerSha) {
  const root = `deliveries/${deliveryId}`;
  return {
    [`${root}/premise.md`]: `# ${deliveryId} premise\nUser-visible intent for ${productSha}.\n`,
    [`${root}/prd.md`]: `# ${deliveryId} PRD\nAcceptance-oriented requirements.\n`,
    [`${root}/spec.md`]: `# ${deliveryId} specification\nImplement only the settled behavior.\n`,
    [`${root}/task.md`]: `# ${deliveryId} task\nChange the synthetic product function.\n`,
    [`${root}/acceptance.json`]: `${JSON.stringify({ productSha, tested: true, result: "pass" }, null, 2)}\n`,
    [`${root}/implementation-notes.md`]: `# Internal chatter\nDo not load this for an independent reviewer.\n`,
    [`${root}/review.json`]: `${JSON.stringify({ productSha, independent: true, findingsResolved: true }, null, 2)}\n`,
    [`${root}/promotion.json`]: `${JSON.stringify({ productSha, payloadClassified: true }, null, 2)}\n`,
    [`${root}/linkage.json`]: `${JSON.stringify({ productSha, previousLedgerSha }, null, 2)}\n`,
  };
}

function recordPaths(deliveryId) {
  const root = `deliveries/${deliveryId}`;
  return {
    premise: `${root}/premise.md`,
    prd: `${root}/prd.md`,
    spec: `${root}/spec.md`,
    task: `${root}/task.md`,
    acceptance: `${root}/acceptance.json`,
    implementationNotes: `${root}/implementation-notes.md`,
    review: `${root}/review.json`,
    promotion: `${root}/promotion.json`,
    linkage: `${root}/linkage.json`,
  };
}

function checkpoint({ ledger, lockPath, expectedSha, changes, message }) {
  const release = acquireLock(lockPath);
  try {
    const current = git(ledger, "rev-parse", "HEAD");
    if (current !== expectedSha) {
      throw new Error(`stale ledger head: expected ${expectedSha.slice(0, 12)}, current ${current.slice(0, 12)}`);
    }
    for (const [path, content] of Object.entries(changes)) write(join(ledger, path), content);
    return commitAll(ledger, message);
  } finally {
    release();
  }
}

function loadEnvelopeRecords(repo, envelope) {
  return Object.fromEntries(
    envelope.records.map(({ key, path }) => [key, git(repo, "show", `${envelope.ledgerSha}:${path}`)]),
  );
}

function hasRemoteRef(bare, ref) {
  return Boolean(run("git", ["ls-remote", bare, ref]).stdout);
}

async function runExercise() {
  const lab = mkdtempSync(join(tmpdir(), "shipyard-ledger-context-"));
  const bare = join(lab, "development.git");
  const seed = join(lab, "seed");
  const development = join(lab, "development");
  const featureA = join(lab, "worktrees", "feature-A");
  const featureB = join(lab, "worktrees", "feature-B");
  const ledger = join(lab, "worktrees", "ledger");
  const lockPath = join(lab, "machine-state", "ledger.lock");
  const results = [];

  process.stdout.write(`Shipyard ledger/context lab: ${lab}\n\n`);
  try {
    mkdirSync(seed, { recursive: true });
    git(seed, "init", "-b", "main");
    configureGit(seed);
    write(join(seed, "README.md"), "# Synthetic product\n");
    write(join(seed, "src", "product.js"), "export const baseline = true;\n");
    commitAll(seed, "Initial product");
    run("git", ["init", "--bare", "--initial-branch=main", bare]);
    git(seed, "remote", "add", "origin", bare);
    git(seed, "push", "-u", "origin", "main");
    run("git", ["clone", bare, development]);
    configureGit(development);

    mkdirSync(dirname(featureA), { recursive: true });
    git(development, "worktree", "add", "-b", "feature/A", featureA, "main");
    git(development, "worktree", "add", "-b", "feature/B", featureB, "main");
    write(join(featureA, "src", "feature-a.js"), "export const featureA = 1;\n");
    const productShaA1 = commitAll(featureA, "Feature A");
    git(featureA, "push", "-u", "origin", "feature/A");
    write(join(featureB, "src", "feature-b.js"), "export const featureB = 1;\n");
    const productShaB = commitAll(featureB, "Feature B");
    git(featureB, "push", "-u", "origin", "feature/B");

    const emptyTree = run("git", ["mktree"], { cwd: development, input: "" }).stdout;
    const ledgerRoot = run("git", ["commit-tree", emptyTree, "-m", "Ledger root"], {
      cwd: development,
      env: {
        GIT_AUTHOR_NAME: "Shipyard Ledger Prototype",
        GIT_AUTHOR_EMAIL: "shipyard-ledger@example.invalid",
        GIT_COMMITTER_NAME: "Shipyard Ledger Prototype",
        GIT_COMMITTER_EMAIL: "shipyard-ledger@example.invalid",
      },
    }).stdout;
    git(development, "branch", "shipyard-ledger", ledgerRoot);
    git(development, "worktree", "add", ledger, "shipyard-ledger");
    configureGit(ledger);
    check(
      results,
      "ledger is a parallel orphan branch",
      gitMayFail(development, "merge-base", "--is-ancestor", "shipyard-ledger", "feature/A").status !== 0,
    );

    const preparedA = {
      ledger,
      lockPath,
      expectedSha: ledgerRoot,
      changes: recordSet("A", productShaA1, ledgerRoot),
      message: "Checkpoint A",
    };
    const preparedB = {
      ledger,
      lockPath,
      expectedSha: ledgerRoot,
      changes: recordSet("B", productShaB, ledgerRoot),
      message: "Checkpoint B",
    };
    const ledgerShaA = checkpoint(preparedA);
    expectBlocked(
      results,
      "a racing stale ledger writer cannot overwrite the winner",
      () => checkpoint(preparedB),
      /stale ledger head/,
    );
    const ledgerShaAB = checkpoint({
      ...preparedB,
      expectedSha: ledgerShaA,
      changes: recordSet("B", productShaB, ledgerShaA),
      message: "Checkpoint B after deterministic retry",
    });
    git(ledger, "push", "-u", "origin", "shipyard-ledger");
    check(
      results,
      "retry preserves both concurrent delivery record sets",
      Boolean(git(ledger, "show", `${ledgerShaAB}:deliveries/A/spec.md`)) &&
        Boolean(git(ledger, "show", `${ledgerShaAB}:deliveries/B/spec.md`)),
    );

    const binding = {
      id: "synthetic-pair",
      commonDir: commonDir(development),
      profile: "synthetic",
      topology: "staged-pair",
      repository: "synthetic-product",
    };
    const bindings = [binding];
    const deliveries = [
      {
        id: "A",
        bindingId: binding.id,
        status: "active",
        productBranch: "feature/A",
        productSha: productShaA1,
        ledgerRef: "refs/heads/shipyard-ledger",
        ledgerSha: ledgerShaAB,
        records: recordPaths("A"),
      },
      {
        id: "B",
        bindingId: binding.id,
        status: "active",
        productBranch: "feature/B",
        productSha: productShaB,
        ledgerRef: "refs/heads/shipyard-ledger",
        ledgerSha: ledgerShaAB,
        records: recordPaths("B"),
      },
    ];

    const resolvedA = resolveDelivery({
      commonDir: commonDir(featureA),
      branch: git(featureA, "branch", "--show-current"),
      explicitId: null,
      bindings,
      deliveries,
    });
    check(results, "linked worktree infers exactly one delivery", resolvedA.delivery.id === "A");
    expectBlocked(
      results,
      "main clone with two deliveries requires explicit disambiguation",
      () =>
        resolveDelivery({
          commonDir: commonDir(development),
          branch: "main",
          explicitId: null,
          bindings,
          deliveries,
        }),
      /ambiguous delivery/,
    );
    const explicitA = resolveDelivery({
      commonDir: commonDir(development),
      branch: "main",
      explicitId: "A",
      bindings,
      deliveries,
    });
    check(results, "explicit delivery resolves deterministically from main", explicitA.delivery.id === "A");

    const envelopes = Object.fromEntries(
      roles.map((role) => [
        role,
        createEnvelope({ ...resolvedA, role, actualProductSha: productShaA1 }),
      ]),
    );
    check(
      results,
      "planner envelope loads only premise, PRD, and specification",
      envelopes.planner.records.map((record) => record.key).join(",") === "premise,prd,spec",
    );
    check(
      results,
      "implementer envelope excludes review and promotion chatter",
      !envelopes.implementer.records.some((record) => ["review", "promotion"].includes(record.key)),
    );
    check(
      results,
      "reviewer receives intent and evidence without implementation notes",
      envelopes.reviewer.records.some((record) => record.key === "acceptance") &&
        !envelopes.reviewer.records.some((record) => record.key === "implementationNotes"),
    );
    check(
      results,
      "promoter receives acceptance, review, promotion, and linkage only",
      envelopes.promoter.records.map((record) => record.key).join(",") ===
        "acceptance,review,promotion,linkage",
    );
    const pinnedRecords = loadEnvelopeRecords(development, envelopes.reviewer);
    check(
      results,
      "records load through pinned Git objects without switching product branches",
      pinnedRecords.spec.includes("A specification") && git(development, "branch", "--show-current") === "main",
    );

    write(join(featureA, "src", "feature-a.js"), "export const featureA = 2;\n");
    const productShaA2 = commitAll(featureA, "Feature A revision");
    git(featureA, "push", "origin", "feature/A");
    expectBlocked(
      results,
      "product revision makes the old envelope stale",
      () => validateEnvelope({ envelope: envelopes.reviewer, delivery: deliveries[0], actualProductSha: productShaA2 }),
      /stale envelope product SHA/,
    );

    const beforeRevisionLedger = git(ledger, "rev-parse", "HEAD");
    const revisedChanges = recordSet("A", productShaA2, beforeRevisionLedger);
    const revisedLedgerSha = checkpoint({
      ledger,
      lockPath,
      expectedSha: beforeRevisionLedger,
      changes: revisedChanges,
      message: "Checkpoint A revision",
    });
    deliveries[0] = { ...deliveries[0], productSha: productShaA2, ledgerSha: revisedLedgerSha };
    const freshEnvelope = createEnvelope({
      binding,
      delivery: deliveries[0],
      role: "reviewer",
      actualProductSha: productShaA2,
    });
    validateEnvelope({ envelope: freshEnvelope, delivery: deliveries[0], actualProductSha: productShaA2 });
    check(results, "new evidence produces a fresh cross-linked product/ledger envelope", true);
    check(
      results,
      "old pinned envelope remains reproducible after later ledger commits",
      loadEnvelopeRecords(development, envelopes.reviewer).spec === pinnedRecords.spec,
    );

    const names = git(featureA, "ls-tree", "-r", "--name-only", productShaA2).split("\n");
    check(
      results,
      "product branch and development PR tree remain metadata-free",
      names.every((path) => !path.startsWith(".shipyard/") && !path.startsWith(".graphs/")),
    );

    const previousLedgerSha = git(ledger, "rev-parse", "HEAD");
    const finalLedgerSha = checkpoint({
      ledger,
      lockPath,
      expectedSha: previousLedgerSha,
      changes: {
        "deliveries/A/final.json": `${JSON.stringify(
          {
            productSha: productShaA2,
            previousLedgerSha,
            developmentPr: "closed-not-merged",
            status: "finalized",
          },
          null,
          2,
        )}\n`,
      },
      message: "Finalize A",
    });
    git(ledger, "push", "origin", "shipyard-ledger");
    git(development, "tag", "-a", "shipyard/reviewed/A", productShaA2, "-m", "Reviewed A");
    git(development, "push", "origin", "refs/tags/shipyard/reviewed/A");
    git(development, "worktree", "remove", featureA);
    git(development, "branch", "-D", "feature/A");
    git(development, "push", "origin", "--delete", "feature/A");
    check(
      results,
      "final archive and tag survive product branch cleanup",
      Boolean(git(development, "show", `${finalLedgerSha}:deliveries/A/final.json`)) &&
        git(development, "rev-parse", "shipyard/reviewed/A^{}") === productShaA2 &&
        hasRemoteRef(bare, "refs/heads/shipyard-ledger") &&
        hasRemoteRef(bare, "refs/tags/shipyard/reviewed/A") &&
        !hasRemoteRef(bare, "refs/heads/feature/A"),
    );

    process.stdout.write(`\n${results.length} ledger/context assertions passed.\n`);
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
  const fixture = {
    bindings: [
      {
        id: "demo",
        commonDir: "/demo/.git",
        profile: "demo-profile",
        topology: "staged-pair",
        repository: "demo-product",
      },
    ],
    deliveries: ["A", "B"].map((id) => ({
      id,
      bindingId: "demo",
      status: "active",
      productBranch: `feature/${id}`,
      productSha: `${id.toLowerCase().repeat(40)}`,
      ledgerRef: "refs/heads/shipyard-ledger",
      ledgerSha: "c".repeat(40),
      records: recordPaths(id),
    })),
    locations: [
      { label: "feature A worktree", commonDir: "/demo/.git", branch: "feature/A" },
      { label: "feature B worktree", commonDir: "/demo/.git", branch: "feature/B" },
      { label: "main clone", commonDir: "/demo/.git", branch: "main" },
      { label: "unbound clone", commonDir: "/other/.git", branch: "main" },
    ],
    explicitIds: [null, "A", "B"],
  };
  let state = initialExplorerState(fixture);

  function render() {
    const view = deriveExplorerView(state);
    console.clear();
    process.stdout.write("\u001b[1mShipyard ledger/context prototype\u001b[0m\n\n");
    process.stdout.write(`\u001b[1mlocation\u001b[0m  ${view.location.label} (${view.location.branch})\n`);
    process.stdout.write(`\u001b[1mexplicit\u001b[0m  ${view.explicitId || "none"}\n`);
    process.stdout.write(`\u001b[1mrole\u001b[0m      ${view.role}\n`);
    process.stdout.write(`\u001b[1mstale\u001b[0m     ${state.stale}\n\n`);
    if (view.error) {
      process.stdout.write(`\u001b[31mERROR\u001b[0m ${view.error}\n`);
    } else {
      process.stdout.write(`\u001b[1mresolution\u001b[0m ${view.resolution}\n`);
      process.stdout.write(`${JSON.stringify(view.envelope, null, 2)}\n`);
    }
    process.stdout.write("\n\u001b[1m[l]\u001b[0m location  \u001b[1m[d]\u001b[0m explicit delivery  \u001b[1m[r]\u001b[0m role  \u001b[1m[s]\u001b[0m stale  \u001b[1m[q]\u001b[0m quit\n");
  }

  if (!process.stdin.isTTY) {
    process.stdout.write("Interactive TUI requires a terminal. Run with --exercise for the scripted Git scenario.\n");
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
      key === "l"
        ? { type: "cycle-location" }
        : key === "d"
          ? { type: "cycle-explicit" }
          : key === "r"
            ? { type: "cycle-role" }
            : key === "s"
              ? { type: "toggle-stale" }
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
