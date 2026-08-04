import assert from "node:assert/strict";
import test from "node:test";
import type { Profile } from "../../src/contracts/types.js";
import { singleRepositoryPolicyDigest } from "../../src/single-repository/policy.js";
import { validateSingleRepositoryFinalizationIntent, validateSingleRepositoryFinalizationReceipt, validateSingleRepositoryManifest } from "../../src/single-repository/schema.js";
import { stableShipyardMarker } from "../../src/github/markers.js";

const sha = (letter: string) => letter.repeat(40), digest = (letter: string) => letter.repeat(64), repository = { owner: "acme", name: "product", remote: { name: "origin", url: "https://github.com/acme/product.git" }, defaultBranch: "main" };
const evidence = { productSha: sha("a"), ledgerSha: sha("1"), manifestDigest: digest("1"), acceptanceDigest: digest("2"), reviewId: "review", reviewRequestDigest: digest("3"), reviewResultDigest: digest("4"), reviewedLedgerSha: sha("2"), reviewerBundleDigest: digest("5"), evaluatedAt: "2026-08-04T00:00:00.000Z" };
function manifest() { return { schemaVersion: 1, topology: "single-repository", deliveryId: "delivery", actorLogin: "actor", repository, branch: "shipyard/delivery", workspace: { creationToken: "11111111-1111-4111-8111-111111111111", commonDirectory: "/repo/.git", worktreePath: "/repo-delivery" }, pullRequest: { id: "PR_one", number: 8, url: "https://github.com/acme/product/pull/8", deliveryMarker: stableShipyardMarker("delivery"), repository: { owner: "acme", name: "product" }, headRepository: { owner: "acme", name: "product" }, baseRepository: { owner: "acme", name: "product" }, headRef: "shipyard/delivery", baseRef: "main", headSha: sha("a"), baseSha: sha("b"), state: "open", draft: false, isCrossRepository: false, dossierDigest: digest("6") }, certifications: [{ revision: 1, headSha: sha("a"), headTreeSha: sha("c"), baseSha: sha("b"), policyDigest: digest("7"), dossierDigest: digest("6"), evidence, certifiedAt: "2026-08-04T00:00:00.000Z" }], phase: "awaiting-human-merge" }; }

test("canonical single-repository records pin one exact PR/head/evidence history and strict finalization state", () => {
  const valid = validateSingleRepositoryManifest(manifest()); assert.equal(valid.pullRequest.number, 8); assert.ok(Object.isFrozen(valid)); assert.ok(Object.isFrozen(valid.certifications));
  for (const invalid of [
    { ...manifest(), extra: true },
    { ...manifest(), pullRequest: { ...manifest().pullRequest, headSha: sha("9") } },
    { ...manifest(), pullRequest: { ...manifest().pullRequest, headRepository: { owner: "other", name: "fork" } } },
    { ...manifest(), pullRequest: { ...manifest().pullRequest, draft: true } },
    { ...manifest(), certifications: [...manifest().certifications, manifest().certifications[0]] },
    { ...manifest(), pullRequest: { ...manifest().pullRequest, url: "https://github.com/acme/product/pull/8?spoof=1" } },
    { ...manifest(), pullRequest: { ...manifest().pullRequest, url: "https://github.com/acme/product/issues/8" } },
    { ...manifest(), workspace: { ...manifest().workspace, creationToken: "not-a-token" } },
    { ...manifest(), workspace: { ...manifest().workspace, worktreePath: "/repo/../replacement" } },
  ]) assert.throws(() => validateSingleRepositoryManifest(invalid), /canonical version 1/i);
  const renewed = manifest(); renewed.certifications.push({ ...renewed.certifications[0], revision: 2, evidence: { ...evidence, reviewId: "renewed", reviewResultDigest: digest("9") }, dossierDigest: digest("9") }); renewed.pullRequest = { ...renewed.pullRequest, dossierDigest: digest("9") }; assert.equal(validateSingleRepositoryManifest(renewed).certifications.length, 2);
  let getterCalls = 0; const hostile = { ...manifest(), get phase() { getterCalls++; return "awaiting-human-merge"; } }; assert.throws(() => validateSingleRepositoryManifest(hostile), /canonical version 1/i); assert.equal(getterCalls, 0);
  const intent = validateSingleRepositoryFinalizationIntent({ schemaVersion: 1, deliveryId: "delivery", manifestDigest: digest("8"), actorLogin: "actor", mergePolicy: "squash", finalHeadSha: sha("a"), finalHeadTreeSha: sha("c"), mergeCommitSha: sha("d"), mainSha: sha("e"), localMainBeforeSha: sha("b"), reviewedTag: "shipyard/reviewed/delivery", createdAt: "2026-08-04T00:00:00.000Z" }); assert.equal(intent.mergePolicy, "squash");
  const receipt = validateSingleRepositoryFinalizationReceipt({ schemaVersion: 1, deliveryId: "delivery", manifestDigest: digest("8"), finalHeadSha: sha("a"), mainSha: sha("e"), mergeCommitSha: sha("d"), reviewedTag: "shipyard/reviewed/delivery", pullRequestState: "merged", trackedIssueState: "not-owned", deliveryBranchDeleted: true, completedAt: "2026-08-04T00:00:00.000Z" }); assert.equal(receipt.deliveryBranchDeleted, true);
});

