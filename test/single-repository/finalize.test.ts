import assert from "node:assert/strict";
import test from "node:test";
import type { Profile } from "../../src/contracts/types.js";
import { profileFingerprint } from "../../src/profile/fingerprint.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import { PromotionLedger } from "../../src/promotion/manifest.js";
import {
  createTrustedSingleRepositoryFinalizationOperation,
  exactSingleRepositoryJournalTuple,
} from "../../src/single-repository/finalize.js";
import type {
  PromotionJournal,
  PromotionJournalStep,
} from "../../src/promotion/types.js";
import { SingleRepositoryLedger } from "../../src/single-repository/ledger.js";
import { singleRepositoryPolicyDigest } from "../../src/single-repository/policy.js";
import type {
  SingleRepositoryManifest,
  SingleRepositoryPullRequest,
  SingleRepositoryTrackedIssue,
} from "../../src/single-repository/types.js";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

const sha = (letter: string) => letter.repeat(40),
  digest = (letter: string) => letter.repeat(64),
  head = sha("a"),
  tree = sha("b"),
  base = sha("c"),
  merge = sha("d"),
  main = sha("e");
const repository = {
    owner: "acme",
    name: "product",
    remote: { name: "origin", url: "https://github.com/acme/product.git" },
    defaultBranch: "main",
  },
  topology = { kind: "single-repository" as const, repository },
  issue = {
    id: "I_one",
    number: 7,
    url: "https://github.com/acme/product/issues/7",
    deliveryMarker: stableShipyardMarker("delivery"),
    state: "open" as const,
  };
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
const evidence = {
  productSha: head,
  ledgerSha: sha("1"),
  manifestDigest: digest("1"),
  acceptanceDigest: digest("2"),
  reviewId: "review",
  reviewRequestDigest: digest("3"),
  reviewResultDigest: digest("4"),
  reviewedLedgerSha: sha("2"),
  reviewerBundleDigest: digest("5"),
  evaluatedAt: "2026-08-04T00:00:00.000Z",
};
let receiptTime = evidence.evaluatedAt,
  receiptAcceptanceDigest = evidence.acceptanceDigest;
