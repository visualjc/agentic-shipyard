import assert from "node:assert/strict";
import test from "node:test";
import { TrustedReviewDispatcher } from "../../src/review/dispatch.js";
import { ReviewError } from "../../src/review/errors.js";
const sha="a".repeat(40), request={schemaVersion:1 as const,issueId:"6",productSha:sha,reviewId:"r",reviewerEnvelopePath:"reviewer.json",intentRefs:["intent.md"],evidenceRefs:["acceptance.json"]};
const envelope:any={role:"reviewer",host:"codex",productSha:sha,adapter:{envelopePath:"reviewer.json",repoRoot:"/repo"}};
test("trusted dispatch loads the pinned reviewer context before adapter invocation",async()=>{let loaded=0,called=0;const bridge=new TrustedReviewDispatcher({load:async()=>{loaded++;return {envelope,records:{}};}} as any,{codex:{review:async()=>{called++;return {result:{},attestation:{}} as any;}}});await bridge.dispatch(envelope,"request.json",request);assert.equal(loaded,1);assert.equal(called,1);});
test("stale/wrong-role context rejects before adapter invocation",async()=>{let called=0;for(const changed of [{...envelope,role:"implementer"},{...envelope,productSha:"b".repeat(40)}]){const bridge=new TrustedReviewDispatcher({load:async()=>({envelope:changed,records:{}})} as any,{codex:{review:async()=>{called++;return {} as any;}}});await assert.rejects(bridge.dispatch(changed,"request.json",request),ReviewError);}assert.equal(called,0);});
