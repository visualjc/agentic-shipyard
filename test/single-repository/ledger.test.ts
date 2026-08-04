import assert from "node:assert/strict";
import test from "node:test";
import { stableShipyardMarker } from "../../src/github/markers.js";
import type { LedgerStore, LedgerTransaction } from "../../src/ledger/types.js";
import { SingleRepositoryLedger } from "../../src/single-repository/ledger.js";
import { PromotionLedger, promotionJournalPath } from "../../src/promotion/manifest.js";
import { promotionJournalContents } from "../../src/promotion/schema.js";
import { validatePromotionJournal } from "../../src/promotion/schema.js";
import type { SingleRepositoryFinalizationIntent, SingleRepositoryFinalizationReceipt, SingleRepositoryManifest } from "../../src/single-repository/types.js";

const sha = (letter: string) => letter.repeat(40);
const digest = (letter: string) => letter.repeat(64);
const repository = { owner: "acme", name: "product", remote: { name: "origin", url: "https://github.com/acme/product.git" }, defaultBranch: "main" };
const evidence = { productSha: sha("a"), ledgerSha: sha("1"), manifestDigest: digest("1"), acceptanceDigest: digest("2"), reviewId: "review", reviewRequestDigest: digest("3"), reviewResultDigest: digest("4"), reviewedLedgerSha: sha("2"), reviewerBundleDigest: digest("5"), evaluatedAt: "2026-08-04T00:00:00.000Z" };
const manifest: SingleRepositoryManifest = { schemaVersion: 1, topology: "single-repository", deliveryId: "delivery", actorLogin: "actor", repository, branch: "shipyard/delivery", workspace: { creationToken: "11111111-1111-4111-8111-111111111111", commonDirectory: "/repo/.git", worktreePath: "/repo-delivery" }, pullRequest: { id: "PR_one", number: 8, url: "https://github.com/acme/product/pull/8", deliveryMarker: stableShipyardMarker("delivery"), repository: { owner: "acme", name: "product" }, headRepository: { owner: "acme", name: "product" }, baseRepository: { owner: "acme", name: "product" }, headRef: "shipyard/delivery", baseRef: "main", headSha: sha("a"), baseSha: sha("b"), state: "open", draft: false, isCrossRepository: false, dossierDigest: digest("6") }, certifications: [{ revision: 1, headSha: sha("a"), headTreeSha: sha("c"), baseSha: sha("b"), policyDigest: digest("7"), dossierDigest: digest("6"), evidence, certifiedAt: "2026-08-04T00:00:00.000Z" }], phase: "awaiting-human-merge" };
const intent: SingleRepositoryFinalizationIntent = { schemaVersion: 1, deliveryId: "delivery", manifestDigest: digest("8"), actorLogin: "actor", mergePolicy: "squash", finalHeadSha: sha("a"), finalHeadTreeSha: sha("c"), mergeCommitSha: sha("d"), mainSha: sha("e"), localMainBeforeSha: sha("b"), reviewedTag: "shipyard/reviewed/delivery", createdAt: "2026-08-04T00:00:00.000Z" };
const receipt: SingleRepositoryFinalizationReceipt = { schemaVersion: 1, deliveryId: "delivery", manifestDigest: digest("8"), finalHeadSha: sha("a"), mainSha: sha("e"), mergeCommitSha: sha("d"), reviewedTag: "shipyard/reviewed/delivery", pullRequestState: "merged", trackedIssueState: "not-owned", deliveryBranchDeleted: true, completedAt: "2026-08-04T00:00:00.000Z" };

class StrictMemoryStore implements LedgerStore {
  head: string | undefined;
  records: Record<string, string> = {};
  responseLoss = false;
  corruptPostWrite = false;
  private ordinal = 0;

  async snapshot(paths: readonly string[]) { return { head: this.head, records: Object.fromEntries(paths.filter((path) => this.records[path] !== undefined).map((path) => [path, this.records[path]!])) }; }

