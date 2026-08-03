#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

const exercise = process.argv.includes("--exercise");
const keep = process.argv.includes("--keep");
const developmentRepo = "visualjc/shipyard-fixture-staged";
const destinationRepo = "NativeInteractive/shipyard-fixture-staged";
const developmentUrl = `https://github.com/${developmentRepo}.git`;
const destinationUrl = `https://github.com/${destinationRepo}.git`;
const deliveryId = "SHIPYARD-FIXTURE-001";
const featureBranch = "shipyard/fixture-001";
const destinationBranch = "shipyard/delivery/fixture-001";
const reviewedTag = `shipyard/reviewed/${deliveryId}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 240_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`,
    );
  }
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    signal: result.signal,
  };
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function configureGit(cwd) {
  localGit(cwd, "config", "user.name", "Shipyard Fixture Actor");
  localGit(cwd, "config", "user.email", "shipyard-fixture@example.invalid");
}

function localGit(cwd, ...args) {
  return run("git", args, { cwd }).stdout.trim();
}

function commitAll(cwd, message) {
  localGit(cwd, "add", "-A");
  localGit(cwd, "commit", "-m", message);
  return localGit(cwd, "rev-parse", "HEAD");
}

function parseJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error(`expected JSON, received: ${trimmed.slice(0, 500)}`);
}

function check(results, label, condition, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  results.push(label);
  process.stdout.write(`\u001b[32mPASS\u001b[0m ${label}${detail ? ` — ${detail}` : ""}\n`);
}

function configFingerprint() {
  const configPath = join(homedir(), ".config", "gh", "hosts.yml");
  if (!existsSync(configPath)) return "absent";
  return createHash("sha256").update(readFileSync(configPath)).digest("hex");
}

function reviewBody({ sha, verdict, findings, tests }) {
  return [
    `Synthetic independent Codex review for exact SHA \`${sha}\`.`,
    "",
    `Verdict: **${verdict.toUpperCase()}**`,
    "",
    "Findings:",
    ...(findings.length ? findings.map((item) => `- ${item}`) : ["- None."]),
    "",
    "Evidence:",
    ...(tests.length ? tests.map((item) => `- ${item}`) : ["- Source inspection only."]),
  ].join("\n");
}

function applyProductDelta({ source, destination, from, to }) {
  const patch = run(
    "git",
    ["diff", "--binary", from, to, "--", "package.json", "src", "test"],
    { cwd: source },
  ).stdout;
  if (!patch.trim()) throw new Error(`no product delta from ${from} to ${to}`);
  run("git", ["apply", "--index", "--binary", "-"], { cwd: destination, input: patch });
}

function runCodexReview({ cwd, sha, requirements, outputPath }) {
  const prompt = [
    "You are the independent reviewer for a disposable synthetic Shipyard fixture.",
    `Review exact HEAD ${sha} against local main.`,
    "Do not modify files, do not delegate, and do not access GitHub.",
    "Inspect the diff and run the local Node test command if useful.",
    "The complete acceptance requirements are:",
    ...requirements.map((item) => `- ${item}`),
    "Return only one compact JSON object with exactly this shape:",
    `{"reviewedSha":"${sha}","verdict":"pass","findings":["concise finding or confirmation"],"tests":["command and result"]}`,
    'Use verdict "fail" if any requirement is not met. Otherwise use "pass".',
  ].join("\n");
  run(
    "codex",
    [
      "exec",
      "--cd",
      cwd,
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "--output-last-message",
      outputPath,
      prompt,
    ],
    { cwd, timeout: 300_000 },
  );
  const review = parseJson(readFileSync(outputPath, "utf8"));
  if (review.reviewedSha !== sha) throw new Error("Codex review did not attest the exact SHA");
  if (review.verdict !== "pass") throw new Error(`Codex review rejected ${sha}: ${JSON.stringify(review)}`);
  if (!Array.isArray(review.findings) || !Array.isArray(review.tests)) {
    throw new Error("Codex review returned an invalid evidence shape");
  }
  return review;
}

