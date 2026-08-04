import assert from "node:assert/strict";
import test from "node:test";
import { SyncError, SyncService, canonicalSourceRef } from "../../src/sync/service.js";
import type { BaselineObservation, SyncGit, SyncMutationProof } from "../../src/sync/git.js";
import type { BoundProfileAuthority } from "../../src/profile/bound-authority.js";
import type { Profile } from "../../src/contracts/types.js";
import { profileFingerprint } from "../../src/profile/fingerprint.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import type { LedgerStore } from "../../src/ledger/types.js";
import { LedgerError } from "../../src/ledger/errors.js";
import { validateSourceProvenance } from "../../src/sync/provenance.js";

const sha = "a".repeat(40); const destinationSha = "b".repeat(40);
const destination = { owner: "acme", name: "destination", remote: { name: "upstream", url: "https://github.com/acme/destination.git" }, defaultBranch: "main" };
const development = { owner: "acme", name: "development", remote: { name: "origin", url: "https://github.com/acme/development.git" }, defaultBranch: "main" };
const profile = (): Profile => ({ schemaVersion: 1, name: "trusted", actor: { login: "actor" }, topology: { kind: "staged-pair", development, destination }, allowedOperations: ["sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } });
const authority = (current = profile()): BoundProfileAuthority => ({ profileName: "trusted", commonDirectory: "/repo/.git", profileFingerprint: profileFingerprint(current), actorLogin: "actor", topology: current.topology });
const clean = (changes: readonly string[] = ["src/app.ts"]): BaselineObservation => ({ clean: true, checkedOutBranch: "main", developmentSha: sha, destinationSha, ancestry: "behind", remoteUrl: destination.remote.url, changedPaths: changes, objectFormat: "sha1" });

class FakeSyncGit implements SyncGit {
  observation = clean(); observations = 0; onObserve?: (count: number) => void; onMaterialize?: () => void; onFastForward?: () => void; onImport?: () => void; fastForwards = 0; materializations = 0; imports: Array<{ source: string; localRef: string }> = []; resolved = destinationSha; localRefs = new Map<string, string>(); failImportOnce = false;
  async observe(): Promise<BaselineObservation> { this.observations += 1; this.onObserve?.(this.observations); return this.observation; }
  async observeStaged(): Promise<BaselineObservation> { return this.observation; }
  async materializeStaged(_repository: string, _staged: string, _stagedRef: string, _expectedSha: string, proof: SyncMutationProof): Promise<void> { this.onMaterialize?.(); this.requireProof(proof); this.materializations += 1; }
  async fastForward(_repository: string, destination: string, proof: SyncMutationProof): Promise<void> { this.onFastForward?.(); this.requireProof(proof); this.fastForwards += 1; this.observation = { ...this.observation, developmentSha: destination, destinationSha: destination, ancestry: "equal" }; }
  async importStaged(_repository: string, _staged: string, stagedRef: string, localRef: string, expectedSha: string, proof: SyncMutationProof): Promise<string> { this.onImport?.(); this.requireProof(proof); if (stagedRef.includes("source")) this.imports.push({ source: stagedRef, localRef }); if (this.failImportOnce) { this.failImportOnce = false; throw new Error("injected import failure"); } this.localRefs.set(localRef, expectedSha); return expectedSha; }
  async resolveSource(): Promise<string> { return this.resolved; }
  async resolveLocal(_repository: string, localRef: string): Promise<string> { const value = this.localRefs.get(localRef); if (!value) throw new Error("missing local ref"); return value; }
  async resolveLocalOptional(_repository: string, localRef: string): Promise<string | undefined> { return this.localRefs.get(localRef); }
  private requireProof(proof: SyncMutationProof): void { if (!this.observation.clean || this.observation.checkedOutBranch !== proof.developmentBranch || this.observation.developmentSha !== proof.expectedDevelopmentSha || this.observation.destinationSha !== proof.expectedDestinationTrackingSha || this.observation.remoteUrl !== proof.expectedRemoteUrl || this.observation.objectFormat !== proof.objectFormat) throw new Error("mutation proof changed"); }
}
type ServiceHooks = { onStage?: () => void; authority?: () => BoundProfileAuthority; profile?: () => Profile };
function service(git = new FakeSyncGit(), ledgerOverride?: LedgerStore & import("../../src/context/types.js").PinnedLedgerReader, currentProfile = profile(), now: () => Date = () => new Date("2026-08-04T00:00:00.000Z"), hooks: ServiceHooks = {}) {
  const fs = new MemoryFilesystem();
  let head: string | undefined; let checkpoint = 0; const records: Record<string, string> = {};
  let ledgerTransactions = 0; const ledger = { objectFormat: async () => "sha1" as const, snapshot: async (paths: readonly string[]) => ({ head, records: Object.fromEntries(paths.filter(path => records[path] !== undefined).map(path => [path, records[path]!])) }), read: async (_sha: string, paths: readonly string[]) => Object.fromEntries(paths.filter(path => records[path] !== undefined).map(path => [path, records[path]!])), transact: async (transaction: { expectedHead: string | undefined; writes: readonly { path: string; contents: string }[] }) => { ledgerTransactions += 1; assert.equal(transaction.expectedHead, head); for (const write of transaction.writes) records[write.path] = write.contents; checkpoint += 1; head = checkpoint.toString(16).padStart(40, "0"); return head; } };
  let transportCalls = 0; const transport = { stage: async (_repository: string, _development: string, _destination: string, sourceRef?: string) => { transportCalls += 1; hooks.onStage?.(); return { repositoryPath: "/stage", destinationRef: "refs/shipyard/staged-destination", destinationSha: git.observation.destinationSha, ...(sourceRef === undefined ? {} : { sourceRef: "refs/shipyard/staged-source", sourceSha: git.resolved }), release: async () => {} }; } };
  return { git, fs, records, ledgerTransactions: () => ledgerTransactions, transportCalls: () => transportCalls, service: new SyncService({ authority: { resolve: async () => hooks.authority?.() ?? authority(currentProfile) }, profiles: { read: async () => hooks.profile?.() ?? currentProfile }, git, transport, ledger: ledgerOverride ?? ledger, locks: new MutationLockService(fs, new FakeProcess()), lockPath: () => "/locks/sync", now }) };
}

test("fast-forwards a clean behind development main exactly to destination main", async () => {
  const { service: subject, git } = service();
  const result = await subject.sync({ repositoryPath: "/repo" });
  assert.equal(result.kind, "baseline");
  if (result.kind !== "baseline") throw new Error("expected baseline result");
  assert.equal(result.destinationSha, destinationSha); assert.equal(git.fastForwards, 1);
});

test("fails closed before mutation for dirty, wrong branch, divergence, remote drift, or unclassified paths", async () => {
  for (const observation of [
    { ...clean(), clean: false }, { ...clean(), checkedOutBranch: "feature/x" }, { ...clean(), ancestry: "ahead" as const },
    { ...clean(), remoteUrl: "https://github.com/acme/other.git" }, { ...clean(["unknown.txt"]) },
  ]) {
    const { service: subject, git, transportCalls } = service(); git.observation = observation;
    await assert.rejects(subject.sync({ repositoryPath: "/repo" }), SyncError);
    assert.equal(transportCalls(), 0); assert.equal(git.fastForwards, 0); assert.equal(git.imports.length, 0);
  }
});

test("imports only an explicit named source into the private namespace without moving main", async () => {
  const { service: subject, git, records } = service();
  const result = await subject.sync({ repositoryPath: "/repo", sourceRef: "refs/tags/v1.2.3" });
  assert.equal(result.kind, "source");
  if (result.kind !== "source") throw new Error("expected source result");
  assert.match(result.provenance.ledgerCheckpointSha, /^[a-f0-9]{40}$/); assert.ok(Object.values(records).some(value => value.includes(result.provenance.ledgerCheckpointSha))); assert.equal(git.fastForwards, 0); assert.deepEqual(git.imports, [{ source: "refs/shipyard/staged-source", localRef: canonicalSourceRef("upstream", "refs/tags/v1.2.3") }]);
});

test("rejects omitted-equivalent and wildcard/refspec source names before import", async () => {
  for (const sourceRef of ["", "main*", "refs/heads/main:refs/heads/x", "--upload-pack=x", "refs//heads/x", "refs/heads/../x"]) {
    const { service: subject, git, transportCalls } = service();
    await assert.rejects(subject.sync({ repositoryPath: "/repo", sourceRef }), SyncError);
    assert.equal(transportCalls(), 0); assert.equal(git.imports.length, 0);
  }
});

test("source freshness detects remote/name/SHA drift before later use", async () => {
  const { service: subject, git } = service();
  const imported = await subject.sync({ repositoryPath: "/repo", sourceRef: "release/v1" });
  assert.equal(imported.kind, "source");
  if (imported.kind !== "source") throw new Error("expected source result");
  git.resolved = "c".repeat(40);
  await assert.rejects(subject.requireFreshSource(imported.provenance, "/repo"), (error: unknown) => error instanceof SyncError && error.code === "source-stale");
});

test("round-trips full SHA-256 observations through the public baseline seam", async () => {
  const { service: subject, git } = service(); git.observation = { ...clean(), developmentSha: "a".repeat(64), destinationSha: "b".repeat(64), objectFormat: "sha256" };
  const result = await subject.sync({ repositoryPath: "/repo" }); assert.equal(result.kind, "baseline"); assert.equal(git.fastForwards, 1);
});

test("a held shared mutation lock blocks before Git observation or ref movement", async () => {
  const { service: subject, git, fs } = service(); fs.files.set("/locks/sync", JSON.stringify({ version: 1, repository: "/repo/.git", operation: "sync", processId: 999, host: "test-host", token: "held", acquiredAt: "2026-08-04T00:00:00.000Z" }));
  await assert.rejects(subject.sync({ repositoryPath: "/repo" }), /lock/i); assert.equal(git.fastForwards, 0); assert.equal(git.imports.length, 0);
});

test("ledger concurrency blocks provenance completion without retry or product-ref movement", async () => {
  const ledger: LedgerStore & import("../../src/context/types.js").PinnedLedgerReader = { objectFormat: async () => "sha1", snapshot: async () => ({ head: "a".repeat(40), records: {} }), read: async () => ({}), transact: async () => { throw new LedgerError("ledger-stale-head", "concurrent ledger writer"); } };
  const { service: subject, git } = service(new FakeSyncGit(), ledger); await assert.rejects(subject.sync({ repositoryPath: "/repo", sourceRef: "release/v2" }), (error: unknown) => error instanceof LedgerError && error.code === "ledger-stale-head"); assert.equal(git.fastForwards, 0); assert.equal(git.imports.length, 0);
});

test("conflicting path ownership blocks before baseline movement", async () => {
  const conflicting = { ...profile(), pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }, { owner: "destination-only" as const, pattern: "src/app.ts" }] } };
  const { service: subject, git } = service(new FakeSyncGit(), undefined, conflicting); await assert.rejects(subject.sync({ repositoryPath: "/repo" }), (error: unknown) => error instanceof SyncError && error.code === "path-policy"); assert.equal(git.fastForwards, 0);
});

