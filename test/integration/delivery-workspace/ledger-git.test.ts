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
    assert.equal(GitLedgerStore.excludesRefspec("refs/heads/*:refs/heads/archive/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("refs/*:refs/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("+refs/heads/main:refs/heads/*"), false);
    assert.equal(GitLedgerStore.excludesRefspec("*:*"), false);
  } finally { await rm(path, { recursive: true, force: true }); }
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
      productBranch: "main", productSha: await git(path, ["rev-parse", "HEAD"]), ledgerRef: GitLedgerStore.ref, ledgerSha: first,
    });
    const loaded = await new ContextReader({ currentProductSha: async () => git(path, ["rev-parse", "HEAD"]) }, ledger).load(envelope);
    assert.equal(loaded.records["deliveries/d-1/contract.md"], "first");
    await assert.rejects(ledger.read("a".repeat(40), ["deliveries/d-1/contract.md"]), (error: unknown) => error instanceof LedgerError && error.code === "ledger-unavailable");
  } finally { await rm(path, { recursive: true, force: true }); }
});
