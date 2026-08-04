import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CODEGRAPH_RECEIPT, createGraphLaneService, GRAPHIFY_RECEIPT, type Profile } from "../../src/index.js";
import { createNodeGraphFiles, createNodeLocalGraphCommand, NodeGraphLockStore } from "../../src/adapters/graph-runtime.js";
import { graphDescriptorPath } from "../../src/adapters/graph-runtime.js";
import { snapshotGraphSource, createGitGraphSourceReader } from "../../src/index.js";
import { snapshotGraphExecutableObservation } from "../../src/graph/artifact.js";
import { createGraphLaneServiceForTesting } from "../../src/graph/service.js";

const topology = { kind: "single-repository" as const, repository: { owner: "test", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } };
const base = (graph?: Profile["graph"]): Profile => ({ schemaVersion: 1, name: "p", actor: { login: "actor" }, topology, allowedOperations: ["status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] }, ...(graph ? { graph } : {}) });
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

async function graphifyFixture(prefix: string, operation: string, prepare?: (repo: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), prefix)), repo = join(root, "repo"), home = join(root, "home"), cache = join(root, "cache"), tool = join(root, "graphify");
  execFileSync("/usr/bin/git", ["init", "-b", "main", repo]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.email", "fixture@example.test"]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.name", "Fixture"]); await mkdir(join(repo, "src")); await writeFile(join(repo, "src", "base"), "base\n"); if (prepare) await prepare(repo); execFileSync("/usr/bin/git", ["-C", repo, "add", "."]); execFileSync("/usr/bin/git", ["-C", repo, "commit", "-m", "base"]); await mkdir(cache);
  const body = `#!/bin/sh\nif [ "$1" = --version ]; then printf '0.9.32\\n'; exit 0; fi\nmkdir -p "$GRAPHIFY_OUT"\nprintf graph > "$GRAPHIFY_OUT/index"\n${operation}\n`; await writeFile(tool, body); await chmod(tool, 0o755); const canonicalTool = await realpath(tool);
  const profile = base({ enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, artifactSha256: digest(body), executablePath: canonicalTool, cacheRoot: await realpath(cache) }); const result = await createGraphLaneService(home, "/usr/bin/git").refresh(profile, repo);
  return { root, repo, result };
}

test("disabled production graph status makes no source or lock calls", async () => {
  let calls = 0; const service = createGraphLaneServiceForTesting("/tmp/shipyard-disabled", "/usr/bin/git", { reader: { canonicalWorktree: async () => { calls++; return undefined; }, worktreeInstanceId: async () => undefined, headSha: async () => undefined, worktreeStatus: async () => undefined }, lockStore: { read: async () => { calls++; return undefined; }, createExclusive: async () => false, removeVerified: async () => false } });
  const status = await service.status(base(), "/not-read"); assert.equal(status.decision.state, "disabled"); assert.equal(calls, 0);
  const invalid = await service.status({ ...base(), graph: { enabled: false, extra: true } } as never, "/not-read"); assert.equal(invalid.decision.state, "invalid"); assert.equal(calls, 0);
});

