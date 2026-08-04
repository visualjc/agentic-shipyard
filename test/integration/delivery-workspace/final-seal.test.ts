import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { LedgerError } from "../../../src/ledger/errors.js";
import { finalSealPath, sealDelivery, verifyFinalLedgerSeal } from "../../../src/ledger/final-seal.js";

const exec = promisify(execFile);
async function git(repository: string, args: string[]): Promise<string> { return (await exec("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim(); }
async function repository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "shipyard-final-seal-"));
  await git(path, ["init", "-b", "main"]); await git(path, ["config", "user.name", "test"]); await git(path, ["config", "user.email", "test@example.test"]);
  await git(path, ["commit", "--allow-empty", "-m", "product"]); return path;
}

test("seals exact ledger records in one reachable child commit that adds only the external seal", async () => {
  const path = await repository();
  try {
    const store = new GitLedgerStore(path); const deliveryId = "delivery-001";
    const recordPaths = [`deliveries/${deliveryId}/acceptance.json`, `deliveries/${deliveryId}/review.json`];
    const preSealLedgerSha = await store.transact({ expectedHead: undefined, writes: [
      { path: recordPaths[0], contents: "acceptance\n" }, { path: recordPaths[1], contents: "review\n" },
    ] });
    const productSha = await git(path, ["rev-parse", "main"]);
    const sealCommitSha = await sealDelivery(store, { deliveryId, productSha, recordPaths: [...recordPaths].reverse() });
    const observedCommit = await store.inspectCommit(sealCommitSha);
    const observed = await store.read(sealCommitSha, [...recordPaths, finalSealPath(deliveryId)]);
    const sealContents = observed[finalSealPath(deliveryId)]!;
    const sealedRecords = Object.fromEntries(recordPaths.map((recordPath) => [recordPath, observed[recordPath]!]));

    assert.equal(observedCommit.parentSha, preSealLedgerSha);
    assert.deepEqual(observedCommit.changes, [{ status: "added", path: finalSealPath(deliveryId) }]);
    assert.equal(await git(path, ["merge-base", "--is-ancestor", sealCommitSha, GitLedgerStore.ref]).then(() => true, () => false), true);
    for (const recordPath of recordPaths) assert.equal(await git(path, ["rev-parse", `${preSealLedgerSha}:${recordPath}`]), await git(path, ["rev-parse", `${sealCommitSha}:${recordPath}`]));
    assert.equal(verifyFinalLedgerSeal({ objectFormat: await store.objectFormat(), externalSealCommitSha: sealCommitSha, observedCommit, currentProductSha: productSha, sealContents, records: sealedRecords }).preSealLedgerSha, preSealLedgerSha);

    await assert.rejects(sealDelivery(store, { deliveryId, productSha, recordPaths }), (error: unknown) => error instanceof LedgerError && error.code === "ledger-path-conflict");
  } finally { await rm(path, { recursive: true, force: true }); }
});

test("refuses missing, duplicate, unsafe, cross-delivery, and self-referential seal inputs", async () => {
  const path = await repository();
  try {
    const store = new GitLedgerStore(path); const deliveryId = "delivery-001"; const productSha = await git(path, ["rev-parse", "main"]);
    const recordPath = `deliveries/${deliveryId}/acceptance.json`;
    await store.transact({ expectedHead: undefined, writes: [{ path: recordPath, contents: "acceptance" }] });
    for (const recordPaths of [
      [recordPath, "deliveries/delivery-001/missing.json"],
      [recordPath, recordPath],
      ["../escape"],
      ["deliveries/other/acceptance.json"],
      [finalSealPath(deliveryId)],
    ]) await assert.rejects(sealDelivery(store, { deliveryId, productSha, recordPaths }), LedgerError);
  } finally { await rm(path, { recursive: true, force: true }); }
});
