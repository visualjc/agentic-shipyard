import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createEnvelope } from "../../src/context/envelope.js";
import { ContextError } from "../../src/context/errors.js";
import { ContextReader } from "../../src/context/reader.js";
import { MAX_CONTEXT_AGGREGATE_BYTES, MAX_CONTEXT_RECORD_BYTES } from "../../src/evidence/limits.js";
import { canonicalJson } from "../../src/evidence/schema.js";
import type { BoundProfileAuthority } from "../../src/profile/bound-authority.js";

const envelope = createEnvelope({
  host: "codex", role: "implementer", envelopePath: ".shipyard/envelope.json", repoRoot: "/worktree", deliveryId: "delivery-001", profile: "local",
  topology: { kind: "single-repository", repository: { owner: "acme", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" } },
  repository: { owner: "acme", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" },
  productBranch: "shipyard/delivery-001", objectFormat: "sha1", productSha: "a".repeat(40), ledgerRef: "refs/heads/shipyard-ledger", ledgerSha: "b".repeat(40),evidenceManifestDigest:"c".repeat(64),
});
const expectation = {
  profile: envelope.profile, profileFingerprint: "0".repeat(64), topology: envelope.topology, repository: envelope.repository,
  deliveryId: envelope.deliveryId, host: envelope.host, role: envelope.role,
  envelopePath: envelope.adapter.envelopePath, repoRoot: envelope.adapter.repoRoot,
  productBranch: envelope.productBranch, objectFormat: envelope.objectFormat, productSha: envelope.productSha, ledgerRef: envelope.ledgerRef, ledgerSha: envelope.ledgerSha,evidenceManifestDigest:envelope.evidenceManifestDigest,
} as const;
const authority = { resolve: async (_repositoryPath: string): Promise<BoundProfileAuthority> => ({ profileName: expectation.profile, profileFingerprint: expectation.profileFingerprint, commonDirectory: "/worktree/.git", actorLogin: "actor", topology: expectation.topology }) };

test("rejects a stale product SHA before it invokes the pinned ledger reader", async () => {
  let formatReads = 0; let reads = 0;
  const reader = new ContextReader(expectation, authority, { currentProductSha: async () => "new-product-sha" }, { objectFormat: async () => { formatReads += 1; return "sha1"; }, read: async () => { reads += 1; return {}; } });
  await assert.rejects(reader.load(envelope), (error: unknown) => error instanceof ContextError && error.code === "context-stale-product");
  assert.equal(formatReads, 0);
  assert.equal(reads, 0);
});

test("loads only the envelope's exact role paths from its pinned ledger SHA", async () => {
  let request: { sha: string; paths: readonly string[] } | undefined;
  const reader = new ContextReader(expectation, authority, { currentProductSha: async () => "a".repeat(40) }, {
    objectFormat: async () => "sha1", read: async (sha, paths) => { request = { sha, paths }; return Object.fromEntries(paths.map((path) => [path, `record ${path}`])); },
  });
  const loaded = await reader.load(envelope);
  assert.deepEqual(request, { sha: "b".repeat(40), paths: ["deliveries/delivery-001/contract.md", "deliveries/delivery-001/assigned-task.md"] });
  assert.deepEqual(loaded.records, {
    "deliveries/delivery-001/contract.md": "record deliveries/delivery-001/contract.md",
    "deliveries/delivery-001/assigned-task.md": "record deliveries/delivery-001/assigned-task.md",
  });
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded.records));
});

test("rejects a ledger response that omits an allowed required record", async () => {
  const reader = new ContextReader(expectation, authority, { currentProductSha: async () => "a".repeat(40) }, { objectFormat: async () => "sha1", read: async () => ({ [envelope.records[0]]: "contract" }) });
  await assert.rejects(reader.load(envelope), (error: unknown) => error instanceof ContextError && error.code === "context-ledger-record-missing");
});

test("rejects oversized individual and aggregate role context before returning records",async()=>{
  const individual=new ContextReader(expectation,authority,{currentProductSha:async()=>envelope.productSha},{objectFormat:async()=>"sha1" as const,read:async()=>({[envelope.records[0]]:"x".repeat(MAX_CONTEXT_RECORD_BYTES+1),[envelope.records[1]]:"assigned"})});
  await assert.rejects(individual.load(envelope),(error:unknown)=>error instanceof ContextError&&error.code==="context-ledger-record-missing");
  const manifestBytes=canonicalJson({schemaVersion:1,issueId:"JG-8421",items:[{id:"future",kind:"acceptance"}]}),digest=createHash("sha256").update(manifestBytes).digest("hex"),reviewer=createEnvelope({host:envelope.host,role:"reviewer",envelopePath:envelope.adapter.envelopePath,repoRoot:envelope.adapter.repoRoot,deliveryId:envelope.deliveryId,profile:envelope.profile,topology:envelope.topology,repository:envelope.repository,productBranch:envelope.productBranch,objectFormat:envelope.objectFormat,productSha:envelope.productSha,ledgerRef:envelope.ledgerRef,ledgerSha:envelope.ledgerSha,evidenceManifestDigest:digest}),reviewerExpectation={...expectation,role:"reviewer" as const,evidenceManifestDigest:digest},chunk="x".repeat(Math.floor(MAX_CONTEXT_AGGREGATE_BYTES/3)+1),records=Object.fromEntries(reviewer.records.map(path=>[path,path.endsWith("manifest.json")?manifestBytes:chunk]));
  const aggregate=new ContextReader(reviewerExpectation,authority,{currentProductSha:async()=>reviewer.productSha},{objectFormat:async()=>"sha1" as const,read:async()=>records});
  await assert.rejects(aggregate.load(reviewer),(error:unknown)=>error instanceof ContextError&&error.code==="context-ledger-record-missing");
});

test("rejects accessor-backed ledger records without invoking hostile code",async()=>{let touched=0;const records=Object.defineProperties({},Object.fromEntries(envelope.records.map((path,index)=>[path,index===0?{enumerable:true,get(){touched++;throw new Error("secret");}}:{enumerable:true,value:"assigned"}])));const reader=new ContextReader(expectation,authority,{currentProductSha:async()=>envelope.productSha},{objectFormat:async()=>"sha1" as const,read:async()=>records as Record<string,string>});await assert.rejects(reader.load(envelope),error=>error instanceof ContextError&&!String(error).includes("secret"));assert.equal(touched,0);});

test("rejects envelope role or delivery-id edits before product or ledger reads", async () => {
  let productReads = 0; let ledgerReads = 0;
  const reader = new ContextReader(expectation, authority, { currentProductSha: async () => { productReads += 1; return envelope.productSha; } }, { objectFormat: async () => "sha1", read: async () => { ledgerReads += 1; return {}; } });
  for (const changed of [
    createEnvelope({
      host: envelope.host, role: envelope.role, envelopePath: envelope.adapter.envelopePath, repoRoot: envelope.adapter.repoRoot,
      deliveryId: "delivery-002", profile: envelope.profile, topology: envelope.topology, repository: envelope.repository,
      productBranch: envelope.productBranch, objectFormat: envelope.objectFormat, productSha: envelope.productSha, ledgerRef: envelope.ledgerRef, ledgerSha: envelope.ledgerSha,evidenceManifestDigest:envelope.evidenceManifestDigest,
    }),
    createEnvelope({
      host: envelope.host, role: "reviewer", envelopePath: envelope.adapter.envelopePath, repoRoot: envelope.adapter.repoRoot,
      deliveryId: envelope.deliveryId, profile: envelope.profile, topology: envelope.topology, repository: envelope.repository,
      productBranch: envelope.productBranch, objectFormat: envelope.objectFormat, productSha: envelope.productSha, ledgerRef: envelope.ledgerRef, ledgerSha: envelope.ledgerSha,evidenceManifestDigest:envelope.evidenceManifestDigest,
    }),
  ]) {
    await assert.rejects(reader.load(changed), (error: unknown) => error instanceof ContextError && error.code === "context-dispatch-mismatch");
  }
  assert.equal(productReads, 0);
  assert.equal(ledgerReads, 0);
});

test("rejects a forged repository/topology pair even when both envelope fields are replaced", async () => {
  let productReads = 0; let formatReads = 0; let ledgerReads = 0;
  const forged = createEnvelope({
    host: envelope.host, role: envelope.role, envelopePath: envelope.adapter.envelopePath, repoRoot: envelope.adapter.repoRoot,
    deliveryId: envelope.deliveryId, profile: envelope.profile,
    topology: { kind: "single-repository", repository: { owner: "attacker", name: "other", remote: { name: "origin", url: "https://example.test/other.git" }, defaultBranch: "main" } },
    repository: { owner: "attacker", name: "other", remote: { name: "origin", url: "https://example.test/other.git" }, defaultBranch: "main" },
    productBranch: envelope.productBranch, objectFormat: envelope.objectFormat, productSha: envelope.productSha, ledgerRef: envelope.ledgerRef, ledgerSha: envelope.ledgerSha,evidenceManifestDigest:envelope.evidenceManifestDigest,
  });
  const reader = new ContextReader(expectation, authority, { currentProductSha: async () => { productReads += 1; return envelope.productSha; } }, { objectFormat: async () => { formatReads += 1; return "sha1"; }, read: async () => { ledgerReads += 1; return {}; } });
  await assert.rejects(reader.load(forged), (error: unknown) => error instanceof ContextError && error.code === "context-dispatch-mismatch");
  assert.equal(productReads, 0); assert.equal(formatReads, 0); assert.equal(ledgerReads, 0);
});

test("rejects an envelope object-format mismatch before its pinned ledger read", async () => {
  let reads = 0;
  const reader = new ContextReader({ ...expectation, objectFormat: "sha256" }, authority, { currentProductSha: async () => envelope.productSha }, { objectFormat: async () => "sha1", read: async () => { reads += 1; return {}; } });
  await assert.rejects(reader.load({ ...envelope, objectFormat: "sha256", productSha: "a".repeat(64), ledgerSha: "b".repeat(64) } as never),
    (error: unknown) => error instanceof ContextError && error.code === "context-dispatch-mismatch");
  assert.equal(reads, 0);
});

test("rejects an active binding/profile fingerprint or topology mismatch before product or ledger reads", async () => {
  for (const active of [
    { ...await authority.resolve("/worktree"), profileFingerprint: "f".repeat(64) },
    { ...await authority.resolve("/worktree"), topology: { kind: "single-repository" as const, repository: { owner: "attacker", name: "other", remote: { name: "origin", url: "https://example.test/other.git" }, defaultBranch: "main" } } },
  ]) {
    let productReads = 0; let ledgerReads = 0;
    const reader = new ContextReader(expectation, { resolve: async () => active }, { currentProductSha: async () => { productReads += 1; return envelope.productSha; } }, { objectFormat: async () => "sha1", read: async () => { ledgerReads += 1; return {}; } });
    await assert.rejects(reader.load(envelope), (error: unknown) => error instanceof ContextError && error.code === "context-binding-mismatch");
    assert.equal(productReads, 0); assert.equal(ledgerReads, 0);
  }
});
