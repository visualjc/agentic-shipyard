import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnvelope } from "../../src/context/envelope.js";
import { ContextReader } from "../../src/context/reader.js";
import { createTrustedCodexReviewOperation } from "../../src/review/factory.js";
import { nodeFilesystem } from "../../src/adapters/filesystem.js";
import { MutationLockError, MutationLockService } from "../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";
import { canonicalJson } from "../../src/evidence/schema.js";

const exec=promisify(execFile);

test("the public factory runs the pinned, locked, child-process review path end to end",async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),"shipyard-review-factory-")));
  try {
    await exec("/usr/bin/git",["-C",root,"init","-b","main"]);await exec("/usr/bin/git",["-C",root,"config","user.name","test"]);await exec("/usr/bin/git",["-C",root,"config","user.email","test@example.test"]);await writeFile(join(root,"review-target.txt"),"pinned code");await exec("/usr/bin/git",["-C",root,"add","review-target.txt"]);await exec("/usr/bin/git",["-C",root,"commit","-m","product"]);const productSha=(await exec("/usr/bin/git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"})).stdout.trim(),initialLedgerSha="b".repeat(40),deliveryId="delivery-arbitrary",issueId="JG-8421",manifest={schemaVersion:1 as const,issueId,items:[{id:"ac-custom",kind:"acceptance" as const}]},manifestBytes=canonicalJson(manifest),manifestDigest=createHash("sha256").update(manifestBytes).digest("hex"),acceptance=canonicalJson({schemaVersion:1,issueId,productSha,items:[{id:"ac-custom",kind:"acceptance",state:"pass",evidenceRefs:[`deliveries/${deliveryId}/proof.txt`],verifier:"test",verifiedAt:"2026-08-04T00:00:00.000Z"}]}),topology={kind:"single-repository" as const,repository:{owner:"acme",name:"widget",remote:{name:"origin",url:"https://example.test/widget.git"},defaultBranch:"main"}},envelopePath=join(root,"reviewer.json"),home=join(root,"codex-home");await mkdir(home);
    const envelope=createEnvelope({host:"codex",role:"reviewer",envelopePath,repoRoot:root,deliveryId,profile:"local",topology,repository:topology.repository,productBranch:`shipyard/${deliveryId}`,objectFormat:"sha1",productSha,ledgerRef:"refs/heads/shipyard-ledger",ledgerSha:initialLedgerSha,evidenceManifestDigest:manifestDigest});
    const expectation={profile:envelope.profile,profileFingerprint:"0".repeat(64),topology:envelope.topology,repository:envelope.repository,deliveryId:envelope.deliveryId,host:envelope.host,role:envelope.role,envelopePath,repoRoot:root,productBranch:envelope.productBranch,objectFormat:envelope.objectFormat,productSha,ledgerRef:envelope.ledgerRef,ledgerSha:initialLedgerSha,evidenceManifestDigest:manifestDigest} as const;
    let head:string|undefined=initialLedgerSha,transacts=0;
    const records:Record<string,string>={[`deliveries/${deliveryId}/intent.md`]:"intent",[`deliveries/${deliveryId}/evidence/manifest.json`]:manifestBytes,[`deliveries/${deliveryId}/evidence/acceptance.json`]:acceptance,[`deliveries/${deliveryId}/review.json`]:"review instructions",[`deliveries/${deliveryId}/proof.txt`]:"proof"};
    const ledger={objectFormat:async()=>"sha1" as const,snapshot:async(paths:readonly string[])=>({head,records:Object.fromEntries(paths.filter(path=>records[path]!==undefined).map(path=>[path,records[path]]))}),read:async(_sha:string,paths:readonly string[])=>Object.fromEntries(paths.filter(path=>records[path]!==undefined).map(path=>[path,records[path]])),transact:async(transaction:any)=>{assert.equal(transaction.expectedHead,head);for(const write of transaction.writes)records[write.path]=write.contents;head=(transacts++===0?"c":"d").repeat(40);return head;}};
    const products={currentProductSha:async()=>productSha},commonDirectory=await realpath(join(root,".git")),context=new ContextReader(expectation,{resolve:async()=>({profileName:"local",profileFingerprint:"0".repeat(64),commonDirectory,actorLogin:"actor",topology})},products,ledger);
    const lockFilesystem=new MemoryFilesystem(),processAdapter=new FakeProcess(),codex={executable:join(process.cwd(),"test","review","helpers","fake-process.mjs"),runtimePath:process.env.PATH!,codeHome:home,model:"test-model",profile:"test-profile"},left=createTrustedCodexReviewOperation({context,products,ledger,mutationLocks:new MutationLockService(lockFilesystem,processAdapter),filesystem:nodeFilesystem,codex}),right=createTrustedCodexReviewOperation({context,products,ledger,mutationLocks:new MutationLockService(lockFilesystem,processAdapter),filesystem:nodeFilesystem,codex});
    const request={schemaVersion:1 as const,issueId,productSha,reviewId:"r",reviewerEnvelopePath:envelopePath,intentRefs:[`deliveries/${deliveryId}/intent.md`],evidenceRefs:[`deliveries/${deliveryId}/evidence/acceptance.json`]},settled=await Promise.allSettled([left.dispatchAndPersist({envelope,request}),right.dispatchAndPersist({envelope,request})]),fulfilled=settled.find((item):item is PromiseFulfilledResult<any>=>item.status==="fulfilled"),rejected=settled.find((item):item is PromiseRejectedResult=>item.status==="rejected");assert.ok(fulfilled);assert.ok(rejected);assert.ok(rejected.reason instanceof MutationLockError&&rejected.reason.code==="lock-held");const result=fulfilled.value;
    assert.equal(result.process.commandVersion,"codex-fixture-1");assert.match(result.process.bundleDigest,/^[a-f0-9]{64}$/);assert.equal(transacts,2);
    const observed=JSON.parse(await readFile(join(home,".fixture-observed.json"),"utf8"));assert.deepEqual(observed.bundle.records,Object.fromEntries(envelope.records.map(path=>[path,records[path]])));assert.equal(observed.reviewTarget,"pinned code");assert.equal(JSON.parse(records[`deliveries/${deliveryId}/evidence/review-result-r.json`]).process.bundleDigest,result.process.bundleDigest);
    let iterated=0;const hostileRefs:any=[];Object.defineProperty(hostileRefs,Symbol.iterator,{value(){iterated++;throw new Error("secret");}});await assert.rejects((left.dispatchAndPersist as any)({envelope,request:{...request,evidenceRefs:hostileRefs}}),error=>!String(error).includes("secret"));assert.equal(iterated,0);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("public review construction rejects accessors without invoking or leaking them",()=>{let touched=0;const dependencies=Object.defineProperty({},"context",{enumerable:true,get(){touched++;throw new Error("secret");}});assert.throws(()=>createTrustedCodexReviewOperation(dependencies as any),error=>!String(error).includes("secret"));assert.equal(touched,0);});
