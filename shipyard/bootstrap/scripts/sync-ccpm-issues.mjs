#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

const actor = "visualjc";
const targetRepo = "visualjc/agentic-shipyard";
const destinationRepo = "NativeInteractive/agentic-shipyard";
const expectedOrigin = `https://github.com/${targetRepo}.git`;
const epicName = "shipyard-v1";
const markerPrefix = `shipyard-bootstrap:${epicName}`;

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

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`${name} is required`);
  return realpathSync(process.argv[index + 1]);
}

function commonDir(repo) {
  const value = git(repo, "rev-parse", "--git-common-dir");
  return realpathSync(isAbsolute(value) ? value : resolve(repo, value));
}

function parseFrontmatter(body) {
  const match = body.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) fail("invalid Markdown frontmatter");
  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const index = line.indexOf(":");
    if (index > 0) fields.set(line.slice(0, index), line.slice(index + 1).trim());
  }
  return { fields, body: match[2] };
}

function renderFrontmatter(fields, body) {
  return `---\n${[...fields].map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n${body}`;
}

function parseList(value) {
  const match = value?.match(/^\[(.*)\]$/);
  if (!match || !match[1].trim()) return [];
  return match[1].split(",").map((item) => item.trim());
}

function fingerprintGhConfig() {
  const path = join(homedir(), ".config", "gh", "hosts.yml");
  if (!existsSync(path)) return "absent";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseIssueNumber(url) {
  const value = Number(url.trim().split("/").pop());
  if (!Number.isInteger(value)) fail(`could not parse issue URL: ${url}`);
  return value;
}

function marker(kind) {
  return `<!-- ${markerPrefix}:${kind} -->`;
}

function makeIssueBody({ kind, content, epicNumber, dependencies = [], conflicts = [] }) {
  const links = [];
  if (epicNumber) links.push(`Parent epic: #${epicNumber}`);
  if (dependencies.length) links.push(`Depends on: ${dependencies.map((number) => `#${number}`).join(", ")}`);
  if (conflicts.length) links.push(`Conflicts with: ${conflicts.map((number) => `#${number}`).join(", ")}`);
  return [marker(kind), ...links, "", content.trim(), ""].join("\n");
}

const repoRoot = arg("--repo-root");
const ledgerRoot = arg("--ledger-root");
if (git(repoRoot, "remote", "get-url", "origin") !== expectedOrigin) fail(`origin must be exactly ${expectedOrigin}`);
const remotes = git(repoRoot, "remote").split("\n").filter(Boolean);
if (remotes.length !== 1 || remotes[0] !== "origin") fail("development clone must retain only origin");
if (git(repoRoot, "branch", "--show-current") !== "main") fail("issue sync must run from development main");
if (git(ledgerRoot, "branch", "--show-current") !== "shipyard-ledger") fail("ledger worktree is not on shipyard-ledger");
if (commonDir(repoRoot) !== commonDir(ledgerRoot)) fail("development and ledger worktrees do not share one Git common directory");

const dataRoot = join(ledgerRoot, "shipyard", "ccpm");
const epicDir = join(dataRoot, "epics", epicName);
const epicPath = join(epicDir, "epic.md");
if (!existsSync(epicPath)) fail(`missing ${epicPath}`);

const configBefore = fingerprintGhConfig();
const token = run("gh", ["auth", "token", "--hostname", "github.com", "--user", actor]).stdout.trim();
if (!token) fail(`no stored token for ${actor}`);
const gh = (args, options = {}) =>
  run("gh", args, { ...options, env: { ...options.env, GH_TOKEN: token } });
if (gh(["api", "user", "--jq", ".login"]).stdout.trim() !== actor) fail("command-scoped GitHub actor mismatch");

for (const repo of [targetRepo, destinationRepo]) {
  const data = JSON.parse(gh(["repo", "view", repo, "--json", "visibility,viewerPermission"]).stdout);
  if (data.visibility !== "PRIVATE" || data.viewerPermission !== "ADMIN") fail(`${repo} is not private with ADMIN access`);
}
const destinationIssuesBefore = JSON.parse(
  gh(["issue", "list", "-R", destinationRepo, "--state", "all", "--limit", "100", "--json", "number"]).stdout,
);
if (destinationIssuesBefore.length !== 0) fail("destination repository already contains issues; refusing workflow sync");

const labels = [
  ["epic", "5319e7", "CCPM epic"],
  [`epic:${epicName}`, "8250df", `Tasks for ${epicName}`],
  ["feature", "0e8a16", "Product feature"],
  ["task", "1d76db", "CCPM task"],
];
for (const [name, color, description] of labels) {
  gh(["label", "create", name, "-R", targetRepo, "--color", color, "--description", description, "--force"]);
}

const existingIssues = JSON.parse(
  gh([
    "issue",
    "list",
    "-R",
    targetRepo,
    "--state",
    "all",
    "--limit",
    "100",
    "--json",
    "number,title,body,url,state",
  ]).stdout,
);
function existing(kind) {
  const exact = marker(kind);
  return existingIssues.find((issue) => issue.body?.includes(exact));
}

mkdirSync(epicDir, { recursive: true });
const statePath = join(epicDir, "bootstrap-sync-state.json");
const syncState = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { schemaVersion: 1, epic: null, tasks: {} };
function checkpoint() {
  writeFileSync(statePath, `${JSON.stringify(syncState, null, 2)}\n`);
}

let epicIssue = existing("epic");
const epicRecord = parseFrontmatter(readFileSync(epicPath, "utf8"));
if (!epicIssue) {
  const bodyPath = join(epicDir, ".bootstrap-epic-body.md");
  writeFileSync(bodyPath, makeIssueBody({ kind: "epic", content: epicRecord.body }));
  const url = gh([
    "issue",
    "create",
    "-R",
    targetRepo,
    "--title",
    `Epic: ${epicName}`,
    "--body-file",
    bodyPath,
    "--label",
    `epic,epic:${epicName},feature`,
  ]).stdout.trim();
  epicIssue = { number: parseIssueNumber(url), url };
}
syncState.epic = { number: epicIssue.number, url: epicIssue.url };
checkpoint();

const taskFiles = readdirSync(epicDir)
  .filter((name) => /^\d+\.md$/.test(name))
  .map((name) => {
    const path = join(epicDir, name);
    const record = parseFrontmatter(readFileSync(path, "utf8"));
    const bootstrapId = record.fields.get("bootstrap_id") || name.replace(/\.md$/, "").padStart(3, "0");
    return { name, path, record, bootstrapId };
  })
  .sort((a, b) => a.bootstrapId.localeCompare(b.bootstrapId));
if (!taskFiles.length) fail("no CCPM task files found");

const mapping = {};
for (const task of taskFiles) {
  const dependencyIds = parseList(task.record.fields.get("depends_on"));
  const conflictIds = parseList(task.record.fields.get("conflicts_with"));
  const dependencyNumbers = dependencyIds.map((id) => mapping[id]).filter(Boolean);
  if (dependencyNumbers.length !== dependencyIds.length) fail(`${task.bootstrapId} depends on an unsynchronized task`);
  const conflictNumbers = conflictIds.map((id) => mapping[id]).filter(Boolean);
  const kind = `task:${task.bootstrapId}`;
  let issue = existing(kind);
  if (!issue) {
    const bodyPath = join(epicDir, `.bootstrap-task-${task.bootstrapId}.md`);
    writeFileSync(
      bodyPath,
      makeIssueBody({
        kind,
        content: task.record.body,
        epicNumber: epicIssue.number,
        dependencies: dependencyNumbers,
        conflicts: conflictNumbers,
      }),
    );
    const url = gh([
      "issue",
      "create",
      "-R",
      targetRepo,
      "--title",
      task.record.fields.get("name"),
      "--body-file",
      bodyPath,
      "--label",
      `task,epic:${epicName}`,
    ]).stdout.trim();
    issue = { number: parseIssueNumber(url), url };
  }
  mapping[task.bootstrapId] = issue.number;
  syncState.tasks[task.bootstrapId] = { number: issue.number, url: issue.url };
  checkpoint();
}

const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
for (const task of taskFiles) {
  const issueNumber = mapping[task.bootstrapId];
  const fields = task.record.fields;
  fields.set("updated", now);
  fields.set("github", `https://github.com/${targetRepo}/issues/${issueNumber}`);
  fields.set("bootstrap_id", task.bootstrapId);
  const dependencies = parseList(fields.get("depends_on")).map((id) => mapping[id]);
  const conflicts = parseList(fields.get("conflicts_with")).map((id) => mapping[id]);
  fields.set("depends_on", `[${dependencies.join(", ")}]`);
  fields.set("conflicts_with", `[${conflicts.join(", ")}]`);
  writeFileSync(task.path, renderFrontmatter(fields, task.record.body));
}
for (const task of [...taskFiles].sort((a, b) => b.name.localeCompare(a.name))) {
  const destination = join(epicDir, `${mapping[task.bootstrapId]}.md`);
  if (task.path !== destination) {
    if (existsSync(destination)) fail(`refusing to overwrite ${destination}`);
    renameSync(task.path, destination);
  }
}

epicRecord.fields.set("updated", now);
epicRecord.fields.set("github", `https://github.com/${targetRepo}/issues/${epicIssue.number}`);
let epicBody = epicRecord.body;
for (const [source, number] of Object.entries(mapping)) {
  epicBody = epicBody.replaceAll(`${source}.md`, `${number}.md`);
}
writeFileSync(epicPath, renderFrontmatter(epicRecord.fields, epicBody));

const taskChecklist = taskFiles
  .map((task) => `- [ ] #${mapping[task.bootstrapId]} — ${task.record.fields.get("name")}`)
  .join("\n");
const updatedEpicBody = makeIssueBody({
  kind: "epic",
  content: `${epicBody.trim()}\n\n## GitHub Tasks\n\n${taskChecklist}`,
});
gh([
  "api",
  "--method",
  "PATCH",
  `repos/${targetRepo}/issues/${epicIssue.number}`,
  "-f",
  `body=${updatedEpicBody}`,
  "--silent",
]);

const mappingBody = [
  "# GitHub Issue Mapping",
  "",
  `Epic: #${epicIssue.number} - ${epicIssue.url}`,
  "Tasks:",
  ...taskFiles.map(
    (task) =>
      `- #${mapping[task.bootstrapId]}: ${task.record.fields.get("name")} - https://github.com/${targetRepo}/issues/${mapping[task.bootstrapId]}`,
  ),
  `Synced: ${now}`,
  "",
].join("\n");
writeFileSync(join(epicDir, "github-mapping.md"), mappingBody);

for (const name of readdirSync(epicDir).filter((value) => value.startsWith(".bootstrap-") && value.endsWith(".md"))) {
  unlinkSync(join(epicDir, name));
}

const destinationIssuesAfter = JSON.parse(
  gh(["issue", "list", "-R", destinationRepo, "--state", "all", "--limit", "100", "--json", "number"]).stdout,
);
if (destinationIssuesAfter.length !== 0) fail("destination repository received an unexpected issue");
if (fingerprintGhConfig() !== configBefore) fail("global GitHub CLI configuration changed");

process.stdout.write(
  `${JSON.stringify({
    status: "synced",
    actor,
    targetRepo,
    destinationIssueCount: destinationIssuesAfter.length,
    epic: syncState.epic,
    tasks: syncState.tasks,
  })}\n`,
);
