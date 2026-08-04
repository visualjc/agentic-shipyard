import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MAX_REVIEW_BUNDLE_BYTES } from "../../src/evidence/limits.js";
import { canonicalJson } from "../../src/evidence/schema.js";
import { TrustedReviewDispatcher } from "../../src/review/dispatch.js";
import { ReviewError } from "../../src/review/errors.js";

const sha="a".repeat(40),deliveryId="future-delivery",issueId="JG-8421",prefix=`deliveries/${deliveryId}`,manifest={schemaVersion:1 as const,issueId,items:[{id:"future-item",kind:"acceptance" as const}]},manifestBytes=canonicalJson(manifest),manifestDigest=createHash("sha256").update(manifestBytes).digest("hex"),acceptanceBytes=canonicalJson({schemaVersion:1,issueId,productSha:sha,items:[{id:"future-item",kind:"acceptance",state:"pass",evidenceRefs:["proof/future.txt"],verifier:"external",verifiedAt:"2026-08-04T00:00:00.000Z"}]});
const acceptanceDigest=createHash("sha256").update(acceptanceBytes).digest("hex"),ledgerSha="f".repeat(40),request={schemaVersion:1 as const,issueId,productSha:sha,reviewId:"r",reviewerEnvelopePath:"reviewer.json",intentRefs:[`${prefix}/intent.md`],evidenceRefs:[`${prefix}/evidence/acceptance.json`],reviewedLedgerSha:ledgerSha,manifestDigest,acceptanceDigest};
const envelope:any={deliveryId,role:"reviewer",host:"codex",productSha:sha,ledgerSha,evidenceManifestDigest:manifestDigest,adapter:{envelopePath:"reviewer.json",repoRoot:"/repo"}};
const records:Record<string,string>={[`${prefix}/intent.md`]:"intent",[`${prefix}/evidence/manifest.json`]:manifestBytes,[`${prefix}/evidence/acceptance.json`]:acceptanceBytes,[`${prefix}/review.json`]:"review"};
const requestPath=`${prefix}/evidence/review-request-r.json`;

test("trusted dispatch seals canonical bytes in an opaque redacted reviewer view",async()=>{let loaded=0,called=0,bundle:any;const bridge=new TrustedReviewDispatcher({load:async()=>{loaded++;return {envelope,records};}} as any,{codex:{review:async(dispatch:any)=>{called++;bundle=JSON.parse(dispatch.sealedBundle);return {result:{},attestation:{}} as any;}}});await bridge.dispatch(envelope,requestPath,request);assert.equal(loaded,1);assert.equal(called,1);assert.equal(bundle.records.acceptance,acceptanceBytes);assert.equal(bundle.records.manifest,manifestBytes);assert.equal(bundle.review.acceptanceDigest,acceptanceDigest);const serialized=JSON.stringify(bundle);for(const forbidden of [envelope.adapter.repoRoot,envelope.adapter.envelopePath,requestPath,`${prefix}/evidence/acceptance.json`])assert.equal(serialized.includes(forbidden),false);});

test("missing, noncanonical, or mismatched manifest/acceptance bytes reject with zero spawn",async()=>{let called=0;const cases=[
  Object.fromEntries(Object.entries(records).filter(([path])=>!path.endsWith("acceptance.json"))),
  {...records,[`${prefix}/evidence/manifest.json`]:JSON.stringify(manifest,null,2)},
  {...records,[`${prefix}/evidence/acceptance.json`]:canonicalJson({...JSON.parse(acceptanceBytes),issueId:"JG-other"})},
  {...records,[`${prefix}/evidence/acceptance.json`]:canonicalJson({...JSON.parse(acceptanceBytes),productSha:"b".repeat(40)})},
];for(const changed of cases){const bridge=new TrustedReviewDispatcher({load:async()=>({envelope,records:changed})} as any,{codex:{review:async()=>{called++;return {} as any;}}});await assert.rejects(bridge.dispatch(envelope,requestPath,request),ReviewError);}assert.equal(called,0);});

test("stale or wrong-role context rejects before adapter invocation",async()=>{let called=0;for(const changed of [{...envelope,role:"implementer"},{...envelope,productSha:"b".repeat(40)}]){const bridge=new TrustedReviewDispatcher({load:async()=>({envelope:changed,records})} as any,{codex:{review:async()=>{called++;return {} as any;}}});await assert.rejects(bridge.dispatch(changed,requestPath,request),ReviewError);}assert.equal(called,0);});

test("foreign, absolute, traversal, and implementer request paths never spawn",async()=>{let called=0;const bridge=new TrustedReviewDispatcher({load:async()=>({envelope,records})} as any,{codex:{review:async()=>{called++;return {} as any;}}});for(const path of ["/tmp/request.json","../request.json","deliveries/other/evidence/review-request-r.json",`${prefix}/assigned-task.md`])await assert.rejects(bridge.dispatch(envelope,path,request),ReviewError);assert.equal(called,0);});

test("oversized sealed bundles reject before adapter invocation",async()=>{let called=0;const huge={...records,[`${prefix}/intent.md`]:"x".repeat(MAX_REVIEW_BUNDLE_BYTES)};const bridge=new TrustedReviewDispatcher({load:async()=>({envelope,records:huge})} as any,{codex:{review:async()=>{called++;return {} as any;}}});await assert.rejects(bridge.dispatch(envelope,requestPath,request),ReviewError);assert.equal(called,0);});

test("non-Codex trusted envelopes are unsupported with zero spawn",async()=>{let called=0;const other={...envelope,host:"other"};const bridge=new TrustedReviewDispatcher({load:async()=>({envelope:other,records})} as any,{other:{review:async()=>{called++;return {} as any;}}});await assert.rejects(bridge.dispatch(other,requestPath,request),(e:any)=>e instanceof ReviewError&&e.code==="review-unsupported-host");assert.equal(called,0);});
