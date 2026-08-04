import assert from "node:assert/strict";
import test from "node:test";
import type { Profile } from "../../src/contracts/types.js";
import { profileFingerprint } from "../../src/profile/fingerprint.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import { PromotionLedger } from "../../src/promotion/manifest.js";
import { createTrustedSingleRepositoryCertificationOperation } from "../../src/single-repository/certify.js";
import { dossierDigest } from "../../src/single-repository/dossier.js";
import { SingleRepositoryLedger } from "../../src/single-repository/ledger.js";
import type { SingleRepositoryPullRequest } from "../../src/single-repository/types.js";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

const sha = (letter: string) => letter.repeat(40),
  digest = (letter: string) => letter.repeat(64);
let inventoryLedgerSha = sha("f");
const repository = {
    owner: "acme",
    name: "product",
    remote: { name: "origin", url: "https://github.com/acme/product.git" },
    defaultBranch: "main",
  },
  topology = { kind: "single-repository" as const, repository };
class MemoryLedger {
  head: string | undefined;
  records: Record<string, string> = {};
  counter = 1;
  async snapshot(paths: readonly string[]) {
    return {
      head: this.head,
      records: Object.fromEntries(
        paths
          .filter((path) => this.records[path] !== undefined)
          .map((path) => [path, this.records[path]!]),
      ),
    };
  }
  async transact(transaction: {
    expectedHead?: string;
    writes: readonly {
      path: string;
      contents: string;
      expectedContents?: string;
    }[];
  }) {
    assert.equal(transaction.expectedHead, this.head);
    for (const write of transaction.writes) {
      if (write.expectedContents !== undefined)
        assert.equal(this.records[write.path], write.expectedContents);
      this.records[write.path] = write.contents;
    }
    this.head = String(this.counter++).padStart(40, "0");
    return this.head;
  }
}
function acceptance(head: string, eligible = true, revision = "") {
  return Object.freeze({
    schemaVersion: 1 as const,
    issueId: "SHIP-8",
    deliveryId: "delivery",
    actorLogin: "actor",
    productSha: head,
    ledgerSha: inventoryLedgerSha,
    manifestDigest: digest("1"),
    acceptanceDigest: digest("2"),
    reviewId: `review-${head[0]}${revision}`,
    reviewRequestDigest: digest("3"),
    reviewResultDigest: digest(`${head[0]}${revision}`[0]!),
    reviewedLedgerSha: sha("e"),
    reviewerBundleDigest: revision ? digest("8") : digest("4"),
    evaluatedAt: "2026-08-04T00:00:00.000Z",
    decision: Object.freeze({
      promotionEligible: eligible,
      acceptanceFresh: eligible,
      reviewFresh: eligible,
      blockingFindingIds: Object.freeze([] as string[]),
      staleRecordIds: Object.freeze([] as string[]),
      blockers: Object.freeze(eligible ? ([] as string[]) : ["stale"]),
      nextAction: eligible
        ? ("proceed-to-promotion-gate" as const)
        : ("renew-acceptance-and-review" as const),
    }),
  });
}
function initialPull(headSha: string): SingleRepositoryPullRequest {
  return Object.freeze({
    id: "PR_one",
    number: 8,
    url: "https://github.com/acme/product/pull/8",
    deliveryMarker: stableShipyardMarker("delivery"),
    repository: { owner: "acme", name: "product" },
    headRepository: { owner: "acme", name: "product" },
    baseRepository: { owner: "acme", name: "product" },
    headRef: "shipyard/delivery",
    baseRef: "main",
    headSha,
    baseSha: sha("9"),
    state: "open",
    draft: true,
    isCrossRepository: false,
  });
}