function receipt(eligible = true) {
  return Object.freeze({
    schemaVersion: 1 as const,
    issueId: "SHIP-8",
    deliveryId: "delivery",
    actorLogin: "actor",
    ...evidence,
    evaluatedAt: receiptTime,
    acceptanceDigest: receiptAcceptanceDigest,
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
function pull(
  state: "open" | "closed" | "merged",
  mergeCommitSha?: string,
): SingleRepositoryPullRequest {
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
    headSha: head,
    baseSha: base,
    state,
    draft: false,
    isCrossRepository: false,
    dossierDigest: digest("6"),
    ...(mergeCommitSha ? { mergeCommitSha } : {}),
  });
}
const manifest: SingleRepositoryManifest = {
  schemaVersion: 1,
  topology: "single-repository",
  deliveryId: "delivery",
  actorLogin: "actor",
  repository,
  branch: "shipyard/delivery",
  workspace: {
    creationToken: "11111111-1111-4111-8111-111111111111",
    commonDirectory: "/repo/.git",
    worktreePath: "/repo-delivery",
  },
  pullRequest: pull("open"),
  trackedIssue: issue,
  certifications: [
    {
      revision: 1,
      headSha: head,
      headTreeSha: tree,
      baseSha: base,
      policyDigest: digest("7"),
      dossierDigest: digest("6"),
      evidence,
      certifiedAt: "2026-08-04T00:00:00.000Z",
    },
  ],
  phase: "awaiting-human-merge",
};

test("reduced recovery accepts only one exact deletion and final-receipt journal tuple", () => {
  const expected: readonly [PromotionJournalStep, string, string][] = [
    [
      "single-repository-branch-delete-started",
      `single-branch-delete-started:${head}`,
      head,
    ],
    ["single-repository-branch-deleted", `single-branch:${head}`, head],
    ["final-receipt-recorded", `single-final-receipt:${digest("a")}`, main],
  ];
  for (const [step, key, observedSha] of expected) {
    const entry = {
      step,
      idempotencyKey: key,
      observedSha,
      completedAt: "2026-08-04T00:00:00.000Z",
    };
    const journal = (entries: readonly unknown[]) =>
      ({
        schemaVersion: 1,
        deliveryId: "delivery",
        entries,
      }) as unknown as PromotionJournal;
    assert.equal(
      exactSingleRepositoryJournalTuple(
        journal([entry]),
        step,
        key,
        observedSha,
      ),
      true,
      `${step} exact`,
    );
    const variants: readonly [string, readonly unknown[]][] = [
      ["missing", []],
      ["duplicate", [entry, entry]],
      ["wrong-key", [{ ...entry, idempotencyKey: "wrong" }]],
      ["wrong-sha", [{ ...entry, observedSha: sha("9") }]],
      ["unexpected-provider", [{ ...entry, providerId: "PR_one" }]],
      ["same-key-conflicting", [entry, { ...entry, observedSha: sha("8") }]],
    ];
    for (const [name, entries] of variants)
      assert.equal(
        exactSingleRepositoryJournalTuple(
          journal(entries),
          step,
          key,
          observedSha,
        ),
        false,
        `${step} ${name}`,
      );
    assert.equal(exactSingleRepositoryJournalTuple(journal([entry, { ...entry, idempotencyKey: "historical", observedSha: sha("8") }]), step, key, observedSha), false, `${step} conflicting one-shot history`);
  }
});

test("inspectStatus projects expected blockers with no mutation calls", async () => {
  const profile: Profile = {
      schemaVersion: 1,
      name: "single",
      actor: { login: "actor" },
      topology,
      allowedOperations: ["finalize"],
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
    journal = new PromotionLedger(store);
  const observation = {
      objectFormat: "sha1" as const,
      branch: "shipyard/delivery",
      headSha: head,
      headTreeSha: tree,
      baseSha: base,
      touchedPaths: ["src/app.ts"],
      entries: [
        { path: "src/app.ts", mode: "100644" as const, objectId: sha("8") },
      ],
    },
    seeded = {
      ...manifest,
      certifications: [
        {
          ...manifest.certifications[0]!,
          policyDigest: singleRepositoryPolicyDigest(profile, observation),
        },
      ],
    };
  await ledger.writeManifest(await ledger.read("delivery"), seeded);
  let eligible = true,
    receiptDeliveryId = "delivery",
    receiptActorLogin = "actor",
    workspace = {
      schemaVersion: 1 as const,
      state: "ready" as const,
      creationToken: "11111111-1111-4111-8111-111111111111",
      deliveryId: "delivery",
      commonDirectory: "/repo/.git",
      branch: "shipyard/delivery",
      worktreePath: "/repo-delivery",
    },
    product = observation,
    current = pull("open"),
    deliveryMissing = false,
    deliveryResolverCalls = 0,
    mutations = 0,
    gitOpens = 0,
    recoveryOpens = 0,
    locks = 0;
  const operation = createTrustedSingleRepositoryFinalizationOperation({
    repositoryPath: "/repo",
    authority: { resolve: async () => authority },
    profiles: { read: async () => profile },
    deliveries: {
      resolve: async () => {
        deliveryResolverCalls++;
        if (deliveryMissing) throw new Error("delivery-not-found");
        return ({
        binding: {
          schemaVersion: 1,
          profileName: "single",
          commonDirectory: "/repo/.git",
          topology,
          profileFingerprint: fingerprint,
          boundAt: "2026-08-04T00:00:00.000Z",
        },
        workspace,
        });
      },
    },
    evidence: {
      evaluate: async () => receipt(eligible).decision,
      // Models the trusted gate re-entering the now-removed worktree scope.
      evaluateReceipt: async () => { if (deliveryMissing) throw new Error("product-reader-after-cleanup"); return { ...receipt(eligible), deliveryId: receiptDeliveryId, actorLogin: receiptActorLogin }; },
    },
    product: { observe: async () => product },
    provider: {
      open: async () => ({
        observeExistingPullRequest: async () => current,
        observeTrackedIssue: async () => undefined,
        updateReviewDossier: async () => {
          mutations++;
          throw new Error("mutation");
        },
        markReady: async () => {
          mutations++;
          throw new Error("mutation");
        },
        closeTrackedIssue: async () => {
          mutations++;
          throw new Error("mutation");
        },
      }),
    },
    ledger,
    journal,
    git: {
      observeLedger: async () => undefined,
      observeFinalizationStatus: async () => ({ mainSha: main, mergeReachableFromMain: true }),
      openRecovery: async () => {
        recoveryOpens++;
        throw new Error("status must not open recovery git");
      },
      open: async () => {
        gitOpens++;
        throw new Error("git");
      },
    },
    finalSeal: {
      verifyExistingSeal: async () => undefined,
      durableRecordPaths: async () => {
        mutations++;
        return [];
      },
      seal: async () => {
        mutations++;
        return head;
      },
    },
    cleanup: {
      removeOwned: async () => {
        mutations++;
      },
    },
    mergePolicy: { resolve: async () => "squash" },
    locks: {
      acquire: async () => {
        locks++;
        throw new Error("lock");
      },
    } as any,
    lockPath: () => "/status.lock",
  });
  const cases: readonly [string, () => void, string][] = [
    [
      "human-merge-required",
      () => {
        eligible = true;
        product = observation;
        current = pull("open");
      },
      "wait",
    ],
    [
      "closed-unmerged",
      () => {
        current = pull("closed");
      },
      "Reopen",
    ],
    [
      "evidence-stale",
      () => {
        eligible = false;
      },
      "Renew",
    ],
    [
      "path-policy",
      () => {
        eligible = true;
        product = { ...observation, headTreeSha: sha("9") };
      },
      "reclassify",
    ],
    [
      "provider-mismatch",
      () => {
        product = observation;
        current = { ...pull("open"), headSha: sha("9") };
      },
      "canonical pull request",
    ],
    [
      "finalization-incomplete",
      () => {
        product = observation;
        current = pull("merged", merge);
      },
      "resume",
    ],
  ];
  for (const [code, arrange, action] of cases) {
    arrange();
    const status = await operation.inspectStatus({ deliveryId: "delivery" });
    assert.equal(status.blockers[0]!.code, code);
    assert.match(status.nextSafeAction, new RegExp(action, "i"));
  }
  // Receipt identity and every registered workspace identity component are
  // authority inputs even on the read-only status path.
  current = pull("open");
  for (const [name, arrange] of [
    ["foreign delivery", () => { receiptDeliveryId = "other"; }],
    ["foreign actor", () => { receiptActorLogin = "other"; }],
  ] as const) {
    arrange();
    const result = await operation.inspectStatus({ deliveryId: "delivery" });
    assert.equal(result.blockers[0]!.code, "evidence-stale", name);
    receiptDeliveryId = "delivery";
    receiptActorLogin = "actor";
  }
  for (const key of ["creationToken", "commonDirectory", "worktreePath"] as const) {
    workspace = { ...workspace, [key]: key === "creationToken" ? "22222222-2222-4222-8222-222222222222" : `${workspace[key]}-replacement` };
    await assert.rejects(operation.inspectStatus({ deliveryId: "delivery" }), /authority|workspace/i, key);
    workspace = { schemaVersion: 1, state: "ready", creationToken: "11111111-1111-4111-8111-111111111111", deliveryId: "delivery", commonDirectory: "/repo/.git", branch: "shipyard/delivery", worktreePath: "/repo-delivery" };
  }
  // Cleanup may have removed the registry/worktree before the phase checkpoint.
  current = pull("merged", merge);
  await ledger.writeManifest(await ledger.read("delivery"), { ...seeded, pullRequest: current, phase: "finalizing" });
  await journal.append(await journal.read("delivery"), { step: "single-repository-branch-delete-started", idempotencyKey: `single-branch-delete-started:${head}`, observedSha: head, completedAt: "2026-08-04T00:00:00.000Z" });
  deliveryMissing = true;
  const beforeReducedResolver = deliveryResolverCalls;
  const reduced = await operation.inspectStatus({ deliveryId: "delivery" });
  assert.equal(reduced.phase, "finalizing");
  assert.equal(reduced.blockers[0]!.code, "finalization-incomplete");
  assert.equal(deliveryResolverCalls, beforeReducedResolver);
  deliveryMissing = false;
  current = pull("merged", merge);
  await ledger.writeManifest(await ledger.read("delivery"), { ...seeded, pullRequest: current, phase: "complete" });
  const incomplete = await operation.inspectStatus({ deliveryId: "delivery" });
  assert.equal(incomplete.blockers[0]!.code, "finalization-incomplete");
  assert.equal(incomplete.phase, "finalizing");
  assert.match(incomplete.nextSafeAction, /resume/i);
  assert.equal(mutations, 0);
  assert.equal(gitOpens, 0);
  assert.equal(recoveryOpens, 0);
  assert.equal(locks, 0);
  await assert.rejects(operation.inspectStatus({ deliveryId: "../bad" }));
});

test("observes human merge and resumes issue-close and branch-delete crashes before sealing last", async () => {
  const profile: Profile = {
      schemaVersion: 1,
      name: "single",
      actor: { login: "actor" },
      topology,
      allowedOperations: ["finalize"],
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
    events: string[] = [];
  let currentAuthority = authority,
    flipBeforeSeal = false;
  const productObservation = {
      objectFormat: "sha1" as const,
      branch: "shipyard/delivery",
      headSha: head,
      headTreeSha: tree,
      baseSha: base,
      touchedPaths: ["src/app.ts"],
      entries: [
        { path: "src/app.ts", mode: "100644" as const, objectId: sha("8") },
      ],
    },
    currentManifest: SingleRepositoryManifest = {
      ...manifest,
      certifications: [
        {
          ...manifest.certifications[0]!,
          policyDigest: singleRepositoryPolicyDigest(
            profile,
            productObservation,
          ),
        },
      ],
    };
  await ledger.writeManifest(await ledger.read("delivery"), currentManifest);
  const appendJournal = journal.append.bind(journal);
  journal.append = async (expected, entry) => {
    const result = await appendJournal(expected, entry);
    events.push(`journal:${entry.step}`);
    return result;
  };
  let eligible = true,
    issueClosed = false,
    loseIssueResponse = true,
    failCleanup = true,
    branchSha: string | undefined = head,
    observedMainSha = main,
    seals = 0,
    publishedSeal: string | undefined,
    evidenceReceiptCalls = 0,
    productCalls = 0,
    providerOpens = 0,
    gitOpens = 0,
    forbiddenBroadMutations = 0,
    providerPull: SingleRepositoryPullRequest = pull("closed");
  const providerSession = {
    observeExistingPullRequest: async () => providerPull,
    updateReviewDossier: async () => {
      throw new Error("not certifying");
    },
    markReady: async () => {
      throw new Error("not certifying");
    },
    observeTrackedIssue: async () => ({
      ...issue,
      state: issueClosed ? ("closed" as const) : ("open" as const),
    }),
    closeTrackedIssue: async () => {
      if (issueClosed) return;
      events.push("close-issue");
      issueClosed = true;
      if (loseIssueResponse) {
        loseIssueResponse = false;
        throw new Error("issue response lost");
      }
    },
  };
  const broadSession = () => ({
    observation: {
      destinationMainSha: observedMainSha,
      developmentMainSha: base,
      ...(branchSha
        ? { destinationBranchSha: branchSha, developmentBranchSha: branchSha }
        : {}),
      mergeCommitSha: merge,
      mergeCommitTreeSha: tree,
      mergeParents: [base],
      mergeCommitAncestorOfMain: true,
      finalDestinationCommitAncestorOfMerge: false,
    },
    ensureReviewedTag: async () => {
      events.push("tag");
      return sha("f");
    },
    synchronizeLocalMain: async () => {
      events.push("sync-main");
    },
    deleteDeliveryBranch: async () => {
      forbiddenBroadMutations++;
      throw new Error("broad session must not delete the delivery branch");
    },
    observeDeliveryBranchSha: async () => branchSha,
    observeMainSha: async () => observedMainSha,
    publishLedger: async (seal: string) => {
      forbiddenBroadMutations++;
      throw new Error(`broad session must not publish ${seal}`);
    },
    release: async () => {
      events.push("broad-release");
    },
  });
  const recoverySession = () => {
    events.push("recovery-open");
    return {
      observeDeliveryBranchSha: async () => branchSha,
      deleteDeliveryBranch: async () => {
        events.push("delete-branch");
        branchSha = undefined;
      },
      publishLedger: async (seal: string) => {
        events.push("publish-seal");
        publishedSeal = seal;
      },
      release: async () => {},
    };
  };
  const operation = createTrustedSingleRepositoryFinalizationOperation({
    repositoryPath: "/repo",
    authority: { resolve: async () => currentAuthority },
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
      evaluate: async () => receipt(eligible).decision,
      evaluateReceipt: async () => { evidenceReceiptCalls++; return ({
        ...receipt(eligible),
        ledgerSha: store.head ?? evidence.ledgerSha,
      }); },
    },
    product: { observe: async () => { productCalls++; return productObservation; } },
    git: {
      observeLedger: async () => undefined,
      observeFinalizationStatus: async () => ({ ...(publishedSeal ? { ledgerSha: publishedSeal } : {}), ...(branchSha ? { deliveryBranchSha: branchSha } : {}), mainSha: main, mergeReachableFromMain: true }),
      openRecovery: async () => recoverySession(),
      open: async () => {
        gitOpens++;
        return broadSession();
      },
    },
    provider: { open: async () => { providerOpens++; return providerSession; } },
    ledger,
    journal,
    finalSeal: {
      verifyExistingSeal: async () => seals === 0 ? undefined : sha("9"),
      durableRecordPaths: async () => {
        if (flipBeforeSeal)
          currentAuthority = { ...authority, profileFingerprint: digest("0") };
        return Object.keys(store.records).sort();
      },
      seal: async () => {
        events.push("seal");
        seals++;
        return sha("9");
      },
    },
    cleanup: {
      removeOwned: async () => {
        events.push("cleanup");
        if (failCleanup) {
          failCleanup = false;
          throw new Error("cleanup response lost");
        }
      },
    },
    mergePolicy: { resolve: async () => "squash" },
    locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()),
    lockPath: () => "/single-finalize.lock",
    now: () => new Date("2026-08-04T00:00:00.000Z"),
  });
  // A valid record copied under another delivery's path must be rejected by
  // the first ledger read: no workspace cleanup or provider/Git authority may
  // be reached before the caller-selected path identity is proven.
  store.records["deliveries/other/promotion/single-repository-manifest.json"] = store.records["deliveries/delivery/promotion/single-repository-manifest.json"]!;
  await assert.rejects(operation.observeAndFinalize({ deliveryId: "other" }), /checkpoint|malformed/i);
  assert.equal(events.length, 0);
  assert.equal(providerOpens, 0);
  assert.equal(gitOpens, 0);
  delete store.records["deliveries/other/promotion/single-repository-manifest.json"];
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /human\/team merge|merge identity/i,
  );
  assert.equal((await ledger.read("delivery")).intent, undefined);
  assert.equal(events.length, 0);
  providerPull = { ...pull("merged", merge), headSha: sha("9") };
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /merge identity/i,
  );
  assert.equal((await ledger.read("delivery")).intent, undefined);
  providerPull = { ...pull("merged", merge), baseRef: "other" };
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /merge identity/i,
  );
  assert.equal((await ledger.read("delivery")).intent, undefined);
  providerPull = { ...pull("merged", merge), id: "PR_replaced" };
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /merge identity/i,
  );
  assert.equal((await ledger.read("delivery")).intent, undefined);
  providerPull = pull("merged", merge);
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /issue response lost/,
  );
  assert.equal((await ledger.read("delivery")).manifest!.phase, "finalizing");
  assert.ok((await ledger.read("delivery")).intent);
  // Cleanup is the terminal workspace action.  Its durable prefix leases the
  // one exact branch deletion; sealing/publication are only post-delete work.
  assert.equal(seals, 0);
  observedMainSha = sha("0");
  const driftTags = events.filter((event) => event === "tag").length;
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /destination main/i,
  );
  assert.equal(events.filter((event) => event === "tag").length, driftTags);
  assert.equal(seals, 0);
  observedMainSha = main;
  eligible = false;
  const tagsBefore = events.filter((event) => event === "tag").length;
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /receipt is stale/i,
  );
  assert.equal(events.filter((event) => event === "tag").length, tagsBefore);
  assert.equal(seals, 0);
  eligible = true;
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /cleanup response lost/,
  );
  assert.equal(branchSha, head);
  assert.ok(
    (await journal.read("delivery")).journal.entries.some(
      (entry) => entry.step === "single-repository-workspace-cleanup-started",
    ),
  );
  assert.equal(seals, 0);
  const journalPath = "deliveries/delivery/promotion/journal.json",
    exactJournalBytes = store.records[journalPath]!;
  store.records[journalPath] = exactJournalBytes.replace(
    `single-workspace-cleanup-started:${head}`,
    "wrong-key",
  );
  const beforeConflict = [evidenceReceiptCalls, productCalls, providerOpens, gitOpens];
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /checkpoint|exact proof/i,
  );
  assert.deepEqual([evidenceReceiptCalls, productCalls, providerOpens, gitOpens], beforeConflict, "conflicting one-shot tuple fails before live access");
  assert.equal(events.includes("cleanup"), true);
  assert.equal(seals, 0);
  store.records[journalPath] = exactJournalBytes;
  receiptTime = "2026-08-04T00:00:01.000Z";
  const result = await operation.observeAndFinalize({ deliveryId: "delivery" });
  assert.equal(result.phase, "complete");
  assert.equal(result.sealSha, sha("9"));
  assert.equal(
    (await ledger.read("delivery")).receipt!.trackedIssueState,
    "closed",
  );
  const cleanupStarted = events.lastIndexOf("journal:single-repository-workspace-cleanup-started"),
    cleanup = events.lastIndexOf("cleanup"),
    cleanupCompleted = events.lastIndexOf("journal:single-repository-workspace-cleanup-completed"),
    deleteStarted = events.lastIndexOf("journal:single-repository-branch-delete-started"),
    deleted = events.lastIndexOf("delete-branch"),
    branchDeleted = events.lastIndexOf("journal:single-repository-branch-deleted"),
    receiptRecorded = events.lastIndexOf("journal:final-receipt-recorded"),
    seal = events.lastIndexOf("seal"),
    published = events.lastIndexOf("publish-seal");
  assert.ok(cleanupStarted < cleanup && cleanup < cleanupCompleted && cleanupCompleted < deleteStarted);
  assert.ok(deleteStarted < branchDeleted && branchDeleted < receiptRecorded);
  assert.ok(receiptRecorded < seal && seal < published);
  assert.equal(forbiddenBroadMutations, 0);
  assert.ok(events.lastIndexOf("broad-release") < events.lastIndexOf("recovery-open"));
  assert.ok(!("mergePullRequest" in providerSession));
  assert.ok(!("closePullRequest" in providerSession));
  // A no-op publisher (or observer that does not name the exact seal) cannot
  // convert a durable local seal into completion.
  const exactPublishedSeal = publishedSeal;
  publishedSeal = undefined;
  assert.equal((await operation.observeAndFinalize({ deliveryId: "delivery" })).phase, "complete");
  publishedSeal = exactPublishedSeal;
  receiptTime = "2026-08-04T00:00:02.000Z";
  receiptAcceptanceDigest = digest("9");
  const immutableEvents = events.length;
  const postCleanupLiveCalls = [evidenceReceiptCalls, productCalls, providerOpens, gitOpens];
  const postCleanup = await operation.observeAndFinalize({ deliveryId: "delivery" });
  assert.equal(postCleanup.phase, "complete");
  // Retrying the owned cleanup is idempotent; importantly it does not invoke
  // evidence, product, provider, or a mutable Git session.
  assert.equal(events.length, immutableEvents + 3);
  assert.deepEqual([evidenceReceiptCalls, productCalls, providerOpens, gitOpens], postCleanupLiveCalls, "post-cleanup retry uses only immutable/read-only proof");
  receiptAcceptanceDigest = evidence.acceptanceDigest;
  const sealsBeforeP7 = seals,
    publishesBeforeP7 = events.filter(
      (event) => event === "publish-seal",
    ).length;
  flipBeforeSeal = true;
  // A completed post-cleanup retry is immutable/read-only, so it must not
  // consult the authority seam that formerly guarded sealing.
  assert.equal((await operation.observeAndFinalize({ deliveryId: "delivery" })).phase, "complete");
  assert.equal(seals, sealsBeforeP7 + 1);
  assert.equal(
    events.filter((event) => event === "publish-seal").length,
    publishesBeforeP7 + 1,
  );
  currentAuthority = authority;
  flipBeforeSeal = false;
  const sealsBeforeRecreation = seals;
  branchSha = head;
  await assert.rejects(
    operation.observeAndFinalize({ deliveryId: "delivery" }),
    /deleted delivery branch was recreated/i,
  );
  assert.equal(seals, sealsBeforeRecreation);
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
      operation.observeAndFinalize(invalid as { deliveryId: string }),
    );
  assert.equal(getterCalls, 0);
});