test("a local race while acquiring the lock is revalidated before transport or credentials", async () => {
  const git = new FakeSyncGit(); git.onObserve = count => { if (count === 2) git.observation = { ...git.observation, clean: false }; }; const fixture = service(git);
  await assert.rejects(fixture.service.sync({ repositoryPath: "/repo" }), (error: unknown) => error instanceof SyncError && error.code === "dirty-worktree"); assert.equal(fixture.transportCalls(), 0); assert.equal(git.materializations, 0); assert.equal(git.fastForwards, 0); assert.equal(fixture.fs.files.has("/locks/sync"), false);
});

test("authority, operation, path policy, remote, and worktree drift during authenticated staging permit zero mutation", async (t) => {
  for (const scenario of ["operation", "path-policy", "binding", "actor", "remote", "worktree"] as const) await t.test(scenario, async () => {
    const git = new FakeSyncGit(); const base = profile(); let activeProfile = base; let activeAuthority = authority(base);
    const hooks: ServiceHooks = { profile: () => activeProfile, authority: () => activeAuthority, onStage: () => {
      if (scenario === "operation") activeProfile = { ...base, allowedOperations: ["status"] };
      if (scenario === "path-policy") activeProfile = { ...base, pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "other/**" }] } };
      if (scenario === "actor") activeProfile = { ...base, actor: { login: "other" } };
      if (scenario === "operation" || scenario === "path-policy" || scenario === "actor") activeAuthority = authority(activeProfile);
      if (scenario === "binding") activeAuthority = { ...activeAuthority, commonDirectory: "/other/.git" };
      if (scenario === "remote") git.observation = { ...git.observation, remoteUrl: "https://github.com/acme/other.git" };
      if (scenario === "worktree") git.observation = { ...git.observation, clean: false };
    } };
    const fixture = service(git, undefined, base, undefined, hooks); await assert.rejects(fixture.service.sync({ repositoryPath: "/repo" }));
    assert.equal(fixture.transportCalls(), 1); assert.equal(git.materializations, 0); assert.equal(git.fastForwards, 0); assert.equal(git.imports.length, 0); assert.equal(fixture.ledgerTransactions(), 0);
  });
});