test("bounded production command binds execution to the reviewed artifact digest without trusting sidecars or PATH", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-command-")); const tool = join(root, "graphify");
  try {
    const body = "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '0.9.32\\n'; else printf ok; fi\n";
    await writeFile(tool, body); await chmod(tool, 0o755);
    const canonicalTool = await realpath(tool);
    await writeFile(`${tool}.shipyard-receipt.json`, JSON.stringify({ executable: canonicalTool, version: "0.9.32", sourceReceipt: GRAPHIFY_RECEIPT, artifactSha256: "0".repeat(64) }));
    const command = createNodeLocalGraphCommand(); const prior = process.env.PATH; process.env.PATH = "/hostile";
    try {
      assert.equal(await command.observe(tool, { sourceReceipt: GRAPHIFY_RECEIPT, artifactSha256: "0".repeat(64) }), undefined, "a forged adjacent sidecar cannot attest the executable");
      const artifactSha256 = digest(body); const observation = await command.observe(tool, { sourceReceipt: GRAPHIFY_RECEIPT, artifactSha256 });
      assert.deepEqual(observation, { executable: canonicalTool, version: "0.9.32", sourceReceipt: GRAPHIFY_RECEIPT, artifactSha256 });
      const result = await command.run(canonicalTool, [], { cwd: root, env: {}, artifact: observation! }); assert.equal((result as { code: number }).code, 0);
      const swapped = "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '0.9.32\\n'; else printf swapped; fi\n"; await writeFile(tool, swapped); await chmod(tool, 0o755);
      const rejected = await command.run(canonicalTool, [], { cwd: root, env: {}, artifact: observation! }) as { code: number }; assert.notEqual(rejected.code, 0, "a same-version executable swap must fail its profile digest binding");
    }
    finally { process.env.PATH = prior; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production graph children fail closed on hard output and time limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-command-limits-")); const tool = join(root, "tool");
  try {
    const body = "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '1\\n'; exit 0; fi\nif [ \"$1\" = huge ]; then yes x | head -c 4096; else sleep 1; fi\n";
    await writeFile(tool, body); await chmod(tool, 0o755); const canonicalTool = await realpath(tool), command = createNodeLocalGraphCommand({ timeoutMs: 200, maxBytes: 512 });
    const observation = snapshotGraphExecutableObservation(await createNodeLocalGraphCommand().observe(canonicalTool, { sourceReceipt: "test-tool", artifactSha256: digest(body) })); assert.ok(observation);
    const huge = await command.run(canonicalTool, ["huge"], { cwd: root, env: {}, artifact: observation }) as { code: number; stdout: string }; assert.notEqual(huge.code, 0); assert.equal(huge.stdout, "");
    const slow = await command.run(canonicalTool, ["slow"], { cwd: root, env: {}, artifact: observation }) as { code: number; timedOut: boolean }; assert.notEqual(slow.code, 0); assert.equal(slow.timedOut, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production graph child limits terminate the complete descendant process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-command-tree-")); const tool = join(root, "tool"); const timeoutMarker = join(root, "timeout-marker"), overflowMarker = join(root, "overflow-marker");
  try {
    const body = "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '1\\n'; exit 0; fi\n(sleep 0.4; printf descendant > \"$MARKER\") &\nif [ \"$1\" = overflow ]; then yes x; else sleep 10; fi\n";
    await writeFile(tool, body); await chmod(tool, 0o755); const canonicalTool = await realpath(tool), command = createNodeLocalGraphCommand({ timeoutMs: 200, maxBytes: 256 });
    const observation = snapshotGraphExecutableObservation(await createNodeLocalGraphCommand().observe(canonicalTool, { sourceReceipt: "test-tree", artifactSha256: digest(body) })); assert.ok(observation);
    const timed = await command.run(canonicalTool, ["timeout"], { cwd: root, env: { MARKER: timeoutMarker }, artifact: observation }) as { code: number; timedOut: boolean }; assert.notEqual(timed.code, 0); assert.equal(timed.timedOut, true);
    await new Promise(resolve => setTimeout(resolve, 500)); await assert.rejects(readFile(timeoutMarker), "timeout must kill descendants before they can mutate state");
    const overflow = await command.run(canonicalTool, ["overflow"], { cwd: root, env: { MARKER: overflowMarker }, artifact: observation }) as { code: number; timedOut: boolean }; assert.notEqual(overflow.code, 0); assert.equal(overflow.timedOut, false);
    await new Promise(resolve => setTimeout(resolve, 500)); await assert.rejects(readFile(overflowMarker), "output overflow must kill descendants before they can mutate state");
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
    const body = "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '0.9.32\\n'; exit 0; fi\nmkdir -p \"$GRAPHIFY_OUT\"\nprintf graph > \"$GRAPHIFY_OUT/index\"\n";
    await writeFile(tool, body); await chmod(tool, 0o755); const canonicalTool = await realpath(tool);
    const profile = base({ enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, artifactSha256: digest(body), executablePath: canonicalTool, cacheRoot: await realpath(cache) }); const service = createGraphLaneService(home, "/usr/bin/git");
    const refreshed = await service.refresh(profile, repo); assert.equal(refreshed.decision.state, "fresh", refreshed.decision.reason); const external = profile.graph?.enabled && profile.graph.adapter === "graphify" ? profile.graph.cacheRoot : cache; assert.ok(refreshed.descriptor?.cacheRoot.startsWith(`${external}/`)); assert.equal(refreshed.descriptor?.worktreeRoot.startsWith(external), false);
    const source = await snapshotGraphSource(createGitGraphSourceReader("/usr/bin/git"), repo); const descriptorFile = graphDescriptorPath(home, "graphify", source.worktreeInstanceId); const before = await readFile(descriptorFile, "utf8"); const status = await service.status(profile, repo); assert.equal(status.decision.state, "fresh"); assert.equal(await readFile(descriptorFile, "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production Graphify audit removes known and arbitrary nested invocation leaks even when the child fails", async () => {
  const fixture = await graphifyFixture("shipyard-graphify-leak-", "mkdir -p graphify-out\nprintf leak > graphify-out/index\nmkdir -p src/deep/arbitrary\nprintf leak > src/deep/arbitrary/artifact\nexit 7");
  try { assert.equal(fixture.result.decision.state, "failed"); await assert.rejects(access(join(fixture.repo, "graphify-out"))); await assert.rejects(access(join(fixture.repo, "src", "deep"))); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("production Graphify audit preserves a pre-existing same-path tree while removing only its new child", async () => {
  const fixture = await graphifyFixture("shipyard-graphify-existing-", "mkdir -p graphify-out\nprintf leak > graphify-out/index", async repo => { await mkdir(join(repo, "graphify-out")); await writeFile(join(repo, "graphify-out", "user-record"), "user\n"); });
  try { assert.equal(fixture.result.decision.state, "failed"); assert.equal(await readFile(join(fixture.repo, "graphify-out", "user-record"), "utf8"), "user\n"); await assert.rejects(access(join(fixture.repo, "graphify-out", "index"))); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("production Graphify audit blocks without deleting a pre-existing file whose modification is ambiguous", async () => {
  const fixture = await graphifyFixture("shipyard-graphify-ambiguous-", "mkdir -p graphify-out\nprintf leak > graphify-out/index", async repo => { await mkdir(join(repo, "graphify-out")); await writeFile(join(repo, "graphify-out", "index"), "user\n"); }); const path = join(fixture.repo, "graphify-out", "index");
  try { assert.equal(fixture.result.decision.state, "failed"); assert.match(fixture.result.decision.reason, /ambiguous/i); await access(path); assert.equal(await readFile(path, "utf8"), "leak"); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("production Graphify audit fails closed and preserves an invocation leak when cleanup cannot be proven", async () => {
  const fixture = await graphifyFixture("shipyard-graphify-cleanup-", "mkdir -p cleanup-blocked\nprintf leak > cleanup-blocked/artifact\nchmod 0555 cleanup-blocked"); const blocked = join(fixture.repo, "cleanup-blocked");
  try { assert.equal(fixture.result.decision.state, "failed"); await access(join(blocked, "artifact")); }
  finally { try { await chmod(blocked, 0o755); } catch {} await rm(fixture.root, { recursive: true, force: true }); }
});

test("production CodeGraph files establish exclusion and detect tracked cache state", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-codegraph-"));
  try {
    execFileSync("/usr/bin/git", ["init", root]); const files = createNodeGraphFiles("/usr/bin/git"); await files.addMachineLocalExclude(root, ".codegraph/"); assert.equal(await files.excluded(root, ".codegraph/"), true); assert.equal(await files.tracked(join(root, ".codegraph")), false);
    await mkdir(join(root, ".codegraph")); await writeFile(join(root, ".codegraph", "tracked"), "x"); execFileSync("/usr/bin/git", ["-C", root, "add", "-f", ".codegraph/tracked"]); assert.equal(await files.tracked(join(root, ".codegraph")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production cache provenance rejects symlinks instead of attesting mutable external targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-content-digest-")); const cache = join(root, "cache"), external = join(root, "external");
  try { await mkdir(cache); await writeFile(external, "outside\n"); await symlink(external, join(cache, "link")); await assert.rejects(createNodeGraphFiles("/usr/bin/git").contentDigest(cache)); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("production CodeGraph lane runs observed FTS5/index children with telemetry disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-codegraph-lane-")); const repo = join(root, "repo"), node = join(root, "node"), codegraph = join(root, "codegraph"), home = join(root, "home");
  try {
    execFileSync("/usr/bin/git", ["init", "-b", "main", repo]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.email", "fixture@example.test"]); execFileSync("/usr/bin/git", ["-C", repo, "config", "user.name", "Fixture"]); await writeFile(join(repo, "a"), "a\n"); execFileSync("/usr/bin/git", ["-C", repo, "add", "a"]); execFileSync("/usr/bin/git", ["-C", repo, "commit", "-m", "base"]);
    const nodeBody = "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '24.13.1\\n'; fi\n", codegraphBody = "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '1.5.0\\n'; exit 0; fi\n[ \"$CODEGRAPH_TELEMETRY\" = 0 ] || exit 9\nmkdir -p .codegraph\nprintf db > .codegraph/codegraph.db\n";
    await writeFile(node, nodeBody); await writeFile(codegraph, codegraphBody); await chmod(node, 0o755); await chmod(codegraph, 0o755); const canonicalNode = await realpath(node), canonicalCodeGraph = await realpath(codegraph);
    const profile = base({ enabled: true, localOnlyApproved: true, adapter: "codegraph", reviewedToolSource: CODEGRAPH_RECEIPT, artifactSha256: digest(codegraphBody), executablePath: canonicalCodeGraph, nodeArtifactSha256: digest(nodeBody), nodeExecutablePath: canonicalNode }); const result = await createGraphLaneService(home, "/usr/bin/git").refresh(profile, repo); assert.equal(result.decision.state, "fresh", result.decision.reason); assert.equal(result.descriptor?.cacheRoot, join(await realpath(repo), ".codegraph"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
