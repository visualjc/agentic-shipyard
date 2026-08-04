import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { ContextReader } from "../../../src/context/reader.js";
import { createEnvelope } from "../../../src/context/envelope.js";
import { LedgerError } from "../../../src/ledger/errors.js";

const exec = promisify(execFile);
async function git(repository: string, args: string[]): Promise<string> { return (await exec("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim(); }
async function repository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "shipyard-ledger-test-"));
  await git(path, ["init", "-b", "main"]); await git(path, ["config", "user.name", "test"]); await git(path, ["config", "user.email", "test@example.test"]);
  await git(path, ["commit", "--allow-empty", "-m", "product"]); return path;
}

async function assertPoisoned(store: GitLedgerStore, path: string, poisonSha: string): Promise<void> {
  const rejected = (error: unknown): boolean => error instanceof LedgerError && error.code === "ledger-invalid-record";
  await assert.rejects(store.snapshot([]), rejected);
  assert.equal(await git(path, ["rev-parse", GitLedgerStore.ref]), poisonSha);
  await assert.rejects(store.transact({ expectedHead: poisonSha, writes: [{ path: "records/forbidden", contents: "forbidden" }] }), rejected);
  assert.equal(await git(path, ["rev-parse", GitLedgerStore.ref]), poisonSha);
  await assert.rejects(store.read(poisonSha, []), rejected);
  assert.equal(await git(path, ["rev-parse", GitLedgerStore.ref]), poisonSha);
  await assert.rejects(store.inspectCommit(poisonSha), rejected);
  assert.equal(await git(path, ["rev-parse", GitLedgerStore.ref]), poisonSha);
}

