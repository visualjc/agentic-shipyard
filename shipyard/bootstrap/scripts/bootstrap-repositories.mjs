#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

const actor = "visualjc";
const developmentRepo = "visualjc/agentic-shipyard";
const destinationRepo = "NativeInteractive/agentic-shipyard";
const developmentUrl = `https://github.com/${developmentRepo}.git`;
const destinationUrl = `https://github.com/${destinationRepo}.git`;

function fail(message) {
  throw new Error(message);
}

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
    fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function git(cwd, ...args) {
  return run("git", args, { cwd }).stdout.trim();
}

function configureGit(cwd) {
  git(cwd, "config", "user.name", "Shipyard Bootstrap");
  git(cwd, "config", "user.email", "shipyard-bootstrap@users.noreply.github.com");
}

function fingerprintGhConfig() {
  const path = join(homedir(), ".config", "gh", "hosts.yml");
  if (!existsSync(path)) return "absent";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitPath(repo, value) {
  const path = git(repo, "rev-parse", "--git-path", value);
  return isAbsolute(path) ? path : resolve(repo, path);
}

function appendExclude(repo, pattern) {
  const path = gitPath(repo, "info/exclude");
  mkdirSync(dirname(path), { recursive: true });
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const entries = new Set(current.split("\n").filter(Boolean));
  entries.add(pattern);
  writeFileSync(path, `${[...entries].join("\n")}\n`);
}

const repoRootIndex = process.argv.indexOf("--repo-root");
if (repoRootIndex < 0 || !process.argv[repoRootIndex + 1]) fail("--repo-root is required");
const repoRoot = realpathSync(process.argv[repoRootIndex + 1]);
const bootstrapRoot = dirname(new URL(import.meta.url).pathname);
const lab = mkdtempSync(join(tmpdir(), "agentic-shipyard-bootstrap-"));
const askpass = join(lab, "askpass.sh");
let token = "";
const configBefore = fingerprintGhConfig();

try {
  token = run("gh", ["auth", "token", "--hostname", "github.com", "--user", actor]).stdout.trim();
  if (!token) fail(`no stored token for ${actor}`);
  const gh = (args, options = {}) =>
    run("gh", args, { ...options, env: { ...options.env, GH_TOKEN: token } });
  if (gh(["api", "user", "--jq", ".login"]).stdout.trim() !== actor) fail("scoped GitHub actor mismatch");

  for (const [repo, description] of [
    [developmentRepo, "Private Shipyard development-actor repository"],
    [destinationRepo, "Canonical Agentic Shipyard destination repository"],
  ]) {
    const view = gh(["repo", "view", repo, "--json", "visibility,viewerPermission,url"], { allowFailure: true });
    if (view.status !== 0) {
      gh(["repo", "create", repo, "--private", "--description", description]);
    }
    const data = JSON.parse(gh(["repo", "view", repo, "--json", "visibility,viewerPermission,url"]).stdout);
    if (data.visibility !== "PRIVATE" || data.viewerPermission !== "ADMIN") {
      fail(`${repo} is not private with ADMIN access`);
    }
  }

  writeFileSync(
    askpass,
    '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" visualjc ;;\n  *) printf "%s\\n" "$SHIPYARD_BOOTSTRAP_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  );
  const remoteEnv = {
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: "0",
    SHIPYARD_BOOTSTRAP_TOKEN: token,
  };
  const remoteGit = (cwd, ...args) =>
    run("git", ["-c", "credential.helper=", "-c", "credential.useHttpPath=true", ...args], {
      cwd,
      env: remoteEnv,
    }).stdout.trim();

  const destinationMain = gh(["api", `repos/${destinationRepo}/git/ref/heads/main`], { allowFailure: true });
  let baselineSha;
  if (destinationMain.status !== 0) {
    const seed = join(lab, "destination-seed");
    mkdirSync(seed, { recursive: true });
    git(seed, "init", "-b", "main");
    configureGit(seed);
    git(seed, "remote", "add", "origin", destinationUrl);
    writeFileSync(join(seed, "README.md"), readFileSync(join(bootstrapRoot, "seed", "README.md")));
    writeFileSync(join(seed, ".gitignore"), readFileSync(join(bootstrapRoot, "seed", ".gitignore")));
    git(seed, "add", "README.md", ".gitignore");
    git(seed, "commit", "-m", "Bootstrap Agentic Shipyard");
    baselineSha = git(seed, "rev-parse", "HEAD");
    remoteGit(seed, "push", "-u", "origin", "main");
  } else {
    baselineSha = JSON.parse(destinationMain.stdout).object.sha;
  }

  if (!existsSync(join(repoRoot, ".git"))) {
    git(repoRoot, "init", "-b", "main");
  }
  if (realpathSync(git(repoRoot, "rev-parse", "--show-toplevel")) !== repoRoot) {
    fail("repo root resolved to an unexpected Git worktree");
  }
  configureGit(repoRoot);
  const remotesBefore = git(repoRoot, "remote").split("\n").filter(Boolean);
  if (!remotesBefore.includes("origin")) git(repoRoot, "remote", "add", "origin", developmentUrl);
  if (git(repoRoot, "remote", "get-url", "origin") !== developmentUrl) fail("development origin mismatch");
  if (git(repoRoot, "remote").split("\n").filter(Boolean).join(",") !== "origin") {
    fail("development clone contains an unexpected remote");
  }

  remoteGit(repoRoot, "fetch", destinationUrl, "main");
  git(repoRoot, "checkout", "-B", "main", "FETCH_HEAD");
  if (git(repoRoot, "rev-parse", "HEAD") !== baselineSha) fail("local development main does not match destination main");
  remoteGit(repoRoot, "push", "-u", "origin", "main");

  for (const pattern of ["PREMISE.md", ".scratch/", "bootstrap/", ".claude"]) appendExclude(repoRoot, pattern);
  if (git(repoRoot, "status", "--porcelain=v1") !== "") fail("development main is not clean after local exclusions");

  const developmentRemoteSha = remoteGit(repoRoot, "ls-remote", developmentUrl, "refs/heads/main").split(/\s+/)[0];
  const destinationRemoteSha = remoteGit(repoRoot, "ls-remote", destinationUrl, "refs/heads/main").split(/\s+/)[0];
  if (developmentRemoteSha !== baselineSha || destinationRemoteSha !== baselineSha) fail("remote main SHAs are not identical");

  const developmentIssues = JSON.parse(
    gh(["issue", "list", "-R", developmentRepo, "--state", "all", "--limit", "100", "--json", "number"]).stdout,
  );
  const destinationIssues = JSON.parse(
    gh(["issue", "list", "-R", destinationRepo, "--state", "all", "--limit", "100", "--json", "number"]).stdout,
  );
  if (developmentIssues.length || destinationIssues.length) fail("new repositories unexpectedly contain issues");
  if (fingerprintGhConfig() !== configBefore) fail("global GitHub CLI configuration changed");

  const receipt = {
    schemaVersion: 1,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    actor,
    baselineSha,
    development: `https://github.com/${developmentRepo}`,
    destination: `https://github.com/${destinationRepo}`,
    localDevelopmentRoot: repoRoot,
    developmentRemotes: ["origin"],
    globalGhConfigUnchanged: true,
  };
  const receiptPath = join(repoRoot, ".scratch", "shipyard-v1", "bootstrap", "repository-bootstrap.json");
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  token = "";
  rmSync(lab, { recursive: true, force: true });
}
