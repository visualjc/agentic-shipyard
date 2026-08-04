import assert from "node:assert/strict";
import test from "node:test";
import { createTrustedAcceptanceGate } from "../../src/acceptance/gate.js";
import { issueManifest } from "../../src/evidence/issue-manifest.js";
import { canonicalJson } from "../../src/evidence/schema.js";

const productSha="a".repeat(40),head="f".repeat(40),at="2026-08-04T00:00:00.000Z",prefix="deliveries/d/evidence/";
const acceptance={schemaVersion:1 as const,issueId:"6",productSha,items:issueManifest.items.map(item=>({id:item.id,kind:item.kind,state:"pass" as const,evidenceRefs:[`proof/${item.id}.txt`],verifier:"external",verifiedAt:at}))};
const request=(reviewId:string)=>({schemaVersion:1 as const,issueId:"6",productSha,reviewId,reviewerEnvelopePath:"reviewer.json",intentRefs:["intent.md"],evidenceRefs:["acceptance.json"]});
const result=(reviewId:string,findings:any[]=[],time=at)=>({schemaVersion:1 as const,reviewId,productSha,reviewer:"codex",startedAt:time,finishedAt:time,process:{processId:1,sessionId:`s-${reviewId}`,fresh:true as const,commandVersion:"codex-test-1",bundleDigest:"b".repeat(64)},findings,successful:true});
const finding=(disposition:"accepted"|"resolved")=>({id:"f-1",severity:"high" as const,disposition,evidenceRefs:["finding/f-1.txt"],recordedAt:at});
const resolution={schemaVersion:1 as const,findingId:"f-1",reviewId:"r-1",resolvedProductSha:productSha,resolver:"bound-actor",resolvedAt:at,evidenceRefs:["resolution/f-1.txt"]};
const entry=(path:string,document:unknown,ordinal:number)=>({path:`${prefix}${path}`,contents:canonicalJson(document),ordinal});

function fixture(entries:readonly ReturnType<typeof entry>[],overrides:Readonly<{product?:()=>Promise<string>;scope?:()=>Promise<{repoRoot:string;deliveryId:string;commonDirectory:string;actorLogin:string}>}>={}){
  let inventoryReads=0;const cited=new Set(["intent.md","acceptance.json",...acceptance.items.flatMap(item=>item.evidenceRefs),"finding/f-1.txt","resolution/f-1.txt"]),ledger={objectFormat:async()=>"sha1" as const,snapshot:async()=>({head,records:{}}),currentInventory:async(received:string)=>{inventoryReads++;assert.equal(received,prefix);return {head,entries};},read:async(_sha:string,paths:readonly string[])=>Object.fromEntries(paths.filter(path=>cited.has(path)).map(path=>[path,"proof"])),transact:async()=>head};
  const gate=createTrustedAcceptanceGate({context:{authorityScope:overrides.scope??(async()=>({repoRoot:"/repo",deliveryId:"d",commonDirectory:"/repo/.git",actorLogin:"actor"}))} as any,products:{currentProductSha:overrides.product??(async()=>productSha)},ledger,clock:{now:()=>new Date("2026-08-05T00:00:00.000Z")}});return {gate,ledger,inventoryReads:()=>inventoryReads};
}

test("authority-bound gate derives current authorities and rejects every per-call authority forgery",async()=>{
  const current=result("r-1"),configured=fixture([entry("acceptance.json",acceptance,1),entry("review-request-r-1.json",request("r-1"),2),entry("review-result-r-1.json",current,3)]),alternate=fixture([]);assert.equal((await configured.gate.evaluate()).promotionEligible,true);
  for(const forged of [{manifest:{issueId:"6",items:[issueManifest.items[0]]}},{ledgerSha:"0".repeat(40)},{ledger:alternate.ledger},{priorResults:[]}])await assert.rejects((configured.gate.evaluate as any)(forged));
  assert.equal(alternate.inventoryReads(),0);
});

test("complete inventory prevents an omitted accepted finding from being hidden",async()=>{
  const configured=fixture([entry("acceptance.json",acceptance,1),entry("review-request-r-1.json",request("r-1"),2),entry("review-result-r-1.json",result("r-1",[finding("accepted")]),3),entry("review-request-r-2.json",request("r-2"),4),entry("review-result-r-2.json",result("r-2"),5)]),decision=await configured.gate.evaluate();assert.equal(decision.promotionEligible,false);assert.deepEqual(decision.blockingFindingIds,["f-1"]);
});

test("ledger ordinals, not caller time, prove resolution and renewed-review ordering",async()=>{
  const configured=fixture([entry("acceptance.json",acceptance,1),entry("review-request-r-1.json",request("r-1"),2),entry("review-result-r-1.json",result("r-1",[finding("accepted")]),3),entry("finding-resolution-f-1.json",resolution,4),entry("review-request-r-2.json",request("r-2"),5),entry("review-result-r-2.json",result("r-2",[finding("resolved")]),6)]);assert.equal((await configured.gate.evaluate()).promotionEligible,true);
  const future=fixture([entry("acceptance.json",acceptance,1),entry("review-request-r-1.json",request("r-1"),2),entry("review-result-r-1.json",result("r-1",[],"2099-01-01T00:00:00.000Z"),3),entry("review-request-r-2.json",request("r-2"),4),entry("review-result-r-2.json",result("r-2"),5)]);await assert.rejects(future.gate.evaluate());
});

test("hostile nested construction and iterable hooks are rejected without invocation or leakage",async()=>{let touched=0;const dependencies=Object.defineProperty({},"context",{enumerable:true,get(){touched++;throw new Error("secret");}});assert.throws(()=>createTrustedAcceptanceGate(dependencies as any),error=>!String(error).includes("secret"));const configured=fixture([entry("acceptance.json",acceptance,1),entry("review-request-r-1.json",request("r-1"),2),entry("review-result-r-1.json",result("r-1"),3)]),hostile={[Symbol.iterator](){touched++;throw new Error("secret");}};await assert.rejects((configured.gate.evaluate as any)(hostile),error=>!String(error).includes("secret"));assert.equal(touched,0);});

test("product or bound-authority drift during evaluation fails closed",async()=>{const entries=[entry("acceptance.json",acceptance,1),entry("review-request-r-1.json",request("r-1"),2),entry("review-result-r-1.json",result("r-1"),3)];let productReads=0;await assert.rejects(fixture(entries,{product:async()=>++productReads===1?productSha:"c".repeat(40)}).gate.evaluate());let scopeReads=0;await assert.rejects(fixture(entries,{scope:async()=>({repoRoot:"/repo",deliveryId:"d",commonDirectory:"/repo/.git",actorLogin:++scopeReads===1?"actor":"changed"})}).gate.evaluate());});