test("certifies only the existing exact-head PR and resumes dossier/ready response loss without duplicate writes", async () => {
  inventoryLedgerSha = sha("f");
  const profile: Profile = {
      schemaVersion: 1,
      name: "single",
      actor: { login: "actor" },
      topology,
      allowedOperations: ["promote"],
      pathPolicy: {
        schemaVersion: 1,
        rules: [{ owner: "product", pattern: "src/**" }],
      },
    },
    fingerprint = profileFingerprint(profile),
    authority = {
      profileName: "single",
      commonDirectory: "/repo/.git",
      profileFingerprint: fingerprint,
      actorLogin: "actor",
      topology,
    },
    store = new MemoryLedger(),
    ledger = new SingleRepositoryLedger(store),
    journal = new PromotionLedger(store),
    fs = new MemoryFilesystem();
  const transact = store.transact.bind(store);
  store.transact = async (transaction) => {
    const next = await transact(transaction);
    inventoryLedgerSha = next;
    return next;
  };
  let head = sha("a"),
    receiptRevision = "",
    pull = initialPull(head),
    eligible = true,
    dossierWrites = 0,
    readyWrites = 0,
    failDossier = true,
    failReady = true,
    providerOpens = 0;
  const issue = {
    id: "I_one",
    number: 7,
    url: "https://github.com/acme/product/issues/7",
    deliveryMarker: stableShipyardMarker("delivery"),
    state: "open" as const,
  };
  const provider = {
    open: async () => {
      providerOpens++;
      return {
        observeExistingPullRequest: async () => pull,
        updateReviewDossier: async ({ dossier }: { dossier: string }) => {
          const desired = dossierDigest(dossier);
          if (pull.dossierDigest !== desired) {
            dossierWrites++;
            pull = { ...pull, dossierDigest: desired };
            if (failDossier) {
              failDossier = false;
              throw new Error("dossier response lost");
            }
          }
          return pull;
        },
        markReady: async ({
          dossierDigest: desired,
        }: {
          dossierDigest: string;
        }) => {
          assert.equal(pull.dossierDigest, desired);
          if (pull.draft) {
            readyWrites++;
            pull = { ...pull, draft: false };
            if (failReady) {
              failReady = false;
              throw new Error("ready response lost");
            }
          }
          return pull;
        },
        observeTrackedIssue: async () => issue,
        closeTrackedIssue: async () => {
          throw new Error("not finalizing");
        },
      };
    },
  };
  const operation = createTrustedSingleRepositoryCertificationOperation({
    repositoryPath: "/repo",
    authority: { resolve: async () => authority },
    profiles: { read: async () => profile },
    deliveries: {
      resolve: async () => ({
        binding: {
          schemaVersion: 1,
          profileName: "single",
          commonDirectory: "/repo/.git",
          topology,
          profileFingerprint: fingerprint,
          boundAt: "2026-08-04T00:00:00.000Z",
        },
        workspace: {
          schemaVersion: 1,
          state: "ready",
          creationToken: "11111111-1111-4111-8111-111111111111",
          deliveryId: "delivery",
          commonDirectory: "/repo/.git",
          branch: "shipyard/delivery",
          worktreePath: "/repo-delivery",
        },
      }),
    },
    evidence: {
      evaluate: async () =>
        acceptance(head, eligible, receiptRevision).decision,
      evaluateReceipt: async () => acceptance(head, eligible, receiptRevision),
    },
    product: {
      observe: async ({ expectedHeadSha, expectedBaseSha }) => ({
        objectFormat: "sha1",
        branch: "shipyard/delivery",
        headSha: expectedHeadSha,
        headTreeSha: sha(head === sha("a") ? "b" : "c"),
        baseSha: expectedBaseSha,
        touchedPaths: ["src/app.ts"],
        entries: [{ path: "src/app.ts", mode: "100644", objectId: head }],
      }),
    },
    provider,
    ledger,
    journal,
    locks: new MutationLockService(fs, new FakeProcess()),
    lockPath: () => "/single-certify.lock",
    now: () => new Date("2026-08-04T00:00:00.000Z"),
  });
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /dossier response lost/,
  );
  assert.equal((await ledger.read("delivery")).manifest!.phase, "certifying");
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /ready response lost/,
  );
  const result = await operation.certifyExistingPr({ deliveryId: "delivery" });
  assert.equal(result.phase, "awaiting-human-merge");
  assert.equal(result.pullRequest.number, 8);
  assert.equal(result.pullRequest.draft, false);
  assert.equal(dossierWrites, 1);
  assert.equal(readyWrites, 1);
  const resumed = await operation.certifyExistingPr({ deliveryId: "delivery" });
  assert.equal(resumed.headSha, head);
  assert.equal(dossierWrites, 1);
  assert.equal(readyWrites, 1);
  assert.ok(!("createPullRequest" in provider));
  assert.ok(!("mergePullRequest" in provider));
  receiptRevision = "renewed";
  pull = { ...pull, draft: false, dossierDigest: undefined };
  const sameHeadRenewed = await operation.certifyExistingPr({ deliveryId: "delivery" });
  assert.equal(sameHeadRenewed.headSha, head);
  assert.equal((await ledger.read("delivery")).manifest!.certifications.length, 2);
  head = sha("d");
  pull = { ...pull, headSha: head, draft: false, dossierDigest: undefined };
  const renewed = await operation.certifyExistingPr({ deliveryId: "delivery" });
  assert.equal(renewed.headSha, head);
  assert.equal((await ledger.read("delivery")).manifest!.certifications.length, 3);
  assert.equal(dossierWrites, 3);
  const exact = pull,
    writes = dossierWrites;
  pull = { ...exact, baseRef: "other" };
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /retargeted|wrong exact head/i,
  );
  pull = { ...exact, headSha: sha("5") };
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /wrong exact head/i,
  );
  pull = { ...exact, headRepository: { owner: "other", name: "fork" } };
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /forked|wrong exact head/i,
  );
  pull = exact;
  assert.equal(dossierWrites, writes);
  eligible = false;
  pull = { ...pull, headSha: sha("5") };
  head = sha("5");
  const opens = providerOpens;
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /acceptance and independent review/i,
  );
  assert.equal(providerOpens, opens);
  let getterCalls = 0;
  const getter = {
      get deliveryId() {
        getterCalls++;
        return "delivery";
      },
    },
    inherited = Object.create({ deliveryId: "delivery" }),
    hidden = Object.defineProperty({ deliveryId: "delivery" }, "extra", {
      value: true,
    }),
    symbol = Object.assign(
      { deliveryId: "delivery" },
      { [Symbol("extra")]: true },
    ),
    proxy = new Proxy(
      { deliveryId: "delivery" },
      {
        ownKeys() {
          throw new Error("descriptor trap");
        },
      },
    );
  for (const invalid of [getter, inherited, hidden, symbol, proxy])
    await assert.rejects(
      operation.certifyExistingPr(invalid as { deliveryId: string }),
    );
  assert.equal(getterCalls, 0);
});