  async transact(transaction: LedgerTransaction) {
    if (transaction.expectedHead !== this.head) throw new Error("stale head");
    for (const write of transaction.writes) {
      if (write.expectedContents !== undefined && this.records[write.path] !== write.expectedContents) throw new Error("stale contents");
      this.records[write.path] = write.contents;
    }
    this.head = String(++this.ordinal).padStart(40, "0");
    if (this.corruptPostWrite) this.records[transaction.writes[0]!.path] = "corrupt";
    if (this.responseLoss) { this.responseLoss = false; throw new Error("response lost"); }
    return this.head;
  }
}

test("single-repository ledger uses CAS, verifies writes, resumes response loss, and keeps final records immutable", async () => {
  const store = new StrictMemoryStore(), ledger = new SingleRepositoryLedger(store);
  const empty = await ledger.read("delivery");
  await ledger.writeManifest(empty, manifest);
  const afterManifest = await ledger.read("delivery");
  assert.equal(afterManifest.manifest?.pullRequest.id, "PR_one");
  assert.equal(await ledger.writeManifest(afterManifest, manifest), afterManifest.head);

  store.responseLoss = true;
  await assert.rejects(ledger.writeIntent(afterManifest, intent), /CAS failed/i);
  const afterLostResponse = await ledger.read("delivery");
  assert.deepEqual(afterLostResponse.intent, intent);
  assert.equal(await ledger.writeIntent(afterLostResponse, intent), afterLostResponse.head);
  await assert.rejects(ledger.writeIntent(afterLostResponse, { ...intent, mainSha: sha("9") }), /different immutable/i);

  await ledger.writeReceipt(afterLostResponse, receipt);
  const complete = await ledger.read("delivery");
  await assert.rejects(ledger.writeReceipt(complete, { ...receipt, trackedIssueState: "closed" }), /different immutable/i);
  await assert.rejects(ledger.writeManifest(afterManifest, { ...manifest, actorLogin: "other" }), /CAS failed/i);
});

test("single-repository ledger rejects non-canonical state and a corrupt post-write reread", async () => {
  const malformed = new StrictMemoryStore(); malformed.head = sha("1"); malformed.records["deliveries/delivery/promotion/single-repository-manifest.json"] = JSON.stringify(manifest);
  await assert.rejects(new SingleRepositoryLedger(malformed).read("delivery"), /malformed or non-canonical/i);
  const corrupt = new StrictMemoryStore(); corrupt.corruptPostWrite = true;
  await assert.rejects(new SingleRepositoryLedger(corrupt).writeManifest(await new SingleRepositoryLedger(corrupt).read("delivery"), manifest), /CAS failed/i);
});

test("ledger record paths are immutable delivery authority", async () => {
  for (const sourcePath of [
    "deliveries/delivery/promotion/single-repository-manifest.json",
    "deliveries/delivery/finalization/single-repository-intent.json",
    "deliveries/delivery/finalization/single-repository-receipt.json",
  ]) {
    const store = new StrictMemoryStore(), ledger = new SingleRepositoryLedger(store);
    await ledger.writeManifest(await ledger.read("delivery"), manifest);
    await ledger.writeIntent(await ledger.read("delivery"), intent);
    await ledger.writeReceipt(await ledger.read("delivery"), receipt);
    const targetPath = sourcePath.replace("deliveries/delivery/", "deliveries/other/");
    store.records[targetPath] = store.records[sourcePath]!;
    await assert.rejects(ledger.read("other"), /malformed or non-canonical/i, sourcePath);
  }
  const store = new StrictMemoryStore(), journal = new PromotionLedger(store);
  store.records[promotionJournalPath("other")] = promotionJournalContents(validatePromotionJournal({ schemaVersion: 1, deliveryId: "delivery", entries: [] }));
  await assert.rejects(journal.read("other"), /malformed or non-canonical/i);
});