test("stores durable records on an orphan ledger ref outside product ancestry and excludes it from destinations", async () => {
  const path = await repository();
  try {
    const ledger = new GitLedgerStore(path);
    const first = await ledger.transact({ expectedHead: undefined, writes: [{ path: "deliveries/d-1.json", contents: "initial" }] });
    const second = await ledger.transact({ expectedHead: first, writes: [{ path: "deliveries/d-1.json", contents: "checkpoint", expectedContents: "initial" }] });
    assert.equal((await ledger.snapshot(["deliveries/d-1.json"])).records["deliveries/d-1.json"], "checkpoint");
    await assert.rejects(ledger.transact({ expectedHead: first, writes: [{ path: "other", contents: "x" }] }), (error: unknown) => error instanceof LedgerError && error.code === "ledger-stale-head");
    await assert.rejects(ledger.transact({ expectedHead: second, writes: [{ path: "deliveries/d-1.json", contents: "wrong", expectedContents: "initial" }] }), (error: unknown) => error instanceof LedgerError && error.code === "ledger-path-conflict");
    assert.equal(await git(path, ["merge-base", "--is-ancestor", first, "main"]).then(() => "yes", () => "no"), "no");
    assert.equal(await git(path, ["merge-base", "--is-ancestor", "main", first]).then(() => "yes", () => "no"), "no");
    assert.equal(GitLedgerStore.excludesRefspec("refs/heads/main:refs/heads/main"), true);
    assert.equal(GitLedgerStore.excludesRefspec("refs/heads/shipyard-ledger:refs/heads/shipyard-ledger"), false);
    assert.equal(GitLedgerStore.excludesRefspec("refs/shipyard/workspace-readiness/11111111-1111-4111-8111-111111111111:refs/heads/proof"), false);
    assert.equal(GitLedgerStore.excludesRefspec("refs/shipyard/workspace-ownership/11111111-1111-4111-8111-111111111111:refs/heads/proof"), false);
    assert.equal(GitLedgerStore.excludesRefspec("refs/shipyard/*:refs/archive/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("refs/heads/*:refs/heads/archive/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("refs/*:refs/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("+refs/heads/main:refs/heads/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("*:*"), false);
    assert.throws(() => GitLedgerStore.requireProductOnlyTransport(["refs/heads/main:refs/heads/main"], JSON.stringify({ ref: GitLedgerStore.ref })), LedgerError);
    assert.throws(() => GitLedgerStore.requireProductOnlyTransport(["refs/heads/shipyard-ledger:refs/heads/main"]), LedgerError);
    assert.throws(() => GitLedgerStore.requireProductOnlyTransport(["refs/heads/main:refs/heads/main"], JSON.stringify({ ref: "refs/shipyard/workspace-readiness/token" })), LedgerError);
    assert.doesNotThrow(() => GitLedgerStore.requireProductOnlyTransport(["refs/heads/main:refs/heads/main"], JSON.stringify({ ref: "refs/heads/main" })));
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("always writes the canonical ledger ref even when JavaScript callers pass a second constructor argument", async () => {
  const path = await repository();
  try {
    const productHead = await git(path, ["rev-parse", "main"]);
    const LedgerWithLegacySignature = GitLedgerStore as unknown as new (repositoryPath: string, ref: string) => GitLedgerStore;
    const ledger = new LedgerWithLegacySignature(path, "refs/heads/main");
    await ledger.transact({ expectedHead: undefined, writes: [{ path: "deliveries/d-1.json", contents: "initial" }] });
    assert.equal(await git(path, ["rev-parse", "main"]), productHead);
    assert.ok(await git(path, ["rev-parse", GitLedgerStore.ref]));
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("rejects a pre-existing ledger ref in or descended from product history without advancing or repairing it", async () => {
  for (const form of ["product-head", "product-descendant"] as const) {
    const path = await repository();
    try {
      const productSha = await git(path, ["rev-parse", "main"]);
      const poisonSha = form === "product-head"
        ? productSha
        : await git(path, ["commit-tree", await git(path, ["rev-parse", "main^{tree}"]), "-p", productSha, "-m", "poisoned ledger descendant"]);
      await git(path, ["update-ref", GitLedgerStore.ref, poisonSha]);
      await assertPoisoned(new GitLedgerStore(path), path, poisonSha);
    } finally { await rm(path, { recursive: true, force: true }); }
  }
});

test("rejects a pre-existing ledger ref that diverged from a shared product ancestor", async () => {
  const path = await repository();
  try {
    const sharedAncestor = await git(path, ["rev-parse", "main"]);
    const tree = await git(path, ["rev-parse", "main^{tree}"]);
    const productSha = await git(path, ["commit-tree", tree, "-p", sharedAncestor, "-m", "product descendant"]);
    const poisonSha = await git(path, ["commit-tree", tree, "-p", sharedAncestor, "-m", "divergent poisoned ledger"]);
    await git(path, ["update-ref", "refs/heads/main", productSha, sharedAncestor]);
    await git(path, ["update-ref", GitLedgerStore.ref, poisonSha]);
    await assertPoisoned(new GitLedgerStore(path), path, poisonSha);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("rechecks isolation against local, remote-tracking, and tag product refs on every operation", async () => {
  const path = await repository();
  try {
    const store = new GitLedgerStore(path);
    const ledgerSha = await store.transact({ expectedHead: undefined, writes: [{ path: "records/safe", contents: "safe" }] });
    assert.equal((await store.snapshot(["records/safe"])).records["records/safe"], "safe");
    for (const productRef of ["refs/heads/poison", "refs/remotes/origin/poison", "refs/tags/poison"]) {
      await git(path, ["update-ref", productRef, ledgerSha]);
      await assertPoisoned(store, path, ledgerSha);
      await git(path, ["update-ref", "-d", productRef]);
      assert.equal((await store.snapshot([])).head, ledgerSha);
    }
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("uses the repository object format for null-OID CAS and isolation", async (context) => {
  const path = await mkdtemp(join(tmpdir(), "shipyard-ledger-sha256-"));
  try {
    try { await git(path, ["init", "--object-format=sha256", "-b", "main"]); }
    catch { context.skip("local Git does not support SHA-256 repositories"); return; }
    await git(path, ["config", "user.name", "test"]); await git(path, ["config", "user.email", "test@example.test"]);
    await git(path, ["commit", "--allow-empty", "-m", "product"]);
    const store = new GitLedgerStore(path);
    const ledgerSha = await store.transact({ expectedHead: undefined, writes: [{ path: "records/sha256", contents: "safe" }] });
    assert.equal(ledgerSha.length, 64);
    assert.equal((await store.snapshot(["records/sha256"])).records["records/sha256"], "safe");
    const abbreviatedPin = ledgerSha.slice(0, 40);
    await assert.rejects(store.read(abbreviatedPin, ["records/sha256"]), (error: unknown) => error instanceof LedgerError && error.code === "ledger-invalid-path");
    await assert.rejects(store.inspectCommit(abbreviatedPin), (error: unknown) => error instanceof LedgerError && error.code === "ledger-invalid-path");
    const productSha = await git(path, ["rev-parse", "main"]);
    await git(path, ["update-ref", GitLedgerStore.ref, productSha, ledgerSha]);
    await assertPoisoned(store, path, productSha);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("preserves record bytes, atomically rejects a concurrent stale writer, and succeeds after reread", async () => {
  const path = await repository();
  try {
    const ledger = new GitLedgerStore(path);
    for (const contents of ["", "one\n", "many\n\n"]) {
      const before = await ledger.snapshot(["records/bytes"]);
      await ledger.transact({ expectedHead: before.head, writes: [{ path: "records/bytes", contents, ...(before.head ? { expectedContents: (await ledger.snapshot(["records/bytes"])).records["records/bytes"] } : {}) }] });
      assert.equal((await ledger.snapshot(["records/bytes"])).records["records/bytes"], contents);
    }
    const head = (await ledger.snapshot([])).head!;
    const [left, right] = await Promise.allSettled([
      ledger.transact({ expectedHead: head, writes: [{ path: "records/left", contents: "left" }] }),
      ledger.transact({ expectedHead: head, writes: [{ path: "records/right", contents: "right" }] }),
    ]);
    assert.equal([left, right].filter((result) => result.status === "fulfilled").length, 1);
    const loser = left.status === "rejected" ? left : right;
    assert.ok(loser.status === "rejected" && loser.reason instanceof LedgerError && loser.reason.code === "ledger-stale-head");
    const retry = await ledger.snapshot(["records/left", "records/right"]);
    const missing = retry.records["records/left"] === undefined ? "records/left" : "records/right";
    await ledger.transact({ expectedHead: retry.head, writes: [{ path: missing, contents: missing.endsWith("left") ? "left" : "right" }] });
    assert.deepEqual(await ledger.snapshot(["records/left", "records/right"]), { head: (await ledger.snapshot([])).head, records: { "records/left": "left", "records/right": "right" } });
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("ignores hostile inherited Git repository-control environment", async () => {
  const primary = await repository(); const redirected = await repository();
  const inherited = Object.fromEntries(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS"].map((key) => [key, process.env[key]]));
  try {
    process.env.GIT_DIR = join(redirected, ".git"); process.env.GIT_WORK_TREE = redirected; process.env.GIT_INDEX_FILE = join(redirected, "index");
    process.env.GIT_OBJECT_DIRECTORY = join(redirected, ".git", "objects"); process.env.GIT_CONFIG_GLOBAL = join(redirected, "config"); process.env.GIT_CONFIG_COUNT = "1"; process.env.GIT_CONFIG_KEY_0 = "core.bare"; process.env.GIT_CONFIG_VALUE_0 = "true";
    process.env.DEVELOPER_DIR = "/definitely-not-a-developer-directory"; process.env.SDKROOT = "/definitely-not-an-sdk"; process.env.TOOLCHAINS = "hostile-toolchain";
    const ledger = new GitLedgerStore(primary);
    await ledger.transact({ expectedHead: undefined, writes: [{ path: "records/safe", contents: "safe" }] });
    for (const key of Object.keys(inherited)) delete process.env[key];
    assert.ok(await git(primary, ["rev-parse", "refs/heads/shipyard-ledger"]));
    await assert.rejects(git(redirected, ["rev-parse", "refs/heads/shipyard-ledger"]));
  } finally {
    for (const [key, value] of Object.entries(inherited)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(primary, { recursive: true, force: true }); await rm(redirected, { recursive: true, force: true });
  }
});

test("reads exact pinned ledger commits for ContextReader and fails closed for unavailable Git objects", async () => {
  const path = await repository();
  try {
    const ledger = new GitLedgerStore(path);
    const first = await ledger.transact({ expectedHead: undefined, writes: [{ path: "deliveries/d-1/contract.md", contents: "first" }, { path: "deliveries/d-1/assigned-task.md", contents: "task" }] });
    await ledger.transact({ expectedHead: first, writes: [{ path: "deliveries/d-1/contract.md", contents: "second", expectedContents: "first" }] });
    assert.deepEqual(await ledger.read(first, ["deliveries/d-1/contract.md", "missing"]), { "deliveries/d-1/contract.md": "first" });
    await mkdir(join(path, "deliveries", "d-1"), { recursive: true });
    await writeFile(join(path, "deliveries", "d-1", "contract.md"), "product-controlled record");
    await git(path, ["add", "deliveries/d-1/contract.md"]);
    await git(path, ["commit", "-m", "product commit with ledger-like path"]);
    const productCommit = await git(path, ["rev-parse", "HEAD"]);
    await assert.rejects(ledger.read(productCommit, ["deliveries/d-1/contract.md"]),
      (error: unknown) => error instanceof LedgerError && error.code === "ledger-unavailable");
    const envelope = createEnvelope({
      host: "test", role: "implementer", envelopePath: ".shipyard/context.json", repoRoot: path, deliveryId: "d-1", profile: "test",
      topology: { kind: "single-repository", repository: { owner: "acme", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" } },
      repository: { owner: "acme", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" },
      productBranch: "main", objectFormat: "sha1", productSha: await git(path, ["rev-parse", "HEAD"]), ledgerRef: GitLedgerStore.ref, ledgerSha: first,
    });
    const loaded = await new ContextReader({
      profile: envelope.profile, profileFingerprint: "0".repeat(64), topology: envelope.topology, repository: envelope.repository,
      deliveryId: envelope.deliveryId, host: envelope.host, role: envelope.role,
      envelopePath: envelope.adapter.envelopePath, repoRoot: envelope.adapter.repoRoot, productBranch: envelope.productBranch,
      productSha: envelope.productSha, ledgerRef: envelope.ledgerRef, ledgerSha: envelope.ledgerSha, objectFormat: envelope.objectFormat,
    }, { resolve: async () => ({ profileName: envelope.profile, profileFingerprint: "0".repeat(64), commonDirectory: "/test/.git", actorLogin: "actor", topology: envelope.topology }) }, { currentProductSha: async () => git(path, ["rev-parse", "HEAD"]) }, ledger).load(envelope);
    assert.equal(loaded.records["deliveries/d-1/contract.md"], "first");
    await assert.rejects(ledger.read("a".repeat(40), ["deliveries/d-1/contract.md"]), (error: unknown) => error instanceof LedgerError && error.code === "ledger-unavailable");
  } finally { await rm(path, { recursive: true, force: true }); }
});