test("last-moment Git proof rejects a worktree race before object materialization", async () => {
  const git = new FakeSyncGit(); git.onMaterialize = () => { git.observation = { ...git.observation, clean: false }; }; const fixture = service(git);
  await assert.rejects(fixture.service.sync({ repositoryPath: "/repo" }), /proof/i); assert.equal(git.materializations, 0); assert.equal(git.fastForwards, 0); assert.equal(fixture.ledgerTransactions(), 0);
});

test("worktree and path-policy races at the source pre-ledger seam leave ledger and refs unchanged", async (t) => {
  for (const scenario of ["worktree", "path-policy"] as const) await t.test(scenario, async () => {
    const git = new FakeSyncGit(); const base = profile(); let activeProfile = base; let profileReads = 0;
    if (scenario === "worktree") git.onObserve = count => { if (count === 4) git.observation = { ...git.observation, clean: false }; };
    const hooks: ServiceHooks = { profile: () => { profileReads += 1; if (scenario === "path-policy" && profileReads === 4) activeProfile = { ...base, pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "other/**" }] } }; return activeProfile; }, authority: () => authority(activeProfile) };
    const fixture = service(git, undefined, base, undefined, hooks); const refsBefore = new Map(git.localRefs); const recordsBefore = structuredClone(fixture.records);
    await assert.rejects(fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/race" })); assert.deepEqual(git.localRefs, refsBefore); assert.deepEqual(fixture.records, recordsBefore); assert.equal(fixture.ledgerTransactions(), 0); assert.equal(git.imports.length, 0);
  });
});

