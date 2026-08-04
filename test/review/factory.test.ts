import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnvelope } from "../../src/context/envelope.js";
import { ContextReader } from "../../src/context/reader.js";
import { createTrustedCodexReviewOperation } from "../../src/review/factory.js";

test("the public factory runs the pinned, locked, child-process review path end to end",async()=>{
  const root=await mkdtemp(join(tmpdir(),"shipyard-review-factory-"));
  try {
    const productSha="a".repeat(40),initialLedgerSha="b".repeat(40),topology={kind:"single-repository" as const,repository:{owner:"acme",name:"widget",remote:{name:"origin",url:"https://example.test/widget.git"},defaultBranch:"main"}},envelopePath=join(root,"reviewer.json");
    const envelope=createEnvelope({host:"codex",role:"reviewer",envelopePath,repoRoot:root,deliveryId:"d",profile:"local",topology,repository:topology.repository,productBranch:"shipyard/d",objectFormat:"sha1",productSha,ledgerRef:"refs/heads/shipyard-ledger",ledgerSha:initialLedgerSha});
    const expectation={profile:envelope.profile,profileFingerprint:"0".repeat(64),topology:envelope.topology,repository:envelope.repository,deliveryId:envelope.deliveryId,host:envelope.host,role:envelope.role,envelopePath,repoRoot:root,productBranch:envelope.productBranch,objectFormat:envelope.objectFormat,productSha,ledgerRef:envelope.ledgerRef,ledgerSha:initialLedgerSha} as const;
    let head:string|undefined=initialLedgerSha,transacts=0,acquires=0,releases=0;
    const records:Record<string,string>=Object.fromEntries(envelope.records.map(path=>[path,`sealed ${path}`]));
    const ledger={objectFormat:async()=>"sha1" as const,snapshot:async(paths:readonly string[])=>({head,records:Object.fromEntries(paths.filter(path=>records[path]!==undefined).map(path=>[path,records[path]]))}),read:async(_sha:string,paths:readonly string[])=>Object.fromEntries(paths.filter(path=>records[path]!==undefined).map(path=>[path,records[path]])),transact:async(transaction:any)=>{assert.equal(transaction.expectedHead,head);for(const write of transaction.writes)records[write.path]=write.contents;head=(transacts++===0?"c":"d").repeat(40);return head;}};
    const products={currentProductSha:async()=>productSha},context=new ContextReader(expectation,{resolve:async()=>({profileName:"local",profileFingerprint:"0".repeat(64),commonDirectory:join(root,".git"),actorLogin:"actor",topology})},products,ledger);
    const mutationLocks={acquire:async(path:string,repository:string,operation:string)=>{acquires++;assert.equal(path,join(root,"review.lock"));assert.equal(repository,root);assert.match(operation,/^independent-review:d:r$/);return {record:{},release:async()=>{releases++;}};}};
    const operation=createTrustedCodexReviewOperation({context,products,ledger,mutationLocks:mutationLocks as any,mutationLockPath:join(root,"review.lock"),codex:{executable:join(process.cwd(),"test","review","helpers","fake-process.mjs"),runtimePath:process.env.PATH!,codeHome:root,model:"test-model",profile:"test-profile"}});
    const request={schemaVersion:1 as const,issueId:"6",productSha,reviewId:"r",reviewerEnvelopePath:envelopePath,intentRefs:["intent.md"],evidenceRefs:["acceptance.json"]},result=await operation.dispatchAndPersist({repoRoot:root,deliveryId:"d",envelope,request});
    assert.equal(result.process.commandVersion,"codex-fixture-1");assert.match(result.process.bundleDigest,/^[a-f0-9]{64}$/);assert.equal(acquires,1);assert.equal(releases,1);assert.equal(transacts,2);
    const observed=JSON.parse(await readFile(join(root,".fixture-observed.json"),"utf8"));assert.deepEqual(observed.bundle.records,Object.fromEntries(envelope.records.map(path=>[path,`sealed ${path}`])));assert.equal(JSON.parse(records["deliveries/d/evidence/review-result-r.json"]).process.bundleDigest,result.process.bundleDigest);
  } finally { await rm(root,{recursive:true,force:true}); }
});
