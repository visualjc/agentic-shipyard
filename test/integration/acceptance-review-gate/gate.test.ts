import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { persistEvidence } from "../../../src/acceptance/ledger.js";
import { evaluateFreshness } from "../../../src/evidence/freshness.js";
import { issueManifest } from "../../../src/evidence/issue-manifest.js";
import { LedgerError } from "../../../src/ledger/errors.js";

const exec=promisify(execFile), now="2026-08-04T00:00:00.000Z";
async function git(path:string,args:string[]){return (await exec("git",["-C",path,...args],{encoding:"utf8"})).stdout.trim();}
async function repo(){const path=await mkdtemp(join(tmpdir(),"shipyard-acceptance-"));await git(path,["init","-b","main"]);await git(path,["config","user.name","test"]);await git(path,["config","user.email","test@example.test"]);await git(path,["commit","--allow-empty","-m","product"]);return path;}
test("disposable Git pins canonical evidence, rejects stale CAS, and a new product commit invalidates the gate",async()=>{const path=await repo();try{const sha=await git(path,["rev-parse","HEAD"]),ledger=new GitLedgerStore(path);const acceptance={schemaVersion:1 as const,issueId:"6",productSha:sha,items:issueManifest.items.map(i=>({id:i.id,kind:i.kind,state:"pass" as const,evidenceRefs:["logs/test.txt"],verifier:"external",verifiedAt:now}))};const request={schemaVersion:1 as const,issueId:"6",productSha:sha,reviewId:"r",reviewerEnvelopePath:"reviewer.json",intentRefs:["intent.md"],evidenceRefs:["acceptance.json"]};const result={schemaVersion:1 as const,reviewId:"r",productSha:sha,reviewer:"fixture",startedAt:now,finishedAt:now,process:{processId:1,sessionId:"s",fresh:true as const,commandVersion:"codex-test-1",bundleDigest:"b".repeat(64)},findings:[],successful:true};const ledgerSha=await persistEvidence(ledger,"d-6","acceptance.json",acceptance);await persistEvidence(ledger,"d-6","review-request-r.json",request);await persistEvidence(ledger,"d-6","review-result-r.json",result);const pinned=await ledger.read(ledgerSha,["deliveries/d-6/evidence/acceptance.json"]);assert.equal(JSON.parse(pinned["deliveries/d-6/evidence/acceptance.json"]!).productSha,sha);assert.equal(evaluateFreshness({currentProductSha:sha,manifest:issueManifest,acceptance,request,result}).promotionEligible,false);const snap=await ledger.snapshot(["deliveries/d-6/evidence/acceptance.json"]);await assert.rejects(ledger.transact({expectedHead:ledgerSha,writes:[{path:"deliveries/d-6/evidence/other.json",contents:"{}"}]}),(e:unknown)=>e instanceof LedgerError&&e.code==="ledger-stale-head");await git(path,["commit","--allow-empty","-m","new product"]);const changed=await git(path,["rev-parse","HEAD"]);const stale=evaluateFreshness({currentProductSha:changed,manifest:issueManifest,acceptance,request,result});assert.equal(stale.promotionEligible,false);assert.deepEqual(stale.staleRecordIds,["acceptance","review"]);assert.equal((await ledger.read(ledgerSha,["deliveries/d-6/evidence/acceptance.json"]))["deliveries/d-6/evidence/acceptance.json"],snap.records["deliveries/d-6/evidence/acceptance.json"]);}finally{await rm(path,{recursive:true,force:true});}});