test("source provenance validation rejects extra fields and mixed object formats and freezes accepted records", async () => {
  const { service: subject } = service(); const imported = await subject.sync({ repositoryPath: "/repo", sourceRef: "release/v3" }); if (imported.kind !== "source") throw new Error("expected source");
  const valid = validateSourceProvenance(structuredClone(imported.provenance)); assert.ok(Object.isFrozen(valid));
  await assert.rejects(subject.requireFreshSource({ ...imported.provenance, extra: true }, "/repo"), (error: unknown) => error instanceof SyncError && error.code === "source-stale");
  await assert.rejects(subject.requireFreshSource({ ...imported.provenance, objectFormat: "sha256" }, "/repo"), (error: unknown) => error instanceof SyncError && error.code === "source-stale");
});

test("source provenance validation never invokes hostile accessors and returns a detached plain snapshot", async () => {
  const fixture = service(); const imported = await fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/safe" }); if (imported.kind !== "source") throw new Error("expected source");
  const original = structuredClone(imported.provenance) as unknown as Record<string, unknown>; const validated = validateSourceProvenance(original); original.sha = "c".repeat(40); assert.equal(validated.sha, imported.provenance.sha); assert.ok(Object.isFrozen(validated));
  let getterCalls = 0; const accessor = structuredClone(imported.provenance) as Record<string, unknown>; Object.defineProperty(accessor, "remoteName", { enumerable: true, get() { getterCalls += 1; throw new Error("getter-secret"); } });
  assert.throws(() => validateSourceProvenance(accessor), (error: unknown) => error instanceof SyncError && !error.message.includes("getter-secret")); assert.equal(getterCalls, 0);
  const symbolRecord = structuredClone(imported.provenance) as Record<PropertyKey, unknown>; symbolRecord[Symbol("hidden")] = true; assert.throws(() => validateSourceProvenance(symbolRecord), SyncError);
  const nonPlain = Object.assign(Object.create(null), imported.provenance); assert.throws(() => validateSourceProvenance(nonPlain), SyncError);
  const cyclic = { ...imported.provenance, requestedRef: undefined as unknown }; cyclic.requestedRef = cyclic; assert.throws(() => validateSourceProvenance(cyclic), SyncError);
  for (const handler of [
    { getPrototypeOf() { throw new Error("proxy-secret"); } },
    { ownKeys() { throw new Error("proxy-secret"); } },
    { getOwnPropertyDescriptor() { throw new Error("proxy-secret"); } },
  ] satisfies ProxyHandler<object>[]) {
    const proxy = new Proxy(structuredClone(imported.provenance), handler);
    assert.throws(() => validateSourceProvenance(proxy), (error: unknown) => error instanceof SyncError && !error.message.includes("proxy-secret"));
  }
  let proxyGets = 0; const noReadProxy = new Proxy(structuredClone(imported.provenance), { get() { proxyGets += 1; throw new Error("get-secret"); } }); assert.equal(validateSourceProvenance(noReadProxy).sha, imported.provenance.sha); assert.equal(proxyGets, 0);
});

