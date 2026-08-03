#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const actor = "visualjc";
const expectedOrigin = "https://github.com/visualjc/agentic-shipyard.git";

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || "").trim();
}

function fingerprint() {
  const path = join(homedir(), ".config", "gh", "hosts.yml");
  if (!existsSync(path)) return "absent";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const repoIndex = process.argv.indexOf("--repo-root");
const separator = process.argv.indexOf("--");
if (repoIndex < 0 || !process.argv[repoIndex + 1]) fail("--repo-root is required");
if (separator < 0 || !process.argv[separator + 1]) fail("Git arguments must follow --");
const repoRoot = process.argv[repoIndex + 1];
const gitArgs = process.argv.slice(separator + 1);
if (!["push", "fetch"].includes(gitArgs[0])) fail("only push and fetch are allowed");
if (gitArgs.some((arg) => arg === "--force" || arg.startsWith("--force-") || arg.startsWith("+"))) {
  fail("force operations are prohibited");
}
if (gitArgs[1] !== "origin") fail("the remote argument must be origin");
if (run("git", ["remote", "get-url", "origin"], { cwd: repoRoot }) !== expectedOrigin) fail("origin mismatch");
if (run("git", ["remote"], { cwd: repoRoot }).split("\n").filter(Boolean).join(",") !== "origin") {
  fail("unexpected additional remote");
}

const before = fingerprint();
const lab = mkdtempSync(join(tmpdir(), "shipyard-scoped-git-"));
const askpass = join(lab, "askpass.sh");
let token = "";
try {
  token = run("gh", ["auth", "token", "--hostname", "github.com", "--user", actor]);
  const login = run("gh", ["api", "user", "--jq", ".login"], { env: { GH_TOKEN: token } });
  if (login !== actor) fail("command-scoped GitHub actor mismatch");
  writeFileSync(
    askpass,
    '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" visualjc ;;\n  *) printf "%s\\n" "$SHIPYARD_SCOPED_GIT_TOKEN" ;;\nesac\n',
    { mode: 0o700 },
  );
  const output = run(
    "git",
    ["-c", "credential.helper=", "-c", "credential.useHttpPath=true", ...gitArgs],
    {
      cwd: repoRoot,
      env: {
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: "0",
        SHIPYARD_SCOPED_GIT_TOKEN: token,
      },
    },
  );
  if (fingerprint() !== before) fail("global GitHub CLI configuration changed");
  process.stdout.write(`${output}\n`);
} finally {
  token = "";
  rmSync(lab, { recursive: true, force: true });
}