test("P7: authority flips after each pre-delete durable finalization checkpoint stop the next write", async () => {
  type Seam = "intent" | "phase" | "complete" | "journal";
  for (const seam of [
    "intent",
    "phase",
    "complete",
    "journal",
  ] as const satisfies readonly Seam[]) {
    const profile: Profile = {
        schemaVersion: 1,
        name: "single",
        actor: { login: "actor" },
        topology,
        allowedOperations: ["finalize"],
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
      journal = new PromotionLedger(store),
      events: string[] = [];
    const observation = {
        objectFormat: "sha1" as const,
        branch: "shipyard/delivery",
        headSha: head,
        headTreeSha: tree,
        baseSha: base,
        touchedPaths: ["src/app.ts"],
        entries: [
          { path: "src/app.ts", mode: "100644" as const, objectId: sha("8") },
        ],
      },
      { trackedIssue: _ignored, ...unowned } = manifest,
      seeded: SingleRepositoryManifest = {
        ...unowned,
        certifications: [
          {
            ...manifest.certifications[0]!,
            policyDigest: singleRepositoryPolicyDigest(profile, observation),
          },
        ],
      };
    await ledger.writeManifest(await ledger.read("delivery"), seeded);
    let currentAuthority = stable,
      flip = true,
      branchSha: string | undefined = head,
      seals = 0,
      publishes = 0,
      publishedSeal: string | undefined;
    const drift = () => {
      if (flip)
        currentAuthority = { ...stable, profileFingerprint: digest("0") };
    };
    const writeIntent = ledger.writeIntent.bind(ledger),
      writeManifest = ledger.writeManifest.bind(ledger),
      writeReceipt = ledger.writeReceipt.bind(ledger),
      append = journal.append.bind(journal);
    ledger.writeIntent = async (expected, value) => {
      const result = await writeIntent(expected, value);
      if (seam === "intent") drift();
      return result;
    };
    ledger.writeManifest = async (expected, value) => {
      const result = await writeManifest(expected, value);
      if (
        (seam === "phase" && value.phase === "finalizing") ||
        (seam === "complete" && value.phase === "complete")
      )
        drift();
      return result;
    };
    ledger.writeReceipt = async (expected, value) => {
      const result = await writeReceipt(expected, value);
      return result;
    };
    journal.append = async (expected, entry) => {
      const result = await append(expected, entry);
      events.push(`journal:${entry.step}`);
      if (seam === "journal" && entry.step === "final-intent-recorded") drift();
      return result;
    };
    const provider = {
      open: async () => ({
        observeExistingPullRequest: async () => pull("merged", merge),
        observeTrackedIssue: async () => undefined,
        updateReviewDossier: async () => {
          throw new Error("not certifying");
        },
        markReady: async () => {
          throw new Error("not certifying");
        },
        closeTrackedIssue: async () => {
          throw new Error("not owned");
        },
      }),
    };
    let forbiddenBroadMutations = 0;
    const broadSession = () => ({
      observation: {
        destinationMainSha: main,
        developmentMainSha: base,
        ...(branchSha
          ? {
              destinationBranchSha: branchSha,
              developmentBranchSha: branchSha,
            }
          : {}),
        mergeCommitSha: merge,
        mergeCommitTreeSha: tree,
        mergeParents: [base],
        mergeCommitAncestorOfMain: true,
        finalDestinationCommitAncestorOfMerge: false,
      },
      ensureReviewedTag: async () => {
        events.push("tag");
        return sha("f");
      },
      synchronizeLocalMain: async () => {
        events.push("sync");
      },
      observeDeliveryBranchSha: async () => branchSha,
      observeMainSha: async () => main,
      deleteDeliveryBranch: async () => {
        forbiddenBroadMutations++;
        throw new Error("broad session must not delete the delivery branch");
      },
      publishLedger: async (seal: string) => {
        forbiddenBroadMutations++;
        throw new Error(`broad session must not publish ${seal}`);
      },
      release: async () => {
        events.push("broad-release");
      },
    });
    const recoverySession = () => {
      events.push("recovery-open");
      return {
        observeDeliveryBranchSha: async () => branchSha,
        deleteDeliveryBranch: async () => {
          events.push("delete");
          branchSha = undefined;
        },
        publishLedger: async (seal: string) => {
          publishes++;
          publishedSeal = seal;
          events.push("publish");
        },
        release: async () => {},
      };
    };
    const git: any = {
      observeLedger: async () => undefined,
      observeFinalizationStatus: async () => ({ ...(publishedSeal ? { ledgerSha: publishedSeal } : {}), ...(branchSha ? { deliveryBranchSha: branchSha } : {}), mainSha: main, mergeReachableFromMain: true }),
      openRecovery: async () => recoverySession(),
      open: async () => broadSession(),
    };
    const operation = createTrustedSingleRepositoryFinalizationOperation({
      repositoryPath: "/repo",
      authority: { resolve: async () => currentAuthority },
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
        evaluate: async () => receipt().decision,
        evaluateReceipt: async () => receipt(),
      },
      product: { observe: async () => observation },
      git,
      provider,
      ledger,
      journal,
      finalSeal: {
        verifyExistingSeal: async () => seals === 0 ? undefined : sha("9"),
        durableRecordPaths: async () => Object.keys(store.records).sort(),
        seal: async () => {
          seals++;
          events.push("seal");
          return sha("9");
        },
      },
      cleanup: {
        removeOwned: async () => {
          events.push("cleanup");
        },
      },
      mergePolicy: { resolve: async () => "squash" },
      locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()),
      lockPath: () => `/p7-${seam}.lock`,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });
    if (seam === "complete") {
      assert.equal(
        (await operation.observeAndFinalize({ deliveryId: "delivery" })).phase,
        "complete",
      );
      assert.equal(forbiddenBroadMutations, 0);
      assert.ok(
        events.lastIndexOf("broad-release") <
          events.lastIndexOf("recovery-open"),
      );
      continue;
    }
    await assert.rejects(
      operation.observeAndFinalize({ deliveryId: "delivery" }),
      /authority changed/i,
      seam,
    );
    const checkpoint = await ledger.read("delivery"),
      entries = (await journal.read("delivery")).journal.entries.map(
        (entry) => entry.step,
      );
    if (seam === "intent") {
      assert.ok(checkpoint.intent);
      assert.equal(checkpoint.manifest!.phase, "awaiting-human-merge");
      assert.deepEqual(entries, []);
    }
    if (seam === "phase") {
      assert.ok(checkpoint.intent);
      assert.equal(checkpoint.manifest!.phase, "finalizing");
      assert.deepEqual(entries, []);
    }
    if ((seam as string) === "complete") {
      assert.equal(checkpoint.manifest!.phase, "complete");
      assert.equal(checkpoint.receipt, undefined);
      assert.ok(entries.includes("single-repository-branch-deleted"));
    }
    if (seam === "journal") {
      assert.ok(checkpoint.intent);
      assert.deepEqual(entries, ["final-intent-recorded"]);
      assert.equal(events.includes("tag"), false);
    }
    assert.equal(seals, 0);
    assert.equal(publishes, 0);
    assert.equal(forbiddenBroadMutations, 0);
    currentAuthority = stable;
    flip = false;
    const resumed = await operation.observeAndFinalize({
      deliveryId: "delivery",
    });
    if ((seam as string) === "complete") {
      // These crashes have crossed the irreversible deletion checkpoint. A
      // retry may only inspect immutable/read-only proof, never reopen live
      // finalization authority to manufacture the missing proof.
      assert.equal(resumed.phase, "finalizing", `${seam} reduced resume`);
      assert.equal(seals, 0);
      assert.equal(publishes, 0);
    } else {
      assert.equal(resumed.phase, "complete", `${seam} resume`);
      assert.ok(seals >= 1);
      assert.ok(publishes >= 1);
    }
    assert.equal(forbiddenBroadMutations, 0);
    if (events.includes("recovery-open"))
      assert.ok(events.lastIndexOf("broad-release") < events.lastIndexOf("recovery-open"));
  }
});