test("freshness requires caller provenance to match durable canonical and pinned receipt records", async () => {
  const fixture = service(); const imported = await fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/v4" }); if (imported.kind !== "source") throw new Error("expected source"); const calls = fixture.transportCalls();
  const canonical = Object.keys(fixture.records).find(path => path.startsWith("sync/source/"))!; fixture.records[canonical] = `${JSON.stringify({ ...imported.provenance, sha: "d".repeat(40) }, null, 2)}\n`;
  await assert.rejects(fixture.service.requireFreshSource(imported.provenance, "/repo"), (error: unknown) => error instanceof SyncError && error.code === "source-stale"); assert.equal(fixture.transportCalls(), calls);
  const freshFixture = service(); await assert.rejects(freshFixture.service.requireFreshSource(imported.provenance, "/repo"), (error: unknown) => error instanceof SyncError && error.code === "source-stale"); assert.equal(freshFixture.transportCalls(), 0);
});

test("an existing immutable source mismatch preserves its usable canonical ledger record", async () => {
  const fixture = service(); const imported = await fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/v5" }); if (imported.kind !== "source") throw new Error("expected source");
  const recordsBefore = structuredClone(fixture.records); fixture.git.resolved = "c".repeat(40);
  await assert.rejects(fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/v5" }), (error: unknown) => error instanceof SyncError && error.code === "source-stale");
  assert.deepEqual(fixture.records, recordsBefore); assert.equal(fixture.git.imports.length, 1);
});

test("a deleted local source ref plus a moved authoritative ref preserves canonical provenance exactly", async () => {
  const fixture = service(); const imported = await fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/moved" }); if (imported.kind !== "source") throw new Error("expected source");
  const recordsBefore = structuredClone(fixture.records); const transactionsBefore = fixture.ledgerTransactions(); fixture.git.localRefs.delete(imported.provenance.localRef); fixture.git.resolved = "c".repeat(40);
  await assert.rejects(fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/moved" }), (error: unknown) => error instanceof SyncError && error.code === "source-stale");
  assert.deepEqual(fixture.records, recordsBefore); assert.equal(fixture.ledgerTransactions(), transactionsBefore); assert.equal(fixture.git.localRefs.has(imported.provenance.localRef), false);
});

test("a failed first local source-ref creation is explicitly resumable from its durable receipt", async () => {
  const git = new FakeSyncGit(); git.failImportOnce = true; let tick = 0; const fixture = service(git, undefined, profile(), () => new Date(Date.parse("2026-08-04T00:00:00.000Z") + tick++));
  await assert.rejects(fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/resume" }), (error: unknown) => error instanceof SyncError && /rerun.*resume/i.test(error.message));
  assert.equal(git.localRefs.size, 0); assert.ok(Object.keys(fixture.records).some(path => path.startsWith("sync/source/")));
  const transactions = fixture.ledgerTransactions(); const resumed = await fixture.service.sync({ repositoryPath: "/repo", sourceRef: "release/resume" }); assert.equal(resumed.kind, "source"); assert.equal(git.localRefs.size, 1); assert.equal(fixture.ledgerTransactions(), transactions);
});
