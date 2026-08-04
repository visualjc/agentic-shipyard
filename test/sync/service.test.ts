import assert from "node:assert/strict";
import test from "node:test";
import { SyncError, SyncService, canonicalSourceRef } from "../../src/sync/service.js";
import type { BaselineObservation, SyncGit } from "../../src/sync/git.js";
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
  observation = clean(); fastForwards = 0; imports: Array<{ source: string; localRef: string }> = []; resolved = destinationSha;
  async observe(): Promise<BaselineObservation> { return this.observation; }
  async observeStaged(): Promise<BaselineObservation> { return this.observation; }
  async fastForward(_repository: string, _remote: string, _branch: string, _expected: string, destination: string): Promise<void> { this.fastForwards += 1; this.observation = { ...this.observation, developmentSha: destination, ancestry: "equal" }; }
  async importSource(_repository: string, _remote: string, source: string, localRef: string): Promise<string> { this.imports.push({ source, localRef }); return this.resolved; }
  async importStaged(_repository: string, _staged: string, stagedRef: string, localRef: string, expectedSha: string): Promise<string> { if (stagedRef.includes("source")) this.imports.push({ source: stagedRef, localRef }); return expectedSha; }
  async resolveSource(): Promise<string> { return this.resolved; }
  async resolveLocal(): Promise<string> { return this.resolved; }
}
function service(git = new FakeSyncGit(), ledgerOverride?: LedgerStore, currentProfile = profile()) {
  const fs = new MemoryFilesystem();
  let head: string | undefined; const records: Record<string, string> = {};
  const ledger = { snapshot: async (paths: readonly string[]) => ({ head, records: Object.fromEntries(paths.filter(path => records[path] !== undefined).map(path => [path, records[path]!])) }), transact: async (transaction: { expectedHead: string | undefined; writes: readonly { path: string; contents: string }[] }) => { assert.equal(transaction.expectedHead, head); for (const write of transaction.writes) records[write.path] = write.contents; head = (head === undefined ? "1" : String(Number(head) + 1)).repeat(40).slice(0, 40); return head; } };
  const transport = { stage: async (_repository: string, _development: string, _destination: string, sourceRef?: string) => ({ repositoryPath: "/stage", destinationRef: "refs/shipyard/staged-destination", destinationSha: git.observation.destinationSha, ...(sourceRef === undefined ? {} : { sourceRef: "refs/shipyard/staged-source", sourceSha: git.resolved }), release: async () => {} }) };
  return { git, fs, records, service: new SyncService({ authority: { resolve: async () => authority(currentProfile) }, profiles: { read: async () => currentProfile }, git, transport, ledger: ledgerOverride ?? ledger, locks: new MutationLockService(fs, new FakeProcess()), lockPath: () => "/locks/sync", now: () => new Date("2026-08-04T00:00:00.000Z") }) };
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
    const { service: subject, git } = service(); git.observation = observation;
    await assert.rejects(subject.sync({ repositoryPath: "/repo" }), SyncError);
    assert.equal(git.fastForwards, 0); assert.equal(git.imports.length, 0);
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
    const { service: subject, git } = service();
    await assert.rejects(subject.sync({ repositoryPath: "/repo", sourceRef }), SyncError);
    assert.equal(git.imports.length, 0);
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
  const ledger: LedgerStore = { snapshot: async () => ({ head: "a".repeat(40), records: {} }), transact: async () => { throw new LedgerError("ledger-stale-head", "concurrent ledger writer"); } };
  const { service: subject, git } = service(new FakeSyncGit(), ledger); await assert.rejects(subject.sync({ repositoryPath: "/repo", sourceRef: "release/v2" }), (error: unknown) => error instanceof LedgerError && error.code === "ledger-stale-head"); assert.equal(git.fastForwards, 0);
});

test("conflicting path ownership blocks before baseline movement", async () => {
  const conflicting = { ...profile(), pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }, { owner: "destination-only" as const, pattern: "src/app.ts" }] } };
  const { service: subject, git } = service(new FakeSyncGit(), undefined, conflicting); await assert.rejects(subject.sync({ repositoryPath: "/repo" }), (error: unknown) => error instanceof SyncError && error.code === "path-policy"); assert.equal(git.fastForwards, 0);
});

test("source provenance validation rejects extra fields and mixed object formats and freezes accepted records", async () => {
  const { service: subject } = service(); const imported = await subject.sync({ repositoryPath: "/repo", sourceRef: "release/v3" }); if (imported.kind !== "source") throw new Error("expected source");
  const valid = validateSourceProvenance(structuredClone(imported.provenance)); assert.ok(Object.isFrozen(valid));
  await assert.rejects(subject.requireFreshSource({ ...imported.provenance, extra: true }, "/repo"), /extra|unsupported/i);
  await assert.rejects(subject.requireFreshSource({ ...imported.provenance, objectFormat: "sha256" }, "/repo"), /object IDs/i);
});