test("stale topology, wrong head, fork state, and prohibited/unclassified paths block before provider mutation", async () => {
  const profile: Profile = {
      schemaVersion: 1,
      name: "single",
      actor: { login: "actor" },
      topology,
      allowedOperations: ["promote"],
      pathPolicy: {
        schemaVersion: 1,
        rules: [{ owner: "product", pattern: ".ccpm/**" }],
      },
    },
    fingerprint = profileFingerprint(profile),
    authority = {
      profileName: "single",
      commonDirectory: "/repo/.git",
      profileFingerprint: fingerprint,
      actorLogin: "actor",
      topology,
    },
    store = new MemoryLedger();
  let opens = 0,
    writes = 0;
  const operation = createTrustedSingleRepositoryCertificationOperation({
    repositoryPath: "/repo",
    authority: { resolve: async () => authority },
    profiles: { read: async () => profile },
    deliveries: {
      resolve: async () => ({
        binding: {
          schemaVersion: 1,
          profileName: "single",
          commonDirectory: "/repo/.git",
          topology,
          profileFingerprint: fingerprint,
          boundAt: "2026-08-04T00:00:00.000Z",
        },
        workspace: {
          schemaVersion: 1,
          state: "ready",
          creationToken: "11111111-1111-4111-8111-111111111111",
          deliveryId: "delivery",
          commonDirectory: "/repo/.git",
          branch: "shipyard/delivery",
          worktreePath: "/repo-delivery",
        },
      }),
    },
    evidence: {
      evaluate: async () => acceptance(sha("a")).decision,
      evaluateReceipt: async () => acceptance(sha("a")),
    },
    product: {
      observe: async ({ expectedBaseSha }) => ({
        objectFormat: "sha1",
        branch: "shipyard/delivery",
        headSha: sha("a"),
        headTreeSha: sha("b"),
        baseSha: expectedBaseSha,
        touchedPaths: [".ccpm/intent.md"],
        entries: [
          { path: ".ccpm/intent.md", mode: "100644", objectId: sha("c") },
        ],
      }),
    },
    provider: {
      open: async () => {
        opens++;
        return {
          observeExistingPullRequest: async () => initialPull(sha("a")),
          observeTrackedIssue: async () => undefined,
          updateReviewDossier: async () => {
            writes++;
            throw new Error("must not write");
          },
          markReady: async () => {
            writes++;
            throw new Error("must not write");
          },
          closeTrackedIssue: async () => {
            writes++;
            throw new Error("must not write");
          },
        };
      },
    },
    ledger: new SingleRepositoryLedger(store),
    journal: new PromotionLedger(store),
    locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()),
    lockPath: () => "/single-certify-unsafe.lock",
  });
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /prohibited|cannot be certified/i,
  );
  assert.equal(opens, 1);
  assert.equal(writes, 0);
  assert.equal(store.head, undefined);
});

