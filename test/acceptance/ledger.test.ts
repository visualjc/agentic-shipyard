import assert from "node:assert/strict";
import test from "node:test";
import { evidencePath, persistEvidence } from "../../src/acceptance/ledger.js";
const sha="a".repeat(40), now="2026-08-04T00:00:00.000Z";
test("evidence ledger paths reject traversal and arbitrary document names",()=>{for(const x of [["../d","acceptance.json"],["d","../x.json"],["d","anything.json"]] as const)assert.throws(()=>evidencePath(x[0],x[1]));});
test("persistence validates the record type before it touches a ledger",async()=>{let calls=0;const ledger={snapshot:async()=>{calls++;return {head:undefined,records:{}};},transact:async()=>"x"};await assert.rejects(persistEvidence(ledger as any,"d","acceptance.json",{schemaVersion:1}),/Evidence/);assert.equal(calls,0);const document={schemaVersion:1,issueId:"6",productSha:sha,items:[{id:"x",kind:"acceptance",state:"pass",evidenceRefs:["a.txt"],verifier:"v",verifiedAt:now}]};await persistEvidence(ledger as any,"d","acceptance.json",document);assert.equal(calls,1);});
