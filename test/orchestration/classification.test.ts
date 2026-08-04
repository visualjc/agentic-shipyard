import assert from "node:assert/strict";
import test from "node:test";
import { classifyLane, createLaneRecord } from "../../src/orchestration/classification.js";

const reason=[{code:"user-stated",evidence:"recorded request"}];
test("classifies explicit planning lanes with their constrained sequences",()=>{
 assert.deepEqual(classifyLane({kind:"feature",scope:"foggy",requirements:"compatible",reasons:reason}).planningSequence,["wayfinder","ccpm-prd","ccpm-vertical-tasks"]);
 assert.deepEqual(classifyLane({kind:"feature",scope:"settled",requirements:"compatible",reasons:reason}).planningSequence,["grill-with-docs","to-spec"]);
 assert.deepEqual(classifyLane({kind:"bug",scope:"settled",requirements:"compatible",regression:"proven",reasons:reason}).planningSequence,["diagnosing-bugs"]);
 assert.deepEqual(classifyLane({kind:"review",scope:"settled",requirements:"compatible",requestedHead:"a".repeat(40),reasons:reason}).planningSequence,["scoped-review"]);
});
test("ambiguity and requirement conflict do not fabricate a delivery path",()=>{
 const fog=classifyLane({kind:"feature",scope:"unknown",requirements:"compatible",reasons:reason});assert.equal(fog.disposition,"needs-wayfinding");assert.equal(fog.nextSafeAction,"wayfinder");
 const conflict=classifyLane({kind:"bug",scope:"settled",requirements:"conflicting",regression:"proven",reasons:reason});assert.equal(conflict.disposition,"needs-grilling");assert.equal(conflict.nextSafeAction,"grilling");
 const unproven=classifyLane({kind:"bug",scope:"settled",requirements:"compatible",regression:"unproven",reasons:reason});assert.equal(unproven.disposition,"ready");assert.deepEqual(unproven.planningSequence,["diagnosing-bugs"]);
});
test("classification snapshots reject getters, proxies, sparse arrays and unknown keys",()=>{
 const getter:any={};Object.defineProperty(getter,"kind",{enumerable:true,get(){throw new Error("leak");}});assert.throws(()=>classifyLane(getter));
 const sparse:any[]=[];sparse[1]={code:"x",evidence:"y"};assert.throws(()=>classifyLane({kind:"bug",scope:"settled",requirements:"compatible",reasons:sparse}));
 assert.throws(()=>classifyLane({kind:"bug",scope:"settled",requirements:"compatible",reasons:reason,authority:"forged"}));
 assert.throws(()=>classifyLane(new Proxy({}, {ownKeys(){throw new Error("trap");}})));
 const hidden:any={kind:"bug",scope:"settled",requirements:"compatible",reasons:reason};Object.defineProperty(hidden,"regression",{value:"proven",enumerable:false});assert.throws(()=>classifyLane(hidden));
});
test("never coerces hostile head or decision values",()=>{
 const hostile={toString(){throw new Error("coerced");},[Symbol.toPrimitive](){throw new Error("coerced");}};
 assert.throws(()=>classifyLane({kind:"review",scope:"settled",requirements:"compatible",requestedHead:hostile,reasons:reason}));
 const values:any[]=[];Object.defineProperty(values,"0",{value:{code:"x",evidence:"y"},enumerable:false});values.length=1;assert.throws(()=>classifyLane({kind:"bug",scope:"settled",requirements:"compatible",reasons:values}));
});
test("requires recorded evidence and exact review heads",()=>{
 assert.throws(()=>classifyLane({kind:"feature",scope:"settled",requirements:"compatible",reasons:[]}));
 assert.throws(()=>classifyLane({kind:"review",scope:"settled",requirements:"compatible",requestedHead:"pr/12",reasons:reason}));
 for(const length of [40,64]) assert.equal(classifyLane({kind:"review",scope:"settled",requirements:"compatible",requestedHead:"a".repeat(length),reasons:reason}).lane,"review-only");
 for(const head of ["a".repeat(39),"a".repeat(41),"a".repeat(63),"a".repeat(65),"A".repeat(40),"g".repeat(40)]) assert.throws(()=>classifyLane({kind:"review",scope:"settled",requirements:"compatible",requestedHead:head,reasons:reason}));
});
test("lane records are frozen, detached snapshots with one safe next action",()=>{
 const record=createLaneRecord({recordId:"lane-1",decision:classifyLane({kind:"feature",scope:"settled",requirements:"compatible",reasons:reason}),dependencyStates:[{dependency:"matt-skills",state:"ready"}]});
 assert.equal(record.phase,"classified");assert.equal(record.nextSafeAction,"grill-with-docs");assert.ok(Object.isFrozen(record));assert.throws(()=>createLaneRecord({recordId:"../../bad",decision:record.decision,dependencyStates:[]}));
});
