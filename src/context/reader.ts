import { ContextError } from "./errors.js";
import { validateContextEnvelope } from "./envelope.js";
import type { ContextAuthorityResolver, ContextDispatchExpectation, ContextEnvelope, PinnedLedgerReader, ProductShaReader } from "./types.js";
import { sameTopology } from "../profile/policy.js";
import { canonicalJson } from "../evidence/schema.js";
import { validateEvidenceManifest } from "../evidence/schema.js";
import { MAX_CONTEXT_AGGREGATE_BYTES, MAX_CONTEXT_RECORD_BYTES, utf8Bytes } from "../evidence/limits.js";
import { createHash } from "node:crypto";

export type LoadedContext = Readonly<{ envelope: ContextEnvelope; records: Readonly<Record<string, string>> }>;
export type ContextAuthorityScope = Readonly<{ repoRoot:string; deliveryId:string; commonDirectory:string; actorLogin:string;evidenceManifestDigest:string }>;

/** Loads a role envelope only after proving the current product still matches its pin. */
export class ContextReader {
  constructor(private readonly expectation: ContextDispatchExpectation, private readonly authority: ContextAuthorityResolver, private readonly products: ProductShaReader, private readonly ledger: PinnedLedgerReader) {}

  /** Re-derives the repository/delivery scope from the trusted dispatch expectation and live binding. */
  async authorityScope():Promise<ContextAuthorityScope>{
    let active:Readonly<{profileName:string;profileFingerprint:string;commonDirectory:string;actorLogin:string;topology:ContextDispatchExpectation["topology"]}>;
    try{active=JSON.parse(canonicalJson(await this.authority.resolve(this.expectation.repoRoot)));}catch{throw new ContextError("context-binding-mismatch","The active binding/profile authority is invalid.");}
    if(!active||typeof active!=="object"||Object.keys(active).sort().join(",")!=="actorLogin,commonDirectory,profileFingerprint,profileName,topology"||typeof active.profileName!=="string"||typeof active.profileFingerprint!=="string"||typeof active.commonDirectory!=="string"||active.commonDirectory.trim()===""||typeof active.actorLogin!=="string"||active.actorLogin.trim()===""||active.profileName!==this.expectation.profile||active.profileFingerprint!==this.expectation.profileFingerprint||canonicalJson(active.topology)!==canonicalJson(this.expectation.topology))throw new ContextError("context-binding-mismatch","The active binding/profile authority no longer matches the trusted dispatch capability.");
    if(!/^[a-f0-9]{64}$/.test(this.expectation.evidenceManifestDigest))throw new ContextError("context-binding-mismatch","The delivery manifest authority is invalid.");
    return deepFreeze({repoRoot:this.expectation.repoRoot,deliveryId:this.expectation.deliveryId,commonDirectory:active.commonDirectory,actorLogin:active.actorLogin,evidenceManifestDigest:this.expectation.evidenceManifestDigest});
  }

  async load(untrustedEnvelope: ContextEnvelope): Promise<LoadedContext> {
    const envelope = validateContextEnvelope(untrustedEnvelope);
    if (!matchesExpectation(envelope, this.expectation)) {
      throw new ContextError("context-dispatch-mismatch", "The serialized envelope does not match the trusted dispatch capability.");
    }
    await this.authorityScope();
    const current = await this.products.currentProductSha(envelope.adapter.repoRoot);
    if (current !== envelope.productSha) {
      throw new ContextError("context-stale-product", "The product SHA changed; create a fresh context envelope before reading ledger records.");
    }
    if (await this.ledger.objectFormat() !== envelope.objectFormat) {
      throw new ContextError("context-dispatch-mismatch", "The envelope object format does not match the active repository.");
    }
    const records = boundedRecords(await this.ledger.read(envelope.ledgerSha, envelope.records),envelope.records);
    if(envelope.role==="reviewer")verifyManifest(envelope,records);
    return deepFreeze({ envelope, records });
  }
}

function matchesExpectation(envelope: ContextEnvelope, expected: ContextDispatchExpectation): boolean {
  return envelope.profile === expected.profile && envelope.deliveryId === expected.deliveryId && envelope.host === expected.host && envelope.role === expected.role
    && envelope.adapter.host === expected.host && envelope.adapter.role === expected.role && envelope.adapter.envelopePath === expected.envelopePath && envelope.adapter.repoRoot === expected.repoRoot
    && sameTopology(envelope.topology, expected.topology) && sameRepository(envelope.repository, expected.repository)
    && envelope.productBranch === expected.productBranch && envelope.productSha === expected.productSha && envelope.ledgerRef === expected.ledgerRef && envelope.ledgerSha === expected.ledgerSha && envelope.evidenceManifestDigest===expected.evidenceManifestDigest && envelope.objectFormat === expected.objectFormat;
}

function sameRepository(left: ContextEnvelope["repository"], right: ContextDispatchExpectation["repository"]): boolean {
  return left.owner === right.owner && left.name === right.name && left.defaultBranch === right.defaultBranch
    && left.remote.name === right.remote.name && left.remote.url === right.remote.url;
}

function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
function boundedRecords(raw:unknown,paths:readonly string[]):Readonly<Record<string,string>>{try{if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype)throw new Error();const keys=Reflect.ownKeys(raw);if(keys.length!==paths.length||keys.some(key=>typeof key!=="string"||!paths.includes(key)))throw new Error();let total=0;const records:Record<string,string>={};for(const path of paths){const descriptor=Object.getOwnPropertyDescriptor(raw,path);if(!descriptor||!descriptor.enumerable||!("value" in descriptor)||typeof descriptor.value!=="string")throw new Error();const size=utf8Bytes(descriptor.value);if(size>MAX_CONTEXT_RECORD_BYTES||(total+=size)>MAX_CONTEXT_AGGREGATE_BYTES)throw new Error();records[path]=descriptor.value;}return deepFreeze(records);}catch{throw new ContextError("context-ledger-record-missing","The pinned ledger records are missing, malformed, or exceed context limits.");}}
function verifyManifest(envelope:ContextEnvelope,records:Readonly<Record<string,string>>):void{const path=`deliveries/${envelope.deliveryId}/evidence/manifest.json`,contents=records[path];try{if(typeof contents!=="string"||createHash("sha256").update(contents).digest("hex")!==envelope.evidenceManifestDigest)throw new Error();const manifest=validateEvidenceManifest(JSON.parse(contents));if(canonicalJson(manifest)!==contents)throw new Error();}catch{throw new ContextError("context-ledger-record-missing","The pinned delivery manifest is missing, malformed, or does not match its authority digest.");}}
