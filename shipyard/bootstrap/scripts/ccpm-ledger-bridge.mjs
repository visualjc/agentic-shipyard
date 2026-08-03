#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

const expectedOrigin = "https://github.com/visualjc/agentic-shipyard.git";
const expectedProductBranch = "main";
const expectedLedgerBranch = "shipyard-ledger";

function fail(message) {
  throw new Error(message);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || "").trim();
}

function git(cwd, ...args) {
  return run("git", args, cwd);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`${name} is required`);
  return realpathSync(process.argv[index + 1]);
}

function commonDir(repo) {
  const value = git(repo, "rev-parse", "--git-common-dir");
  return realpathSync(isAbsolute(value) ? value : resolve(repo, value));
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

const repoRoot = arg("--repo-root");
const ledgerRoot = arg("--ledger-root");

if (git(repoRoot, "remote", "get-url", "origin") !== expectedOrigin) {
  fail(`development origin must be exactly ${expectedOrigin}`);
}
const remotes = git(repoRoot, "remote").split("\n").filter(Boolean);
if (remotes.length !== 1 || remotes[0] !== "origin") fail("development clone must retain only origin");
if (git(repoRoot, "branch", "--show-current") !== expectedProductBranch) {
  fail(`development checkout must be ${expectedProductBranch}`);
}
if (git(ledgerRoot, "branch", "--show-current") !== expectedLedgerBranch) {
  fail(`ledger checkout must be ${expectedLedgerBranch}`);
}
if (commonDir(repoRoot) !== commonDir(ledgerRoot)) fail("product and ledger must share one Git common directory");

const target = join(ledgerRoot, "shipyard", "ccpm");
for (const directory of ["prds", "epics", "context", join("testing", "logs")]) {
  mkdirSync(join(target, directory), { recursive: true });
}

const link = join(repoRoot, ".claude");
if (existsSync(link)) {
  if (!lstatSync(link).isSymbolicLink()) fail("existing .claude path is not a symlink; refusing to overwrite it");
  const linked = realpathSync(resolve(dirname(link), readlinkSync(link)));
  if (linked !== realpathSync(target)) fail("existing .claude symlink points outside the verified ledger data root");
} else {
  symlinkSync(target, link, "dir");
}

appendExclude(repoRoot, "/.claude");

process.stdout.write(
  `${JSON.stringify({
    status: "ready",
    repoRoot,
    ledgerRoot,
    dataRoot: realpathSync(target),
    link,
    origin: expectedOrigin,
  })}\n`,
);
