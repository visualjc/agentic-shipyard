#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const keep = process.argv.includes("--keep");
const lab = mkdtempSync(join(tmpdir(), "shipyard-local-lifecycle-"));
const destinationBare = join(lab, "destination.git");
const developmentBare = join(lab, "development.git");
const seed = join(lab, "seed");
const destination = join(lab, "destination");
const development = join(lab, "development");
const feature = join(lab, "worktrees", "feature-DEL-001");
const ledger = join(lab, "worktrees", "ledger");
const machineState = join(lab, "machine-state");
const results = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`,
    );
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

function configureGit(cwd) {
  git(cwd, "config", "user.name", "Shipyard Prototype");
  git(cwd, "config", "user.email", "shipyard-prototype@example.invalid");
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function check(label, condition, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  results.push({ label, detail });
  process.stdout.write(`\u001b[32mPASS\u001b[0m ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function expectBlocked(label, operation, pattern) {
  try {
    operation();
  } catch (error) {
    const message = String(error.message || error);
    check(label, pattern.test(message), message.split("\n")[0]);
    return;
  }
  throw new Error(`${label}: operation unexpectedly succeeded`);
}

function head(cwd, ref = "HEAD") {
  return git(cwd, "rev-parse", ref);
}

function commonDir(cwd) {
  const raw = git(cwd, "rev-parse", "--git-common-dir");
  return realpathSync(resolve(cwd, raw));
}

function origin(cwd) {
  return realpathSync(git(cwd, "remote", "get-url", "origin"));
}

function validateClean(cwd) {
  const status = git(cwd, "status", "--porcelain=v1", "--untracked-files=all");
  if (status) throw new Error(`dirty worktree: ${status.split("\n")[0]}`);
}

function validateFastForward(cwd, current, authority) {
  const result = gitMayFail(cwd, "merge-base", "--is-ancestor", current, authority);
  if (result.status !== 0) {
    throw new Error(`divergent or ahead: ${current.slice(0, 12)} is not an ancestor of ${authority.slice(0, 12)}`);
  }
}

function resolveBinding(cwd, bindings) {
  const actualCommonDir = commonDir(cwd);
  const matches = bindings.filter((binding) => binding.commonDir === actualCommonDir);
  if (matches.length === 0) throw new Error("no binding; run shipyard-setup first");
  if (matches.length > 1) throw new Error("ambiguous binding; provide a delivery or repair setup");
  const binding = matches[0];
  if (binding.developmentOrigin !== origin(cwd)) {
    throw new Error("stale binding: development origin changed; run shipyard-setup --rebind");
  }
  return binding;
}

const pathRules = [
  { name: "product-source", prefix: "src/", kind: "product" },
  { name: "product-readme", exact: "README.md", kind: "product" },
  { name: "company-context", exact: "TEAM_CONTEXT.md", kind: "company-only" },
  { name: "development-record", prefix: ".shipyard/", kind: "development-record" },
  { name: "generated-graph", prefix: ".graphs/", kind: "development-generated" },
  { name: "scratch", prefix: ".scratch/", kind: "scratch" },
];

function classifyPath(path, rules = pathRules) {
  const matches = rules.filter(
    (rule) => rule.exact === path || (rule.prefix && path.startsWith(rule.prefix)),
  );
  if (matches.length === 0) throw new Error(`unclassified path: ${path}`);
  const kinds = new Set(matches.map((match) => match.kind));
  if (matches.length > 1 || kinds.size > 1) {
    throw new Error(`ambiguous path policy: ${path} matched ${matches.map((m) => m.name).join(", ")}`);
  }
  return matches[0].kind;
}

function changedPaths(cwd, from, to) {
  const output = git(cwd, "diff", "--name-only", "--diff-filter=ACDMRT", from, to);
  return output ? output.split("\n") : [];
}

function objectExists(cwd, expression) {
  return gitMayFail(cwd, "cat-file", "-e", expression).status === 0;
}

function readGitBlob(cwd, expression) {
  const result = spawnSync("git", ["show", expression], { cwd });
  if (result.status !== 0) {
    throw new Error(`git show ${expression} failed: ${String(result.stderr)}`);
  }
  return result.stdout;
}

function applyProductDelta(sourceRepo, from, to, destinationWorktree) {
  const included = [];
  const excluded = [];
  for (const path of changedPaths(sourceRepo, from, to)) {
    const kind = classifyPath(path);
    if (kind !== "product") {
      excluded.push({ path, kind });
      continue;
    }
    const target = join(destinationWorktree, path);
    if (objectExists(sourceRepo, `${to}:${path}`)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readGitBlob(sourceRepo, `${to}:${path}`));
    } else if (existsSync(target)) {
      unlinkSync(target);
    }
    included.push(path);
  }
  return { included, excluded };
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", message);
  return head(cwd);
}

function writeAcceptanceEvidence(productSha, revision) {
  const path = join(ledger, "deliveries", "DEL-001", "acceptance.json");
  write(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        deliveryId: "DEL-001",
        productSha,
        revision,
        acceptance: [{ criterion: "feature behavior", tested: true, result: "pass" }],
        review: { independent: true, findingsResolved: true },
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

function validateEvidence(path, productSha) {
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  if (evidence.productSha !== productSha) {
    throw new Error(`stale evidence: ${evidence.productSha.slice(0, 12)} does not attest ${productSha.slice(0, 12)}`);
  }
  if (!evidence.acceptance.every((item) => item.tested && item.result === "pass")) {
    throw new Error("incomplete acceptance evidence");
  }
  if (!evidence.review.independent || !evidence.review.findingsResolved) {
    throw new Error("independent review is incomplete");
  }
  return evidence;
}

function acquireLock(name) {
  const path = join(machineState, "locks", `${name}.lock`);
  mkdirSync(dirname(path), { recursive: true });
  try {
    const descriptor = openSync(path, "wx");
    writeFileSync(descriptor, `${process.pid}\n`);
    closeSync(descriptor);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`mutation locked: ${name}`);
    throw error;
  }
  return () => unlinkSync(path);
}

function importReadOnlySource({ remoteRef, localRef }) {
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(remoteRef)) {
    throw new Error(`ambiguous source ref: ${remoteRef}`);
  }
  if (!localRef.startsWith("refs/shipyard/source/")) {
    throw new Error(`reserved or writable target ref: ${localRef}`);
  }
  const remoteLine = run("git", ["ls-remote", destinationBare, remoteRef]).stdout;
  if (!remoteLine) throw new Error(`source ref not found: ${remoteRef}`);
  const remoteSha = remoteLine.split(/\s+/)[0];
  const provenancePath = join(machineState, "source-refs.json");
  const provenance = existsSync(provenancePath)
    ? JSON.parse(readFileSync(provenancePath, "utf8"))
    : {};
  const previous = provenance[localRef];
  if (previous && (previous.remoteRef !== remoteRef || previous.sha !== remoteSha)) {
    throw new Error(`conflicting source ref: ${localRef} already records ${previous.remoteRef}@${previous.sha.slice(0, 12)}`);
  }
  git(development, "fetch", destinationBare, `${remoteRef}:${localRef}`);
  provenance[localRef] = { remote: destinationBare, remoteRef, sha: remoteSha };
  write(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  return remoteSha;
}

function isRemoteRefPresent(bare, ref) {
  return Boolean(run("git", ["ls-remote", bare, ref]).stdout);
}

function createIndependentCommit(cwd, parent, message) {
  const tree = git(cwd, "rev-parse", `${parent}^{tree}`);
  return run("git", ["commit-tree", tree, "-p", parent, "-m", message], {
    cwd,
    env: {
      GIT_AUTHOR_NAME: "Shipyard Prototype",
      GIT_AUTHOR_EMAIL: "shipyard-prototype@example.invalid",
      GIT_COMMITTER_NAME: "Shipyard Prototype",
      GIT_COMMITTER_EMAIL: "shipyard-prototype@example.invalid",
    },
  }).stdout;
}

async function main() {
  process.stdout.write(`Shipyard local lifecycle lab: ${lab}\n\n`);

  mkdirSync(seed, { recursive: true });
  git(seed, "init", "-b", "main");
  configureGit(seed);
  write(join(seed, "README.md"), "# Synthetic product\n");
  write(join(seed, "src", "app.txt"), "baseline\n");
  write(join(seed, "TEAM_CONTEXT.md"), "company-owned context\n");
  commitAll(seed, "Initial company product");
  run("git", ["init", "--bare", "--initial-branch=main", destinationBare]);
  git(seed, "remote", "add", "origin", destinationBare);
  git(seed, "push", "-u", "origin", "main");
  run("git", ["clone", "--bare", destinationBare, developmentBare]);
  run("git", ["clone", destinationBare, destination]);
  run("git", ["clone", developmentBare, development]);
  configureGit(destination);
  configureGit(development);
  check("two bare repositories and paired clones exist", existsSync(destinationBare) && existsSync(developmentBare));

  write(join(destination, "src", "company-baseline.txt"), "company baseline update\n");
  const authoritySha = commitAll(destination, "Company baseline update");
  git(destination, "push", "origin", "main");
  git(development, "fetch", destinationBare, "main:refs/shipyard/source/main");
  validateClean(development);
  validateFastForward(development, head(development, "main"), authoritySha);
  git(development, "merge", "--ff-only", "refs/shipyard/source/main");
  git(development, "push", "origin", "main");
  check("development main cleanly mirrors authoritative main", head(development, "main") === authoritySha);

  const binding = {
    schemaVersion: 1,
    profile: "synthetic-staged-pair",
    topology: "staged-pair",
    workflow: "reviewed-delivery",
    metadataPolicy: "development-only",
    commonDir: commonDir(development),
    developmentOrigin: origin(development),
    destinationAuthority: realpathSync(destinationBare),
  };
  write(join(machineState, "bindings.json"), `${JSON.stringify([binding], null, 2)}\n`);
  check("profile binding resolves from the development clone", resolveBinding(development, [binding]) === binding);

  write(join(development, "DIRTY.tmp"), "dirty\n");
  expectBlocked("dirty sync fails closed", () => validateClean(development), /dirty worktree/);
  unlinkSync(join(development, "DIRTY.tmp"));

  const divergentA = createIndependentCommit(development, authoritySha, "divergent A");
  const divergentB = createIndependentCommit(development, authoritySha, "divergent B");
  expectBlocked(
    "divergent sync fails closed",
    () => validateFastForward(development, divergentA, divergentB),
    /divergent or ahead/,
  );
  expectBlocked(
    "ambiguous binding fails closed",
    () => resolveBinding(development, [binding, { ...binding, profile: "duplicate" }]),
    /ambiguous binding/,
  );
  expectBlocked(
    "stale binding fails closed",
    () => resolveBinding(development, [{ ...binding, developmentOrigin: realpathSync(destinationBare) }]),
    /stale binding/,
  );
  expectBlocked("unclassified paths fail closed", () => classifyPath("mystery.bin"), /unclassified path/);
  expectBlocked(
    "ambiguous path rules fail closed",
    () =>
      classifyPath("src/conflict.txt", [
        { name: "product", prefix: "src/", kind: "product" },
        { name: "private", exact: "src/conflict.txt", kind: "development-record" },
      ]),
    /ambiguous path policy/,
  );

  const releaseLock = acquireLock("development");
  expectBlocked("concurrent mutation lock fails closed", () => acquireLock("development"), /mutation locked/);
  releaseLock();
  const releaseRecoveredLock = acquireLock("development");
  releaseRecoveredLock();
  check("short mutation lock releases cleanly", true);

  git(destination, "switch", "-c", "bugbot/fix", "main");
  write(join(destination, "src", "bugbot.txt"), "source-only company fix\n");
  const sourceSha = commitAll(destination, "Synthetic bugbot branch");
  git(destination, "push", "-u", "origin", "bugbot/fix");
  git(destination, "switch", "main");
  const importedSha = importReadOnlySource({
    remoteRef: "refs/heads/bugbot/fix",
    localRef: "refs/shipyard/source/heads/bugbot/fix",
  });
  check("explicit company branch imports as a local source ref", importedSha === sourceSha);
  check(
    "local source ref is not published to development remote",
    !isRemoteRefPresent(developmentBare, "refs/shipyard/source/heads/bugbot/fix"),
  );
  expectBlocked(
    "conflicting source ref fails closed",
    () =>
      importReadOnlySource({
        remoteRef: "refs/heads/main",
        localRef: "refs/shipyard/source/heads/bugbot/fix",
      }),
    /conflicting source ref/,
  );

  mkdirSync(dirname(feature), { recursive: true });
  git(development, "worktree", "add", "-b", "feature/DEL-001", feature, "main");
  check("feature worktree inherits the clone binding", resolveBinding(feature, [binding]) === binding);

  const emptyTree = run("git", ["mktree"], { cwd: development, input: "" }).stdout;
  const ledgerRoot = run("git", ["commit-tree", emptyTree, "-m", "Shipyard ledger root"], {
    cwd: development,
    env: {
      GIT_AUTHOR_NAME: "Shipyard Prototype",
      GIT_AUTHOR_EMAIL: "shipyard-prototype@example.invalid",
      GIT_COMMITTER_NAME: "Shipyard Prototype",
      GIT_COMMITTER_EMAIL: "shipyard-prototype@example.invalid",
    },
  }).stdout;
  git(development, "branch", "shipyard-ledger", ledgerRoot);
  git(development, "worktree", "add", ledger, "shipyard-ledger");
  write(join(ledger, "README.md"), "# Independent Shipyard ledger\n");
  commitAll(ledger, "Initialize development ledger");
  git(ledger, "push", "-u", "origin", "shipyard-ledger");
  check(
    "ledger branch is parallel rather than a product ancestor",
    gitMayFail(development, "merge-base", "--is-ancestor", "shipyard-ledger", "feature/DEL-001").status !== 0,
  );

  write(join(feature, "src", "feature.txt"), "feature revision one\n");
  write(join(feature, ".shipyard", "deliveries", "DEL-001", "spec.md"), "# Development-only spec\n");
  write(join(feature, ".graphs", "DEL-001", "index.json"), '{"synthetic":true}\n');
  const reviewedSha1 = commitAll(feature, "Develop DEL-001 revision one");
  git(feature, "push", "-u", "origin", "feature/DEL-001");
  const evidencePath = writeAcceptanceEvidence(reviewedSha1, 1);
  validateEvidence(evidencePath, reviewedSha1);
  const ledgerSha1 = commitAll(ledger, "Attest DEL-001 revision one");
  git(ledger, "push", "origin", "shipyard-ledger");
  check("acceptance and independent-review evidence pins exact product SHA", Boolean(ledgerSha1));

  git(destination, "switch", "-c", "shipyard/DEL-001", "main");
  const payload1 = applyProductDelta(feature, authoritySha, reviewedSha1, destination);
  check(
    "path policy includes product and excludes agentic scaffolding",
    payload1.included.includes("src/feature.txt") &&
      payload1.excluded.some((item) => item.kind === "development-record") &&
      payload1.excluded.some((item) => item.kind === "development-generated"),
  );
  const destinationCommit1 = commitAll(destination, "Shipyard payload DEL-001 revision 1");
  git(destination, "push", "-u", "origin", "shipyard/DEL-001");
  check("initial promotion is one sanitized destination commit", git(destination, "rev-list", "--count", "main..HEAD") === "1");
  check(
    "destination branch contains no development metadata",
    !existsSync(join(destination, ".shipyard")) && !existsSync(join(destination, ".graphs")),
  );

  write(join(feature, "src", "feature.txt"), "feature revision two after review\n");
  write(join(feature, ".shipyard", "deliveries", "DEL-001", "review.md"), "Revision requested and resolved.\n");
  const reviewedSha2 = commitAll(feature, "Revise DEL-001 after review");
  git(feature, "push", "origin", "feature/DEL-001");
  expectBlocked("a changed product SHA invalidates old evidence", () => validateEvidence(evidencePath, reviewedSha2), /stale evidence/);
  writeAcceptanceEvidence(reviewedSha2, 2);
  validateEvidence(evidencePath, reviewedSha2);
  const ledgerSha2 = commitAll(ledger, "Attest DEL-001 revision two");
  git(ledger, "push", "origin", "shipyard-ledger");

  const payload2 = applyProductDelta(feature, reviewedSha1, reviewedSha2, destination);
  check("review revision contains a product delta", payload2.included.includes("src/feature.txt"));
  const destinationCommit2 = commitAll(destination, "Shipyard payload DEL-001 revision 2");
  git(destination, "push", "origin", "shipyard/DEL-001");
  check(
    "sanitized product content exactly matches the reviewed Git blob",
    readFileSync(join(destination, "src", "feature.txt")).equals(
      readGitBlob(feature, `${reviewedSha2}:src/feature.txt`),
    ),
  );
  check(
    "destination review history is append-only",
    gitMayFail(destination, "merge-base", "--is-ancestor", destinationCommit1, destinationCommit2).status === 0 &&
      git(destination, "rev-list", "--count", "main..HEAD") === "2",
  );

  git(destination, "switch", "main");
  git(destination, "merge", "--no-ff", "shipyard/DEL-001", "-m", "Human merge of DEL-001");
  const mergedMain = head(destination);
  git(destination, "push", "origin", "main");
  check(
    "destination merge occurs only in the company clone",
    git(destination, "rev-list", "--parents", "-n", "1", mergedMain).split(" ").length === 3,
  );

  write(
    join(ledger, "deliveries", "DEL-001", "finalization.json"),
    `${JSON.stringify(
      {
        deliveryId: "DEL-001",
        reviewedProductSha: reviewedSha2,
        ledgerShaBeforeFinalization: ledgerSha2,
        destinationCommits: [destinationCommit1, destinationCommit2],
        destinationMergeSha: mergedMain,
        developmentPr: "closed-not-merged",
      },
      null,
      2,
    )}\n`,
  );
  const finalLedgerSha = commitAll(ledger, "Finalize DEL-001");
  git(ledger, "push", "origin", "shipyard-ledger");

  git(development, "tag", "-a", "shipyard/reviewed/DEL-001", reviewedSha2, "-m", "Reviewed DEL-001 exact product SHA");
  git(development, "push", "origin", "refs/tags/shipyard/reviewed/DEL-001");
  check(
    "annotated development-only tag points to the exact reviewed SHA",
    head(development, "shipyard/reviewed/DEL-001^{}") === reviewedSha2 &&
      git(development, "cat-file", "-t", "shipyard/reviewed/DEL-001") === "tag" &&
      !isRemoteRefPresent(destinationBare, "refs/tags/shipyard/reviewed/DEL-001"),
  );

  git(development, "fetch", destinationBare, "main:refs/shipyard/source/final-main");
  validateClean(development);
  validateFastForward(development, head(development, "main"), mergedMain);
  git(development, "switch", "main");
  git(development, "merge", "--ff-only", "refs/shipyard/source/final-main");
  git(development, "push", "origin", "main");
  check("final development main exactly equals merged destination main", head(development, "main") === mergedMain);

  git(development, "worktree", "remove", feature);
  git(development, "branch", "-D", "feature/DEL-001");
  git(development, "push", "origin", "--delete", "feature/DEL-001");
  git(development, "worktree", "remove", ledger);
  git(destination, "push", "origin", "--delete", "shipyard/DEL-001");
  git(destination, "branch", "-d", "shipyard/DEL-001");
  check(
    "cleanup removes delivery branches but preserves ledger and reviewed tag",
    !isRemoteRefPresent(developmentBare, "refs/heads/feature/DEL-001") &&
      isRemoteRefPresent(developmentBare, "refs/heads/shipyard-ledger") &&
      isRemoteRefPresent(developmentBare, "refs/tags/shipyard/reviewed/DEL-001") &&
      !isRemoteRefPresent(destinationBare, "refs/heads/shipyard/DEL-001"),
  );
  check("final ledger record is durable", Boolean(finalLedgerSha));

  process.stdout.write(`\n${results.length} lifecycle assertions passed.\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`\n\u001b[31mFAIL\u001b[0m ${error.stack || error}\n`);
  process.exitCode = 1;
} finally {
  if (keep) {
    process.stdout.write(`Temporary lab retained at ${lab}\n`);
  } else {
    rmSync(lab, { recursive: true, force: true });
    process.stdout.write(`Temporary lab removed: ${lab}\n`);
  }
}