test("single-repository policy certifies only product cargo and rejects every shared metadata root and non-product owner", () => {
  const owners = ["development-record", "development-generated", "destination-only", "context-overlay", "scratch"] as const;
  const profile: Profile = { schemaVersion: 1, name: "single", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["promote"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }, { owner: "product", pattern: ".ccpm/**" }, { owner: "product", pattern: ".shipyard/**" }, { owner: "product", pattern: ".git/**" }, { owner: "product", pattern: ".graphs/**" }, { owner: "product", pattern: ".codex/**" }, { owner: "product", pattern: ".claude/**" }, { owner: "product", pattern: ".cursor/**" }, { owner: "product", pattern: "shipyard-ledger/**" }, ...owners.map((owner) => ({ owner, pattern: `owned/${owner}/**` }))] } }, base = { objectFormat: "sha1" as const, branch: "shipyard/delivery", headSha: sha("a"), headTreeSha: sha("b"), baseSha: sha("d"), touchedPaths: ["src/app.ts"] };
  assert.match(singleRepositoryPolicyDigest(profile, { ...base, entries: [{ path: "src/app.ts", mode: "100644", objectId: sha("c") }] }), /^[a-f0-9]{64}$/);
  for (const path of [".git/config", ".shipyard/state", ".graphs/index", ".ccpm/intent.md", ".codex/context/pin", ".claude/context/pin", ".cursor/context/pin", "shipyard-ledger/record"]) {
    assert.throws(() => singleRepositoryPolicyDigest(profile, { ...base, entries: [{ path, mode: "100644", objectId: sha("c") }] }), /prohibited metadata/i, path);
  }
  for (const owner of owners) assert.throws(() => singleRepositoryPolicyDigest(profile, { ...base, entries: [{ path: `owned/${owner}/record`, mode: "100644", objectId: sha("c") }] }), /non-product cargo/i, owner);
  assert.throws(() => singleRepositoryPolicyDigest(profile, { ...base, entries: [{ path: "unknown.txt", mode: "100644", objectId: sha("c") }] }), /No policy owner classifies/i);
  // The delta is independently constrained: deleted and renamed-away cargo is
  // still security-relevant even when absent from the resulting tree.
  for (const touchedPaths of [["src/z.ts", "src/a.ts"], ["src/a.ts", "src/a.ts"], ["../escape"]]) assert.throws(() => singleRepositoryPolicyDigest(profile, { ...base, touchedPaths, entries: [{ path: "src/app.ts", mode: "100644", objectId: sha("c") }] }), /tree or path ownership is invalid/i);
  assert.throws(() => singleRepositoryPolicyDigest(profile, { ...base, touchedPaths: [".ccpm/intent.md"], entries: [{ path: "src/app.ts", mode: "100644", objectId: sha("c") }] }), /prohibited metadata/i);
  assert.notEqual(singleRepositoryPolicyDigest(profile, { ...base, baseSha: sha("e"), entries: [{ path: "src/app.ts", mode: "100644", objectId: sha("c") }] }), singleRepositoryPolicyDigest(profile, { ...base, entries: [{ path: "src/app.ts", mode: "100644", objectId: sha("c") }] }));
});