test("P7: a binding flip immediately after the final provider check cannot create the initial certification manifest", async () => {
  const profile: Profile = {
      schemaVersion: 1,
      name: "single",
      actor: { login: "actor" },
      topology,
      allowedOperations: ["promote"],
      pathPolicy: {
        schemaVersion: 1,
        rules: [{ owner: "product", pattern: "src/**" }],
      },
    },
    fingerprint = profileFingerprint(profile),
    stable = {
      profileName: "single",
      commonDirectory: "/repo/.git",
      profileFingerprint: fingerprint,
      actorLogin: "actor",
      topology,
    },
    store = new MemoryLedger(),
    ledger = new SingleRepositoryLedger(store),
    journal = new PromotionLedger(store);
  let authority = stable,
    observations = 0;
  const operation = createTrustedSingleRepositoryCertificationOperation({
    repositoryPath: "/repo",
    authority: { resolve: async () => authority },
    profiles: { read: async () => profile },
    deliveries: {
      resolve: async () => ({
        binding: {
          schemaVersion: 1,
          profileName: "single",
          commonDirectory: "/repo/.git",
          topology,
          profileFingerprint: fingerprint,
          boundAt: "2026-08-04T00:00:00.000Z",
        },
        workspace: {
          schemaVersion: 1,
          state: "ready",
          creationToken: "11111111-1111-4111-8111-111111111111",
          deliveryId: "delivery",
          commonDirectory: "/repo/.git",
          branch: "shipyard/delivery",
          worktreePath: "/repo-delivery",
        },
      }),
    },
    evidence: {
      evaluate: async () => acceptance(sha("a")).decision,
      evaluateReceipt: async () => acceptance(sha("a")),
    },
    product: {
      observe: async ({ expectedBaseSha }) => ({
        objectFormat: "sha1" as const,
        branch: "shipyard/delivery",
        headSha: sha("a"),
        headTreeSha: sha("b"),
        baseSha: expectedBaseSha,
        touchedPaths: ["src/app.ts"],
        entries: [
          { path: "src/app.ts", mode: "100644" as const, objectId: sha("a") },
        ],
      }),
    },
    provider: {
      open: async () => ({
        observeExistingPullRequest: async () => {
          if (++observations === 2)
            authority = {
              ...stable,
              profileFingerprint: sha("0").replace(/0/g, "0").padEnd(64, "0"),
            };
          return initialPull(sha("a"));
        },
        observeTrackedIssue: async () => undefined,
        updateReviewDossier: async () => {
          throw new Error("must not write provider");
        },
        markReady: async () => {
          throw new Error("must not write provider");
        },
        closeTrackedIssue: async () => {
          throw new Error("not finalizing");
        },
      }),
    },
    ledger,
    journal,
    locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()),
    lockPath: () => "/p7-certify.lock",
  });
  await assert.rejects(
    operation.certifyExistingPr({ deliveryId: "delivery" }),
    /binding, delivery, profile, actor, or single-repository topology changed/i,
  );
  assert.equal(store.head, undefined);
  assert.equal((await ledger.read("delivery")).manifest, undefined);
});