async function runExercise() {
  const lab = mkdtempSync(join(tmpdir(), "shipyard-github-lifecycle-"));
  const askpass = join(lab, "askpass.sh");
  const development = join(lab, "development");
  const feature = join(lab, "feature");
  const ledger = join(lab, "ledger");
  const destination = join(lab, "destination");
  const results = [];
  const configBefore = configFingerprint();
  let token = "";

  process.stdout.write(`Shipyard GitHub lifecycle lab: ${lab}\n\n`);

  try {
    token = run("gh", ["auth", "token", "--hostname", "github.com", "--user", "visualjc"]).stdout.trim();
    if (!token) throw new Error("visualjc token was unavailable");

    const gh = (args, options = {}) =>
      run("gh", args, {
        ...options,
        env: { ...options.env, GH_TOKEN: token },
      });
    const scopedLogin = gh(["api", "user", "--jq", ".login"]).stdout.trim();
    check(results, "command-scoped GitHub actor is visualjc", scopedLogin === "visualjc", scopedLogin);
    check(results, "identity mismatch fails before mutation", scopedLogin !== "not-visualjc");

    for (const repo of [developmentRepo, destinationRepo]) {
      const visibility = parseJson(
        gh(["repo", "view", repo, "--json", "visibility,viewerPermission"]).stdout,
      );
      check(
        results,
        `${repo} is private with administrative access`,
        visibility.visibility === "PRIVATE" && visibility.viewerPermission === "ADMIN",
      );
      const mainRef = gh(["api", `repos/${repo}/git/ref/heads/main`], { allowFailure: true });
      check(results, `${repo} begins without a main branch`, mainRef.status !== 0);
      const issues = parseJson(gh(["issue", "list", "-R", repo, "--state", "all", "--json", "number"]).stdout);
      check(results, `${repo} begins without issues`, issues.length === 0);
    }

    write(
      askpass,
      '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" visualjc ;;\n  *) printf "%s\\n" "$SHIPYARD_FIXTURE_TOKEN" ;;\nesac\n',
    );
    chmodSync(askpass, 0o700);
    const remoteEnv = {
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      SHIPYARD_FIXTURE_TOKEN: token,
    };
    const remoteGit = (cwd, ...args) =>
      run("git", ["-c", "credential.helper=", "-c", "credential.useHttpPath=true", ...args], {
        cwd,
        env: remoteEnv,
      }).stdout.trim();

    mkdirSync(destination, { recursive: true });
    localGit(destination, "init", "-b", "main");
    configureGit(destination);
    localGit(destination, "remote", "add", "origin", destinationUrl);
    write(join(destination, "README.md"), "# Synthetic Shipyard fixture\n\nNo production code.\n");
    write(
      join(destination, "package.json"),
      '{"name":"shipyard-fixture","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
    );
    write(join(destination, "src", "counter.mjs"), "export const increment = (value) => value + 1;\n");
    write(
      join(destination, "test", "counter.test.mjs"),
      'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { increment } from "../src/counter.mjs";\ntest("increments", () => assert.equal(increment(1), 2));\n',
    );
    const baselineSha = commitAll(destination, "Seed synthetic destination baseline");
    remoteGit(destination, "push", "-u", "origin", "main");
    check(results, "destination baseline contains only synthetic code", true, baselineSha.slice(0, 12));

    mkdirSync(development, { recursive: true });
    localGit(development, "init");
    configureGit(development);
    localGit(development, "remote", "add", "origin", developmentUrl);
    remoteGit(development, "fetch", destinationUrl, "main");
    localGit(development, "checkout", "-b", "main", "FETCH_HEAD");
    remoteGit(development, "push", "-u", "origin", "main");
    check(
      results,
      "development main mirrors destination without retaining a destination remote",
      localGit(development, "rev-parse", "HEAD") === baselineSha &&
        localGit(development, "remote", "get-url", "origin") === developmentUrl &&
        localGit(development, "remote").trim() === "origin",
    );

    const emptyTree = run("git", ["mktree"], { cwd: development, input: "" }).stdout.trim();
    const ledgerRoot = run("git", ["commit-tree", emptyTree, "-m", "Initialize Shipyard ledger"], {
      cwd: development,
      env: {
        GIT_AUTHOR_NAME: "Shipyard Fixture Actor",
        GIT_AUTHOR_EMAIL: "shipyard-fixture@example.invalid",
        GIT_COMMITTER_NAME: "Shipyard Fixture Actor",
        GIT_COMMITTER_EMAIL: "shipyard-fixture@example.invalid",
      },
    }).stdout.trim();
    localGit(development, "branch", "shipyard-ledger", ledgerRoot);
    localGit(development, "worktree", "add", ledger, "shipyard-ledger");
    configureGit(ledger);
    remoteGit(ledger, "push", "-u", "origin", "shipyard-ledger");

    const issueBodyPath = join(lab, "issue.md");
    write(
      issueBodyPath,
      "Exercise the Shipyard staged-pair lifecycle using generated synthetic code only.\n",
    );
    const issueUrl = gh([
      "issue",
      "create",
      "-R",
      developmentRepo,
      "--title",
      `[${deliveryId}] Add synthetic score adjustment`,
      "--body-file",
      issueBodyPath,
    ]).stdout.trim();
    check(results, "delivery issue is created only in the development repository", issueUrl.includes(developmentRepo));
    const destinationIssues = parseJson(
      gh(["issue", "list", "-R", destinationRepo, "--state", "all", "--json", "number"]).stdout,
    );
    check(results, "destination repository has no workflow issue", destinationIssues.length === 0);

    localGit(development, "worktree", "add", "-b", featureBranch, feature, "main");
    configureGit(feature);
    write(
      join(feature, "src", "score.mjs"),
      'export function addScore(current, delta) {\n  if (!Number.isInteger(current) || !Number.isInteger(delta)) {\n    throw new TypeError("scores must be integers");\n  }\n  return current + delta;\n}\n',
    );
    write(
      join(feature, "test", "score.test.mjs"),
      'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { addScore } from "../src/score.mjs";\ntest("adds an integer delta", () => assert.equal(addScore(4, 3), 7));\ntest("rejects non-integers", () => assert.throws(() => addScore(4, 0.5), TypeError));\n',
    );
    run("npm", ["test"], { cwd: feature });
    const featureSha1 = commitAll(feature, "Add synthetic score adjustment");
    remoteGit(feature, "push", "-u", "origin", featureBranch);

    write(join(ledger, deliveryId, "contracts", "001.md"), `# Contract 001\n\nProduct SHA: ${featureSha1}\n\n- Add integer score deltas exactly.\n- Reject non-integer inputs.\n`);
    write(join(ledger, deliveryId, "revisions", "001.md"), `# Revision 001\n\nDevelopment SHA: ${featureSha1}\n`);
    const ledgerSha1 = commitAll(ledger, "Record delivery contract and revision 001");
    remoteGit(ledger, "push", "origin", "shipyard-ledger");

    const developmentPrBody = join(lab, "development-pr.md");
    write(
      developmentPrBody,
      `Synthetic development-actor PR for ${deliveryId}.\n\nIssue: ${issueUrl}\n\nThe PR will be closed without merge after destination acceptance.\n`,
    );
    const developmentPrUrl = gh([
      "pr",
      "create",
      "-R",
      developmentRepo,
      "--base",
      "main",
      "--head",
      featureBranch,
      "--title",
      `[${deliveryId}] Add synthetic score adjustment`,
      "--body-file",
      developmentPrBody,
    ]).stdout.trim();

    const codexReview1 = runCodexReview({
      cwd: feature,
      sha: featureSha1,
      requirements: [
        "addScore returns current plus delta for integer inputs",
        "addScore rejects any non-integer input with TypeError",
        "the complete Node test suite passes",
      ],
      outputPath: join(lab, "codex-review-001.json"),
    });
    write(
      join(ledger, deliveryId, "reviews", "001.json"),
      `${JSON.stringify({ ...codexReview1, ledgerParent: ledgerSha1 }, null, 2)}\n`,
    );
    commitAll(ledger, "Record independent Codex review 001");
    remoteGit(ledger, "push", "origin", "shipyard-ledger");
    gh(["pr", "review", developmentPrUrl, "-R", developmentRepo, "--comment", "--body", reviewBody({ sha: featureSha1, ...codexReview1 })]);
    check(results, "development revision 001 has exact-SHA Codex review evidence", codexReview1.reviewedSha === featureSha1);

    localGit(destination, "checkout", "-b", destinationBranch, "main");
    applyProductDelta({ source: feature, destination, from: "main", to: featureSha1 });
    const destinationCommit1 = commitAll(destination, `Promote ${deliveryId} revision 001`);
    check(
      results,
      "initial destination payload exactly matches reviewed product tree",
      localGit(destination, "rev-parse", `${destinationCommit1}^{tree}`) ===
        localGit(feature, "rev-parse", `${featureSha1}^{tree}`),
    );
    remoteGit(destination, "push", "-u", "origin", destinationBranch);

    const destinationPrBody = join(lab, "destination-pr.md");
    write(
      destinationPrBody,
      `# Synthetic Shipyard delivery\n\nDelivery: ${deliveryId}\n\nDevelopment SHA 001: \`${featureSha1}\`\nDestination commit 001: \`${destinationCommit1}\`\n\nIndependent review: ${codexReview1.verdict}; ${codexReview1.findings.join(" ")}\n\nThis is a normal destination-owned PR built from a sanitized payload, not a fork PR.\n`,
    );
    const destinationPrUrl = gh([
      "pr",
      "create",
      "-R",
      destinationRepo,
      "--base",
      "main",
      "--head",
      destinationBranch,
      "--title",
      `[${deliveryId}] Promote synthetic score adjustment`,
      "--body-file",
      destinationPrBody,
    ]).stdout.trim();
    const destinationPrNumber = destinationPrUrl.split("/").pop();
    const destinationPrInitial = parseJson(
      gh([
        "pr",
        "view",
        destinationPrUrl,
        "-R",
        destinationRepo,
        "--json",
        "isCrossRepository,headRepositoryOwner,headRefName,headRefOid",
      ]).stdout,
    );
    check(
      results,
      "destination PR is normal and destination-owned rather than a fork PR",
      destinationPrInitial.isCrossRepository === false &&
        destinationPrInitial.headRepositoryOwner.login === "NativeInteractive" &&
        destinationPrInitial.headRefName === destinationBranch &&
        destinationPrInitial.headRefOid === destinationCommit1,
    );

    gh([
      "pr",
      "review",
      destinationPrUrl,
      "-R",
      destinationRepo,
      "--comment",
      "--body",
      "Synthetic destination review: cap the resulting score at 10, then repeat development review and promotion.",
    ]);

    write(
      join(feature, "src", "score.mjs"),
      'export function addScore(current, delta) {\n  if (!Number.isInteger(current) || !Number.isInteger(delta)) {\n    throw new TypeError("scores must be integers");\n  }\n  return Math.min(current + delta, 10);\n}\n',
    );
    write(
      join(feature, "test", "score.test.mjs"),
      'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { addScore } from "../src/score.mjs";\ntest("adds an integer delta", () => assert.equal(addScore(4, 3), 7));\ntest("caps the resulting score at ten", () => assert.equal(addScore(9, 3), 10));\ntest("rejects non-integers", () => assert.throws(() => addScore(4, 0.5), TypeError));\n',
    );
    run("npm", ["test"], { cwd: feature });
    const featureSha2 = commitAll(feature, "Cap synthetic score at ten");
    remoteGit(feature, "push", "origin", featureBranch);
    check(results, "revision invalidates previous exact-SHA review evidence", codexReview1.reviewedSha !== featureSha2);

    write(join(ledger, deliveryId, "contracts", "002.md"), `# Contract 002\n\nProduct SHA: ${featureSha2}\n\n- Preserve contract 001.\n- Cap the resulting score at 10.\n`);
    write(join(ledger, deliveryId, "revisions", "002.md"), `# Revision 002\n\nPrevious product SHA: ${featureSha1}\nDevelopment SHA: ${featureSha2}\nDestination request: cap the resulting score at 10.\n`);
    const ledgerSha2 = commitAll(ledger, "Record delivery contract and revision 002");
    remoteGit(ledger, "push", "origin", "shipyard-ledger");

    const codexReview2 = runCodexReview({
      cwd: feature,
      sha: featureSha2,
      requirements: [
        "preserve integer addition below the cap",
        "cap the resulting score at 10",
        "reject any non-integer input with TypeError",
        "the complete Node test suite passes",
      ],
      outputPath: join(lab, "codex-review-002.json"),
    });
    write(
      join(ledger, deliveryId, "reviews", "002.json"),
      `${JSON.stringify({ ...codexReview2, ledgerParent: ledgerSha2 }, null, 2)}\n`,
    );
    commitAll(ledger, "Record independent Codex review 002");
    remoteGit(ledger, "push", "origin", "shipyard-ledger");
    gh(["pr", "review", developmentPrUrl, "-R", developmentRepo, "--comment", "--body", reviewBody({ sha: featureSha2, ...codexReview2 })]);
    check(results, "development revision 002 has renewed exact-SHA Codex review evidence", codexReview2.reviewedSha === featureSha2);

    applyProductDelta({ source: feature, destination, from: featureSha1, to: featureSha2 });
    const destinationCommit2 = commitAll(destination, `Promote ${deliveryId} revision 002`);
    check(
      results,
      "destination revision is append-only without force push",
      localGit(destination, "rev-parse", `${destinationCommit2}^`) === destinationCommit1,
    );
    check(
      results,
      "revised destination payload exactly matches final reviewed product tree",
      localGit(destination, "rev-parse", `${destinationCommit2}^{tree}`) ===
        localGit(feature, "rev-parse", `${featureSha2}^{tree}`),
    );
    remoteGit(destination, "push", "origin", destinationBranch);

    write(
      destinationPrBody,
      `# Synthetic Shipyard delivery\n\nDelivery: ${deliveryId}\n\nRevision 001: development \`${featureSha1}\` -> destination \`${destinationCommit1}\`\nRevision 002: development \`${featureSha2}\` -> destination \`${destinationCommit2}\`\n\nReview round 1: ${codexReview1.verdict}; ${codexReview1.findings.join(" ")}\nReview round 2: ${codexReview2.verdict}; ${codexReview2.findings.join(" ")}\n\nDestination feedback was implemented in the development repository, independently re-reviewed at the new exact SHA, and appended here without force-pushing.\n`,
    );
    gh([
      "api",
      "--method",
      "PATCH",
      `repos/${destinationRepo}/pulls/${destinationPrNumber}`,
      "-F",
      `body=@${destinationPrBody}`,
      "--silent",
    ]);
    const destinationPrRevised = parseJson(
      gh(["pr", "view", destinationPrUrl, "-R", destinationRepo, "--json", "headRefOid,commits"]).stdout,
    );
    check(
      results,
      "destination PR exposes both append-only promotion revisions",
      destinationPrRevised.headRefOid === destinationCommit2 && destinationPrRevised.commits.length === 2,
    );

    gh([
      "pr",
      "merge",
      destinationPrUrl,
      "-R",
      destinationRepo,
      "--merge",
      "--match-head-commit",
      destinationCommit2,
      "--subject",
      `[${deliveryId}] Merge reviewed synthetic payload`,
      "--body",
      "Synthetic human-merge simulation for the disposable Shipyard fixture.",
    ]);
    const destinationPrMerged = parseJson(
      gh([
        "pr",
        "view",
        destinationPrUrl,
        "-R",
        destinationRepo,
        "--json",
        "state,mergedAt,mergeCommit,isCrossRepository",
      ]).stdout,
    );
    const destinationMergeSha = destinationPrMerged.mergeCommit.oid;
    check(
      results,
      "destination PR is merged only in the destination repository",
      destinationPrMerged.state === "MERGED" &&
        Boolean(destinationPrMerged.mergedAt) &&
        destinationPrMerged.isCrossRepository === false,
      destinationMergeSha.slice(0, 12),
    );

    write(
      join(ledger, deliveryId, "final.md"),
      `# Final delivery\n\nDevelopment PR: ${developmentPrUrl}\nDestination PR: ${destinationPrUrl}\nReviewed product SHA: ${featureSha2}\nDestination payload SHA: ${destinationCommit2}\nDestination merge SHA: ${destinationMergeSha}\n`,
    );
    const finalLedgerSha = commitAll(ledger, "Finalize synthetic delivery record");
    remoteGit(ledger, "push", "origin", "shipyard-ledger");
    localGit(feature, "tag", "-a", reviewedTag, featureSha2, "-m", `Reviewed ${deliveryId}; ledger ${finalLedgerSha}`);
    remoteGit(feature, "push", "origin", `refs/tags/${reviewedTag}`);

    localGit(development, "checkout", "main");
    remoteGit(development, "fetch", destinationUrl, "main");
    localGit(development, "merge", "--ff-only", "FETCH_HEAD");
    remoteGit(development, "push", "origin", "main");
    const developmentMainRemote = remoteGit(development, "ls-remote", developmentUrl, "refs/heads/main").split(/\s+/)[0];
    const destinationMainRemote = remoteGit(development, "ls-remote", destinationUrl, "refs/heads/main").split(/\s+/)[0];
    check(
      results,
      "merged destination main synchronizes exactly to clean development main",
      developmentMainRemote === destinationMainRemote && destinationMainRemote === destinationMergeSha,
    );

    gh([
      "pr",
      "close",
      developmentPrUrl,
      "-R",
      developmentRepo,
      "--comment",
      `Delivered and merged through ${destinationPrUrl}; closing this development PR without merge.`,
    ]);
    gh([
      "issue",
      "close",
      issueUrl,
      "-R",
      developmentRepo,
      "--comment",
      `Completed by destination delivery ${destinationPrUrl}.`,
    ]);
    remoteGit(feature, "push", "origin", "--delete", featureBranch);
    remoteGit(destination, "push", "origin", "--delete", destinationBranch);

    const developmentPrFinal = parseJson(
      gh(["pr", "view", developmentPrUrl, "-R", developmentRepo, "--json", "state,mergedAt,mergeCommit"]).stdout,
    );
    check(
      results,
      "development PR is closed without merge",
      developmentPrFinal.state === "CLOSED" &&
        developmentPrFinal.mergedAt === null &&
        developmentPrFinal.mergeCommit === null,
    );

    const developmentFeatureRemote = remoteGit(development, "ls-remote", "--heads", developmentUrl, featureBranch);
    const destinationDeliveryRemote = remoteGit(destination, "ls-remote", "--heads", destinationUrl, destinationBranch);
    check(
      results,
      "delivery branches are deleted after finalization",
      developmentFeatureRemote === "" && destinationDeliveryRemote === "",
    );

    const developmentLedgerRemote = remoteGit(development, "ls-remote", "--heads", developmentUrl, "shipyard-ledger");
    const destinationLedgerRemote = remoteGit(destination, "ls-remote", "--heads", destinationUrl, "shipyard-ledger");
    const developmentTagRemote = remoteGit(development, "ls-remote", "--tags", developmentUrl, `refs/tags/${reviewedTag}`);
    const destinationTagRemote = remoteGit(destination, "ls-remote", "--tags", destinationUrl, `refs/tags/${reviewedTag}`);
    check(
      results,
      "ledger branch and reviewed tag remain development-only",
      developmentLedgerRemote !== "" && destinationLedgerRemote === "" && developmentTagRemote !== "" && destinationTagRemote === "",
    );

    localGit(destination, "fetch", "origin", "main");
    const destinationPaths = localGit(destination, "ls-tree", "-r", "--name-only", "origin/main").split("\n");
    check(
      results,
      "destination main contains no Shipyard metadata",
      destinationPaths.every(
        (path) =>
          !path.startsWith(".shipyard") &&
          !path.startsWith(".graphs") &&
          !path.includes("prd") &&
          !path.includes("spec") &&
          !path.includes("ledger"),
      ),
    );

    check(
      results,
      "globally active GitHub CLI configuration is unchanged",
      configFingerprint() === configBefore,
    );

    process.stdout.write(`\n${results.length} GitHub lifecycle assertions passed.\n`);
    process.stdout.write(`Development PR: ${developmentPrUrl}\n`);
    process.stdout.write(`Destination PR: ${destinationPrUrl}\n`);
    process.stdout.write("Fixtures retained for human inspection.\n");
  } finally {
    token = "";
    if (keep) {
      process.stdout.write(`Local lab retained at ${lab}\n`);
    } else {
      rmSync(lab, { recursive: true, force: true });
      process.stdout.write(`Local lab removed: ${lab}\n`);
    }
  }
}

if (!exercise) {
  process.stdout.write("Run with --exercise to execute the approved one-shot GitHub fixture lifecycle.\n");
} else {
  try {
    await runExercise();
  } catch (error) {
    process.stderr.write(`\n\u001b[31mFAIL\u001b[0m ${error.stack || error}\n`);
    process.exitCode = 1;
  }
}
