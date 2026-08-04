import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTrustedAcceptanceGate } from "../../src/acceptance/gate.js";
import { MAX_CONTEXT_AGGREGATE_BYTES, MAX_LEDGER_RECORD_BYTES } from "../../src/evidence/limits.js";
import { canonicalJson } from "../../src/evidence/schema.js";

const productSha="a".repeat(40),head="f".repeat(40),at="2026-08-04T00:00:00.000Z",deliveryId="d",prefix=`deliveries/${deliveryId}/evidence/`,intentPath=`deliveries/${deliveryId}/intent.md`,acceptancePath=`${prefix}acceptance.json`;
const manifest={schemaVersion:1 as const,issueId:"JG-8421",items:[{id:"future-contract",kind:"acceptance" as const}]},manifestBytes=canonicalJson(manifest),manifestDigest=createHash("sha256").update(manifestBytes).digest("hex");
const acceptance={schemaVersion:1 as const,issueId:manifest.issueId,productSha,items:manifest.items.map(item=>({id:item.id,kind:item.kind,state:"pass" as const,evidenceRefs:[`proof/${item.id}.txt`],verifier:"external",verifiedAt:at}))};
const request=(reviewId:string,issueId=manifest.issueId)=>({schemaVersion:1 as const,issueId,productSha,reviewId,reviewerEnvelopePath:"reviewer.json",intentRefs:[intentPath],evidenceRefs:[acceptancePath],reviewedLedgerSha:head,manifestDigest,acceptanceDigest:createHash("sha256").update(canonicalJson(acceptance)).digest("hex")});
const result=(reviewId:string,findings:any[]=[],time=at)=>({schemaVersion:1 as const,reviewId,productSha,reviewer:"codex",startedAt:time,finishedAt:time,process:{processId:1,sessionId:`s-${reviewId}`,fresh:true as const,commandVersion:"codex-test-1",bundleDigest:"b".repeat(64)},findings,successful:true});
const finding=(disposition:"accepted"|"resolved")=>({id:"f-1",severity:"high" as const,disposition,evidenceRefs:["finding/f-1.txt"],recordedAt:at});
const resolution={schemaVersion:1 as const,findingId:"f-1",reviewId:"r-1",resolvedProductSha:productSha,resolver:"bound-actor",resolvedAt:at,evidenceRefs:["resolution/f-1.txt"]};
const entry=(path:string,document:unknown,ordinal:number)=>({path:`${prefix}${path}`,contents:typeof document==="string"?document:canonicalJson(document),ordinal});
const baseline=(...rest:readonly ReturnType<typeof entry>[])=>[entry("manifest.json",manifest,1),entry("acceptance.json",acceptance,2),...rest];

type Scope=Readonly<{repoRoot:string;deliveryId:string;commonDirectory:string;actorLogin:string;evidenceManifestDigest:string}>;
function fixture(entries:readonly ReturnType<typeof entry>[],overrides:Readonly<{product?:()=>Promise<string>;scope?:()=>Promise<Scope>;acceptance?:typeof acceptance}>= {}){
  let inventoryReads=0;
  const currentAcceptance=overrides.acceptance??acceptance,cited=new Set([intentPath,`${prefix}manifest.json`,acceptancePath,...currentAcceptance.items.flatMap(item=>item.evidenceRefs),"finding/f-1.txt","resolution/f-1.txt"]);
  const ledger={objectFormat:async()=>"sha1" as const,snapshot:async()=>({head,records:{}}),currentInventory:async(received:string)=>{inventoryReads++;assert.equal(received,prefix);return {head,entries};},read:async(_sha:string,paths:readonly string[])=>Object.fromEntries(paths.filter(path=>cited.has(path)).map(path=>[path,path===`${prefix}manifest.json`?manifestBytes:path===acceptancePath?canonicalJson(currentAcceptance):"proof"])),transact:async()=>head};
  const gate=createTrustedAcceptanceGate({context:{authorityScope:overrides.scope??(async()=>({repoRoot:"/repo",deliveryId,commonDirectory:"/repo/.git",actorLogin:"actor",evidenceManifestDigest:manifestDigest}))} as any,products:{currentProductSha:overrides.product??(async()=>productSha)},ledger,clock:{now:()=>new Date("2026-08-05T00:00:00.000Z")}});
  return {gate,ledger,inventoryReads:()=>inventoryReads};
}

test("authority-bound gate derives an arbitrary pinned manifest and rejects per-call authority forgery",async()=>{
  const configured=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1"),4))),alternate=fixture([]);
  assert.equal((await configured.gate.evaluate()).promotionEligible,true);
  for(const forged of [{manifest:{issueId:"6",items:[]}},{ledgerSha:"0".repeat(40)},{ledger:alternate.ledger},{priorResults:[]}])await assert.rejects((configured.gate.evaluate as any)(forged));
  assert.equal(alternate.inventoryReads(),0);
});

