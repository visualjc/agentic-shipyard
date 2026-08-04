import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CODEGRAPH_RECEIPT, createGraphLaneService, GRAPHIFY_RECEIPT, type Profile } from "../../src/index.js";
import { createNodeGraphFiles, createNodeLocalGraphCommand, NodeGraphLockStore } from "../../src/adapters/graph-runtime.js";
import { graphDescriptorPath } from "../../src/adapters/graph-runtime.js";
import { snapshotGraphSource, createGitGraphSourceReader } from "../../src/index.js";
import { createGraphLaneServiceForTesting } from "../../src/graph/service.js";

const topology = { kind: "single-repository" as const, repository: { owner: "test", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } };
const base = (graph?: Profile["graph"]): Profile => ({ schemaVersion: 1, name: "p", actor: { login: "actor" }, topology, allowedOperations: ["status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] }, ...(graph ? { graph } : {}) });

test("disabled production graph status makes no source or lock calls", async () => {
  let calls = 0; const service = createGraphLaneServiceForTesting("/tmp/shipyard-disabled", "/usr/bin/git", { reader: { canonicalWorktree: async () => { calls++; return undefined; }, worktreeInstanceId: async () => undefined, headSha: async () => undefined, worktreeStatus: async () => undefined }, lockStore: { read: async () => { calls++; return undefined; }, createExclusive: async () => false, removeVerified: async () => false } });
  const status = await service.status(base(), "/not-read"); assert.equal(status.decision.state, "disabled"); assert.equal(calls, 0);
  const invalid = await service.status({ ...base(), graph: { enabled: false, extra: true } } as never, "/not-read"); assert.equal(invalid.decision.state, "invalid"); assert.equal(calls, 0);
});

test("bounded production command observes a sidecar receipt without PATH lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-command-")); const tool = join(root, "graphify");
  try {
    await writeFile(tool, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '0.9.32\\n'; else printf ok; fi\n"); await chmod(tool, 0o755);
    const canonicalTool = await realpath(tool); await writeFile(`${tool}.shipyard-receipt.json`, JSON.stringify({ executable: canonicalTool, version: "0.9.32", sourceReceipt: GRAPHIFY_RECEIPT }));
    const command = createNodeLocalGraphCommand(); const prior = process.env.PATH; process.env.PATH = "/hostile";
    try { assert.deepEqual(await command.observe(tool), { executable: canonicalTool, version: "0.9.32", sourceReceipt: GRAPHIFY_RECEIPT }); const result = await command.run(tool, [], { cwd: root, env: {} }); assert.equal((result as { code: number }).code, 0); }
    finally { process.env.PATH = prior; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production graph children fail closed on hard output and time limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-command-limits-")); const tool = join(root, "tool");
  try {
    await writeFile(tool, "#!/bin/sh\nif [ \"$1\" = huge ]; then yes x | head -c 4096; else sleep 1; fi\n"); await chmod(tool, 0o755); const command = createNodeLocalGraphCommand({ timeoutMs: 25, maxBytes: 512 });
    const huge = await command.run(tool, ["huge"], { cwd: root, env: {} }) as { code: number; stdout: string }; assert.notEqual(huge.code, 0); assert.equal(huge.stdout, "");
    const slow = await command.run(tool, ["slow"], { cwd: root, env: {} }) as { code: number; timedOut: boolean }; assert.notEqual(slow.code, 0); assert.equal(slow.timedOut, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("oversized production lock records are blocked rather than treated as absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-lock-limit-")); const path = join(root, "graph.lock");
  try { await writeFile(path, "x".repeat(16 * 1024 + 1)); await assert.rejects(() => new NodeGraphLockStore().read(path)); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("production Graphify refresh uses an external private cache and status is read-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-lane-")); const repo = join(root, "repo"), home = join(root, "home"), cache = join(root, "cache"), tool = join(root, "graphify");
  try {
    execFileSync("/usr/bin/git", ["init", "-b", "main", repo]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.email", "fixture@example.test"]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.name", "Fixture"]); await writeFile(join(repo, "a"), "a\n"); execFileSync("/usr/bin/git", ["-C", repo, "add", "a"]); execFileSync("/usr/bin/git", ["-C", repo, "commit", "-m", "base"]); await mkdir(cache);
    await writeFile(tool, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '0.9.32\\n'; exit 0; fi\nmkdir -p \"$GRAPHIFY_OUT\"\nprintf graph > \"$GRAPHIFY_OUT/index\"\n"); await chmod(tool, 0o755); const canonicalTool = await realpath(tool); await writeFile(`${tool}.shipyard-receipt.json`, JSON.stringify({ executable: canonicalTool, version: "0.9.32", sourceReceipt: GRAPHIFY_RECEIPT }));
    const profile = base({ enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, executablePath: canonicalTool, cacheRoot: await realpath(cache) }); const service = createGraphLaneService(home, "/usr/bin/git");
    const refreshed = await service.refresh(profile, repo); assert.equal(refreshed.decision.state, "fresh", refreshed.decision.reason); const external = profile.graph?.enabled && profile.graph.adapter === "graphify" ? profile.graph.cacheRoot : cache; assert.ok(refreshed.descriptor?.cacheRoot.startsWith(`${external}/`)); assert.equal(refreshed.descriptor?.worktreeRoot.startsWith(external), false);
    const source = await snapshotGraphSource(createGitGraphSourceReader("/usr/bin/git"), repo); const descriptorFile = graphDescriptorPath(home, "graphify", source.worktreeInstanceId); const before = await readFile(descriptorFile, "utf8"); const status = await service.status(profile, repo); assert.equal(status.decision.state, "fresh"); assert.equal(await readFile(descriptorFile, "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production CodeGraph files establish exclusion and detect tracked cache state", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-codegraph-"));
  try {
    execFileSync("/usr/bin/git", ["init", root]); const files = createNodeGraphFiles("/usr/bin/git"); await files.addMachineLocalExclude(root, ".codegraph/"); assert.equal(await files.excluded(root, ".codegraph/"), true); assert.equal(await files.tracked(join(root, ".codegraph")), false);
    await mkdir(join(root, ".codegraph")); await writeFile(join(root, ".codegraph", "tracked"), "x"); execFileSync("/usr/bin/git", ["-C", root, "add", "-f", ".codegraph/tracked"]); assert.equal(await files.tracked(join(root, ".codegraph")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production CodeGraph lane runs observed FTS5/index children with telemetry disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-codegraph-lane-")); const repo = join(root, "repo"), node = join(root, "node"), codegraph = join(root, "codegraph"), home = join(root, "home");
  try {
    execFileSync("/usr/bin/git", ["init", "-b", "main", repo]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.email", "fixture@example.test"]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.name", "Fixture"]); await writeFile(join(repo, "a"), "a\n"); execFileSync("/usr/bin/git", ["-C", repo, "add", "a"]); execFileSync("/usr/bin/git", ["-C", repo, "commit", "-m", "base"]);
    await writeFile(node, "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '24.13.1\\n'; fi\n"); await writeFile(codegraph, "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '1.5.0\\n'; exit 0; fi\n[ \"$CODEGRAPH_TELEMETRY\" = 0 ] || exit 9\nmkdir -p .codegraph\nprintf db > .codegraph/codegraph.db\n"); await chmod(node, 0o755); await chmod(codegraph, 0o755); const canonicalNode = await realpath(node), canonicalCodeGraph = await realpath(codegraph); await writeFile(`${node}.shipyard-receipt.json`, JSON.stringify({ executable: canonicalNode, version: "24.13.1", sourceReceipt: "node:sqlite-fts5" })); await writeFile(`${codegraph}.shipyard-receipt.json`, JSON.stringify({ executable: canonicalCodeGraph, version: "1.5.0", sourceReceipt: CODEGRAPH_RECEIPT }));
    const profile = base({ enabled: true, localOnlyApproved: true, adapter: "codegraph", reviewedToolSource: CODEGRAPH_RECEIPT, executablePath: canonicalCodeGraph, nodeExecutablePath: canonicalNode }); const result = await createGraphLaneService(home, "/usr/bin/git").refresh(profile, repo); assert.equal(result.decision.state, "fresh", result.decision.reason); assert.equal(result.descriptor?.cacheRoot, join(await realpath(repo), ".codegraph"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