test("full and reduced validators block stale evidence, product, provider, issue, journal, and authority races", async () => {
  type Scenario =
    | "evidence-tag"
    | "evidence-late"
    | "product-sync"
    | "product-delete"
    | "pull"
    | "issue-close"
    | "post-evidence"
    | "post-pull"
    | "post-issue"
    | "post-journal"
    | "journal-read-authority"
    | "delete-authority"
    | "branch-recreated-during-reduced-provider"
    | "full-final-provider-authority"
    | "reduced-final-journal-authority"
    | "pre-open-journal-corruption";
  for (const scenario of [
    "evidence-tag",
    "evidence-late",
    "product-sync",
    "product-delete",
    "pull",
    "issue-close",
    "post-evidence",
    "post-pull",
    "post-issue",
    "post-journal",
    "journal-read-authority",
    "delete-authority",
    "branch-recreated-during-reduced-provider",
    "full-final-provider-authority",
    "reduced-final-journal-authority",
    "pre-open-journal-corruption",
  ] as const satisfies readonly Scenario[]) {
    const ownsIssue = scenario === "issue-close" || scenario === "post-issue",
      profile: Profile = {
        schemaVersion: 1,
        name: "single",
        actor: { login: "actor" },
        topology,
        allowedOperations: ["finalize"],
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
      journal = new PromotionLedger(store),
      events: string[] = [];
    let productTree = tree,
      eligible = true,
      providerPull: SingleRepositoryPullRequest = pull("merged", merge),
      currentIssue: SingleRepositoryTrackedIssue | undefined = ownsIssue
        ? { ...issue }
        : undefined,
      currentAuthority = stable,
      branchSha: string | undefined = head,
      seals = 0,
      publishes = 0,
      journalReads = 0;
    const productObservation = () => ({
        objectFormat: "sha1" as const,
        branch: "shipyard/delivery",
        headSha: head,
        headTreeSha: productTree,
        baseSha: base,
        touchedPaths: ["src/app.ts"],
        entries: [
          { path: "src/app.ts", mode: "100644" as const, objectId: sha("8") },
        ],
      }),
      { trackedIssue: _ignored, ...unowned } = manifest,
      seeded: SingleRepositoryManifest = {
        ...(ownsIssue ? manifest : unowned),
        pullRequest: pull("open"),
        certifications: [
          {
            ...manifest.certifications[0]!,
            policyDigest: singleRepositoryPolicyDigest(
              profile,
              productObservation(),
            ),
          },
        ],
      };
    await ledger.writeManifest(await ledger.read("delivery"), seeded);
    const append = journal.append.bind(journal),
      readJournal = journal.read.bind(journal);
    journal.read = async (deliveryId) => {
      const value = await readJournal(deliveryId);
      journalReads++;
      if (
        (scenario === "journal-read-authority" && journalReads === 1) ||
        (scenario === "reduced-final-journal-authority" &&
          events.includes("delete"))
      )
        currentAuthority = { ...stable, profileFingerprint: digest("0") };
      return value;
    };
    journal.append = async (expected, entry) => {
      const result = await append(expected, entry);
      events.push(`journal:${entry.step}`);
      if (scenario === "pre-open-journal-corruption" && entry.step === "single-repository-branch-delete-started") {
        const path = "deliveries/delivery/promotion/journal.json";
        store.records[path] = store.records[path]!.replace(`single-branch-delete-started:${head}`, "corrupt-delete-intent");
      }
      if (entry.step === "final-intent-recorded") {
        if (scenario === "evidence-tag") eligible = false;
        if (scenario === "pull")
          providerPull = { ...providerPull, dossierDigest: digest("9") };
      }
      if (
        entry.step === "reviewed-tag-published" &&
        scenario === "product-sync"
      )
        productTree = sha("9");
      if (
        entry.step === "development-main-synchronized" &&
        scenario === "issue-close"
      )
        currentIssue = undefined;
      if (
        entry.step === "development-main-synchronized" &&
        scenario === "product-delete"
      )
        productTree = sha("9");
      return result;
    };
    const providerSession = {
      observeExistingPullRequest: async () => {
        if (
          scenario === "branch-recreated-during-reduced-provider" &&
          events.includes("delete")
        )
          branchSha = head;
        if (scenario === "full-final-provider-authority" && !events.length)
          currentAuthority = { ...stable, profileFingerprint: digest("0") };
        return providerPull;
      },
      observeTrackedIssue: async () => currentIssue,
      updateReviewDossier: async () => {
        throw new Error("not certifying");
      },
      markReady: async () => {
        throw new Error("not certifying");
      },
      closeTrackedIssue: async () => {
        events.push("close-issue");
        currentIssue = currentIssue
          ? { ...currentIssue, state: "closed" as const }
          : undefined;
      },
    };
    let forbiddenBroadMutations = 0;
    const broadSession = () => ({
      observation: {
        destinationMainSha: main,
        developmentMainSha: base,
        ...(branchSha
          ? { destinationBranchSha: branchSha, developmentBranchSha: branchSha }
          : {}),
        mergeCommitSha: merge,
        mergeCommitTreeSha: tree,
        mergeParents: [base],
        mergeCommitAncestorOfMain: true,
        finalDestinationCommitAncestorOfMerge: false,
      },
      ensureReviewedTag: async () => {
        events.push("tag");
        return sha("f");
      },
      synchronizeLocalMain: async () => {
        events.push("sync");
        if (scenario === "evidence-late") eligible = false;
      },
      deleteDeliveryBranch: async () => {
        forbiddenBroadMutations++;
        throw new Error("broad session must not delete the delivery branch");
      },
      observeDeliveryBranchSha: async () => branchSha,
      observeMainSha: async () => main,
      publishLedger: async (seal: string) => {
        forbiddenBroadMutations++;
        throw new Error(`broad session must not publish ${seal}`);
      },
      release: async () => {
        events.push("broad-release");
      },
    });
    const recoverySession = () => {
      events.push("recovery-open");
      return {
        observeDeliveryBranchSha: async () => branchSha,
        deleteDeliveryBranch: async () => {
          events.push("delete");
          branchSha = undefined;
          if (scenario === "post-evidence") eligible = false;
          if (scenario === "post-pull")
            providerPull = { ...providerPull, state: "closed" };
          if (scenario === "post-issue" && currentIssue)
            currentIssue = {
              ...currentIssue,
              deliveryMarker: stableShipyardMarker("other"),
            };
          if (scenario === "post-journal")
            delete store.records["deliveries/delivery/promotion/journal.json"];
          if (scenario === "delete-authority")
            currentAuthority = { ...stable, actorLogin: "other" };
        },
        publishLedger: async () => {
          publishes++;
          events.push("publish");
        },
        release: async () => {},
      };
    };
    const operation = createTrustedSingleRepositoryFinalizationOperation({
      repositoryPath: "/repo",
      authority: { resolve: async () => currentAuthority },
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
        evaluate: async () => receipt(eligible).decision,
        evaluateReceipt: async () => receipt(eligible),
      },
      product: { observe: async () => productObservation() },
      git: {
        observeLedger: async () => undefined,
        observeFinalizationStatus: async () => ({ mainSha: main, mergeReachableFromMain: true }),
        openRecovery: async () => recoverySession(),
        open: async () => broadSession(),
      },
      provider: { open: async () => providerSession },
      ledger,
      journal,
      finalSeal: {
        verifyExistingSeal: async () => undefined,
        durableRecordPaths: async () => Object.keys(store.records).sort(),
        seal: async () => {
          seals++;
          events.push("seal");
          return sha("9");
        },
      },
      cleanup: {
        removeOwned: async () => {
          events.push("cleanup");
        },
      },
      mergePolicy: { resolve: async () => "squash" },
      locks: new MutationLockService(new MemoryFilesystem(), new FakeProcess()),
      lockPath: () => `/strong-${scenario}.lock`,
      now: () => new Date("2026-08-04T00:00:00.000Z"),
    });
    if (["post-evidence", "post-pull", "post-issue", "delete-authority", "branch-recreated-during-reduced-provider", "reduced-final-journal-authority"].includes(scenario as string)) {
      await operation.observeAndFinalize({ deliveryId: "delivery" });
      assert.equal(forbiddenBroadMutations, 0, scenario);
      assert.ok(
        events.lastIndexOf("broad-release") <
          events.lastIndexOf("recovery-open"),
        scenario,
      );
      continue;
    }
    await assert.rejects(
      operation.observeAndFinalize({ deliveryId: "delivery" }),
      /authority|binding|receipt is stale|path policy|PR-head tree|merge identity|tracked issue|checkpoint|recreated/i,
      scenario,
    );
    const postDelete =
      scenario.startsWith("post-") ||
      scenario === "delete-authority" ||
      scenario === "branch-recreated-during-reduced-provider";
    if (
      scenario === "evidence-tag" ||
      scenario === "pull" ||
      scenario === "journal-read-authority" ||
      scenario === "full-final-provider-authority"
    )
      assert.equal(events.includes("tag"), false, scenario);
    if (scenario === "journal-read-authority")
      assert.deepEqual((await journal.read("delivery")).journal.entries, []);
    if (scenario === "pre-open-journal-corruption") {
      assert.equal(events.includes("cleanup"), true, scenario);
      assert.equal(events.includes("recovery-open"), false, scenario);
      assert.equal(events.includes("delete"), false, scenario);
    }
    if (scenario === "evidence-late") {
      assert.ok(events.includes("sync"));
      assert.equal(events.includes("delete"), false);
    }
    if (scenario === "product-sync")
      assert.equal(events.includes("sync"), false);
    if (scenario === "product-delete")
      assert.equal(events.includes("delete"), false);
    if (scenario === "issue-close")
      assert.equal(events.includes("close-issue"), false);
    if (postDelete || scenario === "reduced-final-journal-authority") {
      assert.ok(events.includes("delete"), scenario);
      if (scenario !== "post-journal") assert.equal(events.includes("cleanup"), false, scenario);
      assert.equal(
        (await ledger.read("delivery")).receipt,
        undefined,
        scenario,
      );
    }
    assert.equal(seals, 0, scenario);
    assert.equal(publishes, 0, scenario);
    assert.equal(forbiddenBroadMutations, 0, scenario);
    if (events.includes("recovery-open"))
      assert.ok(events.lastIndexOf("broad-release") < events.lastIndexOf("recovery-open"), scenario);
  }
});