test("missing, unpinned, tampered, and cross-issue manifests fail closed",async()=>{
  const reviewEntries=[entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1"),4)];
  await assert.rejects(fixture([entry("acceptance.json",acceptance,2),...reviewEntries]).gate.evaluate());
  await assert.rejects(fixture(baseline(...reviewEntries),{scope:async()=>({repoRoot:"/repo",deliveryId,commonDirectory:"/repo/.git",actorLogin:"actor",evidenceManifestDigest:"0".repeat(64)})}).gate.evaluate());
  const tampered={...manifest,issueId:"JG-8422"},tamperedEntries=[entry("manifest.json",tampered,1),entry("acceptance.json",{...acceptance,issueId:"JG-8422"},2),entry("review-request-r-1.json",request("r-1","JG-8422"),3),entry("review-result-r-1.json",result("r-1"),4)];
  await assert.rejects(fixture(tamperedEntries).gate.evaluate());
  await assert.rejects(fixture(baseline(entry("review-request-r-1.json",request("r-1","JG-wrong"),3),entry("review-result-r-1.json",result("r-1"),4))).gate.evaluate());
});

test("complete inventory prevents an omitted accepted finding from being hidden",async()=>{
  const configured=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1",[finding("accepted")]),4),entry("review-request-r-2.json",request("r-2"),5),entry("review-result-r-2.json",result("r-2"),6))),decision=await configured.gate.evaluate();
  assert.equal(decision.promotionEligible,false);assert.deepEqual(decision.blockingFindingIds,["f-1"]);
});

test("ledger ordinals, not caller time, prove resolution and renewed-review ordering",async()=>{
  const configured=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1",[finding("accepted")]),4),entry("finding-resolution-f-1.json",resolution,5),entry("review-request-r-2.json",request("r-2"),6),entry("review-result-r-2.json",result("r-2",[finding("resolved")]),7)));
  assert.equal((await configured.gate.evaluate()).promotionEligible,true);
  const future=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1",[],"2099-01-01T00:00:00.000Z"),4),entry("review-request-r-2.json",request("r-2"),5),entry("review-result-r-2.json",result("r-2"),6)));
  await assert.rejects(future.gate.evaluate());
});

test("a same-SHA acceptance renewal stales A1 review, while a renewed A2 request/result is eligible",async()=>{
  const a1=acceptance,a2={...acceptance,items:acceptance.items.map(item=>({...item,verifier:"renewed-verifier"}))},a1Request={...request("a1"),acceptanceDigest:createHash("sha256").update(canonicalJson(a1)).digest("hex")},a2Request={...request("a2"),acceptanceDigest:createHash("sha256").update(canonicalJson(a2)).digest("hex")};
  const stale=fixture([entry("manifest.json",manifest,1),entry("acceptance.json",a2,5),entry("review-request-a1.json",a1Request,3),entry("review-result-a1.json",result("a1"),4)],{acceptance:a2});
  const staleDecision=await stale.gate.evaluate();assert.equal(staleDecision.promotionEligible,false);assert.equal(staleDecision.reviewFresh,false);assert.ok(staleDecision.blockers.includes("review-stale"));
  const renewed=fixture([entry("manifest.json",manifest,1),entry("acceptance.json",a2,5),entry("review-request-a2.json",a2Request,6),entry("review-result-a2.json",result("a2"),7)],{acceptance:a2});
  assert.equal((await renewed.gate.evaluate()).promotionEligible,true);
});

test("oversized inventory records and aggregate histories fail before proof reads",async()=>{
  let reads=0;
  const oversized=entry("unknown.txt","x".repeat(MAX_LEDGER_RECORD_BYTES+1),5),single=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1"),4),oversized));
  single.ledger.read=async()=>{reads++;return {};};await assert.rejects(single.gate.evaluate());
  const chunk="x".repeat(Math.floor(MAX_CONTEXT_AGGREGATE_BYTES/3)+1),aggregate=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1"),4),entry("extra-a.txt",chunk,5),entry("extra-b.txt",chunk,6),entry("extra-c.txt",chunk,7)));
  aggregate.ledger.read=async()=>{reads++;return {};};await assert.rejects(aggregate.gate.evaluate());assert.equal(reads,0);
});

test("hostile nested construction and iterable hooks are rejected without invocation or leakage",async()=>{let touched=0;const dependencies=Object.defineProperty({},"context",{enumerable:true,get(){touched++;throw new Error("secret");}});assert.throws(()=>createTrustedAcceptanceGate(dependencies as any),error=>!String(error).includes("secret"));const configured=fixture(baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1"),4))),hostile={[Symbol.iterator](){touched++;throw new Error("secret");}};await assert.rejects((configured.gate.evaluate as any)(hostile),error=>!String(error).includes("secret"));assert.equal(touched,0);});

test("product or bound-authority drift during evaluation fails closed",async()=>{const entries=baseline(entry("review-request-r-1.json",request("r-1"),3),entry("review-result-r-1.json",result("r-1"),4));let productReads=0;await assert.rejects(fixture(entries,{product:async()=>++productReads===1?productSha:"c".repeat(40)}).gate.evaluate());let scopeReads=0;await assert.rejects(fixture(entries,{scope:async()=>({repoRoot:"/repo",deliveryId,commonDirectory:"/repo/.git",actorLogin:++scopeReads===1?"actor":"changed",evidenceManifestDigest:manifestDigest})}).gate.evaluate());});
