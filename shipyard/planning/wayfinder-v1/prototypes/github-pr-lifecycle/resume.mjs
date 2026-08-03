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
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`);
  }
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(cwd, ...args) {
  return run("git", args, { cwd }).stdout.trim();
}

function configureGit(cwd) {
  git(cwd, "config", "user.name", "Shipyard Fixture Actor");
  git(cwd, "config", "user.email", "shipyard-fixture@example.invalid");
}

function commitAll(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function parseJson(text) {
  return JSON.parse(text.trim());
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

async function resume() {
  const lab = mkdtempSync(join(tmpdir(), "shipyard-github-resume-"));
  const askpass = join(lab, "askpass.sh");
  const development = join(lab, "development");
  const feature = join(lab, "feature");
  const ledger = join(lab, "ledger");
  const destination = join(lab, "destination");
  const results = [];
  const configBefore = configFingerprint();
  let token = "";

  process.stdout.write(`Shipyard GitHub lifecycle resume lab: ${lab}\n\n`);

  try {
    token = run("gh", ["auth", "token", "--hostname", "github.com", "--user", "visualjc"]).stdout.trim();
    const gh = (args, options = {}) =>
      run("gh", args, { ...options, env: { ...options.env, GH_TOKEN: token } });
    const scopedLogin = gh(["api", "user", "--jq", ".login"]).stdout.trim();
    check(results, "command-scoped GitHub actor is visualjc", scopedLogin === "visualjc", scopedLogin);

    const developmentPr = parseJson(
      gh([
        "pr",
        "view",
        "2",
        "-R",
        developmentRepo,
        "--json",
        "state,headRefName,headRefOid,baseRefOid,url,commits",
      ]).stdout,
    );
    const destinationPr = parseJson(
      gh([
        "pr",
        "view",
        "1",
        "-R",
        destinationRepo,
        "--json",
        "state,headRefName,headRefOid,baseRefOid,url,commits,isCrossRepository,headRepositoryOwner",
      ]).stdout,
    );
    const featureShas = developmentPr.commits.map((commit) => commit.oid);
    const destinationShas = destinationPr.commits.map((commit) => commit.oid);
    const [featureSha1, featureSha2] = featureShas;
    const [destinationCommit1, destinationCommit2] = destinationShas;
    check(
      results,
      "resume point has two open append-only development revisions",
      developmentPr.state === "OPEN" &&
        developmentPr.headRefName === featureBranch &&
        developmentPr.headRefOid === featureSha2 &&
        featureShas.length === 2,
    );
    check(
      results,
      "resume point has a normal destination-owned PR with two revisions",
      destinationPr.state === "OPEN" &&
        destinationPr.isCrossRepository === false &&
        destinationPr.headRepositoryOwner.login === "NativeInteractive" &&
        destinationPr.headRefName === destinationBranch &&
        destinationPr.headRefOid === destinationCommit2 &&
        destinationShas.length === 2,
    );

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

    remoteGit(lab, "clone", developmentUrl, development);
    configureGit(development);
    git(development, "worktree", "add", "-b", "resume-feature", feature, `origin/${featureBranch}`);
    git(development, "worktree", "add", "-b", "resume-ledger", ledger, "origin/shipyard-ledger");
    configureGit(feature);
    configureGit(ledger);
    remoteGit(lab, "clone", destinationUrl, destination);
    configureGit(destination);
    git(destination, "checkout", "-b", "resume-destination", `origin/${destinationBranch}`);

    const review1 = parseJson(readFileSync(join(ledger, deliveryId, "reviews", "001.json"), "utf8"));
    const review2 = parseJson(readFileSync(join(ledger, deliveryId, "reviews", "002.json"), "utf8"));
    check(
      results,
      "both independent Codex reviews attest their exact development SHAs",
      review1.reviewedSha === featureSha1 &&
        review2.reviewedSha === featureSha2 &&
        review1.verdict === "pass" &&
        review2.verdict === "pass",
    );
    check(
      results,
      "destination revision is append-only and matches final reviewed tree",
      git(destination, "rev-parse", `${destinationCommit2}^`) === destinationCommit1 &&
        git(destination, "rev-parse", `${destinationCommit2}^{tree}`) ===
          git(feature, "rev-parse", `${featureSha2}^{tree}`),
    );

    const destinationBody = join(lab, "destination-pr.md");
    write(
      destinationBody,
      `# Synthetic Shipyard delivery\n\nDelivery: ${deliveryId}\n\nRevision 001: development \`${featureSha1}\` -> destination \`${destinationCommit1}\`\nRevision 002: development \`${featureSha2}\` -> destination \`${destinationCommit2}\`\n\nReview round 1: ${review1.verdict}; ${review1.findings.join(" ")}\nReview round 2: ${review2.verdict}; ${review2.findings.join(" ")}\n\nDestination feedback was implemented in the development repository, independently re-reviewed at the new exact SHA, and appended here without force-pushing.\n`,
    );
    gh([
      "api",
      "--method",
      "PATCH",
      `repos/${destinationRepo}/pulls/1`,
      "-F",
      `body=@${destinationBody}`,
      "--silent",
    ]);
    check(results, "destination review dossier is updated through the REST API", true);

    const mergeResult = parseJson(
      gh([
        "api",
        "--method",
        "PUT",
        `repos/${destinationRepo}/pulls/1/merge`,
        "-f",
        `sha=${destinationCommit2}`,
        "-f",
        "merge_method=merge",
        "-f",
        `commit_title=[${deliveryId}] Merge reviewed synthetic payload`,
        "-f",
        "commit_message=Synthetic human-merge simulation for the disposable Shipyard fixture.",
      ]).stdout,
    );
    check(results, "destination merge accepts only the expected head SHA", mergeResult.merged === true, mergeResult.sha);
    const destinationMergeSha = mergeResult.sha;

    write(
      join(ledger, deliveryId, "final.md"),
      `# Final delivery\n\nDevelopment PR: ${developmentPr.url}\nDestination PR: ${destinationPr.url}\nReviewed product SHA: ${featureSha2}\nDestination payload SHA: ${destinationCommit2}\nDestination merge SHA: ${destinationMergeSha}\n`,
    );
    const finalLedgerSha = commitAll(ledger, "Finalize synthetic delivery record");
    remoteGit(ledger, "push", "origin", "HEAD:shipyard-ledger");
    git(feature, "tag", "-a", reviewedTag, featureSha2, "-m", `Reviewed ${deliveryId}; ledger ${finalLedgerSha}`);
    remoteGit(feature, "push", "origin", `refs/tags/${reviewedTag}`);
    check(results, "final ledger checkpoint and exact reviewed tag are published", true, finalLedgerSha.slice(0, 12));

    remoteGit(development, "fetch", destinationUrl, "main");
    git(development, "merge", "--ff-only", "FETCH_HEAD");
    remoteGit(development, "push", "origin", "main");
    const developmentMain = remoteGit(development, "ls-remote", developmentUrl, "refs/heads/main").split(/\s+/)[0];
    const destinationMain = remoteGit(development, "ls-remote", destinationUrl, "refs/heads/main").split(/\s+/)[0];
    check(
      results,
      "merged destination main synchronizes exactly to development main",
      developmentMain === destinationMain && destinationMain === destinationMergeSha,
    );

    gh([
      "api",
      `repos/${developmentRepo}/issues/2/comments`,
      "-f",
      `body=Delivered and merged through ${destinationPr.url}; closing this development PR without merge.`,
      "--silent",
    ]);
    gh([
      "api",
      "--method",
      "PATCH",
      `repos/${developmentRepo}/pulls/2`,
      "-f",
      "state=closed",
      "--silent",
    ]);
    gh([
      "api",
      `repos/${developmentRepo}/issues/1/comments`,
      "-f",
      `body=Completed by destination delivery ${destinationPr.url}.`,
      "--silent",
    ]);
    gh([
      "api",
      "--method",
      "PATCH",
      `repos/${developmentRepo}/issues/1`,
      "-f",
      "state=closed",
      "--silent",
    ]);
    remoteGit(feature, "push", "origin", "--delete", featureBranch);
    remoteGit(destination, "push", "origin", "--delete", destinationBranch);

    const developmentPrFinal = parseJson(
      gh(["api", `repos/${developmentRepo}/pulls/2`]).stdout,
    );
    const destinationPrFinal = parseJson(
      gh(["api", `repos/${destinationRepo}/pulls/1`]).stdout,
    );
    check(
      results,
      "development PR closes without merge while destination PR is merged",
      developmentPrFinal.state === "closed" &&
        developmentPrFinal.merged_at === null &&
        destinationPrFinal.state === "closed" &&
        destinationPrFinal.merged_at !== null,
    );

    const developmentFeature = remoteGit(development, "ls-remote", "--heads", developmentUrl, featureBranch);
    const destinationDelivery = remoteGit(destination, "ls-remote", "--heads", destinationUrl, destinationBranch);
    check(results, "delivery branches are deleted", developmentFeature === "" && destinationDelivery === "");

    const developmentLedger = remoteGit(development, "ls-remote", "--heads", developmentUrl, "shipyard-ledger");
    const destinationLedger = remoteGit(destination, "ls-remote", "--heads", destinationUrl, "shipyard-ledger");
    const developmentTag = remoteGit(development, "ls-remote", "--tags", developmentUrl, `refs/tags/${reviewedTag}`);
    const destinationTag = remoteGit(destination, "ls-remote", "--tags", destinationUrl, `refs/tags/${reviewedTag}`);
    check(
      results,
      "ledger branch and reviewed tag remain development-only",
      developmentLedger !== "" && destinationLedger === "" && developmentTag !== "" && destinationTag === "",
    );

    remoteGit(destination, "fetch", "origin", "main");
    const destinationPaths = git(destination, "ls-tree", "-r", "--name-only", "origin/main").split("\n");
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
    check(results, "globally active GitHub CLI configuration is unchanged", configFingerprint() === configBefore);

    process.stdout.write(`\n${results.length} resume assertions passed.\n`);
    process.stdout.write(`Development PR: ${developmentPr.url}\n`);
    process.stdout.write(`Destination PR: ${destinationPr.url}\n`);
  } finally {
    token = "";
    rmSync(lab, { recursive: true, force: true });
    process.stdout.write(`Local resume lab removed: ${lab}\n`);
  }
}

try {
  await resume();
} catch (error) {
  process.stderr.write(`\n\u001b[31mFAIL\u001b[0m ${error.stack || error}\n`);
  process.exitCode = 1;
}
