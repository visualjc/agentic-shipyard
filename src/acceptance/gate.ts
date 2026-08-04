import type { ContextReader } from "../context/reader.js";
import type { PinnedLedgerReader, ProductShaReader } from "../context/types.js";
import type { LedgerInventoryEntry, LedgerInventoryReader, LedgerStore } from "../ledger/types.js";
import type { AcceptanceEvidence, EvidenceDecision, FindingResolution, ReviewRequest, ReviewResult } from "../evidence/types.js";
import { canonicalJson, validateAcceptanceEvidence, validateFindingResolution, validateReviewRequest, validateReviewResult } from "../evidence/schema.js";
import { evaluateFreshness, type EvidenceSequence } from "../evidence/freshness.js";
import { issueManifest } from "../evidence/issue-manifest.js";
import { EvidenceError } from "../evidence/errors.js";

export interface EvidenceClock { now():Date; }
export type TrustedAcceptanceGateDependencies=Readonly<{context:ContextReader;products:ProductShaReader;ledger:LedgerStore & PinnedLedgerReader & LedgerInventoryReader;clock?:EvidenceClock}>;
export interface TrustedAcceptanceGate { evaluate(...input:readonly never[]):Promise<EvidenceDecision>; }
const CODE_OWNED_REFERENCE_FILES=Object.freeze(["intent.md","acceptance.json"]),CODE_OWNED_REFERENCE_PREFIXES=Object.freeze(["evidence/","logs/","proof/","finding/","resolution/"]);

/** Constructs the only promotion-authoritative evidence evaluator. Authorities are fixed for its lifetime. */
export function createTrustedAcceptanceGate(rawDependencies:TrustedAcceptanceGateDependencies):TrustedAcceptanceGate{
  const dependencies=construction(rawDependencies,["context","products","ledger","clock"],["clock"]),context=dependencies.context as ContextReader,products=dependencies.products as ProductShaReader,ledger=dependencies.ledger as LedgerStore & PinnedLedgerReader & LedgerInventoryReader,clock=(dependencies.clock as EvidenceClock|undefined)??Object.freeze({now:()=>new Date()});
  return Object.freeze({async evaluate(...input:readonly unknown[]){try{if(input.length!==0)invalid();return await evaluateBound(context,products,ledger,clock);}catch{throw new EvidenceError("evidence-invalid","Trusted acceptance evidence could not be validated from current authorities.");}}});
}

async function evaluateBound(context:ContextReader,products:ProductShaReader,ledger:LedgerStore & PinnedLedgerReader & LedgerInventoryReader,clock:EvidenceClock):Promise<EvidenceDecision>{
  const scope=authorityScope(await context.authorityScope());
  const currentProductSha=await products.currentProductSha(scope.repoRoot),prefix=`deliveries/${scope.deliveryId}/evidence/`,before=ledgerSnapshot(await ledger.snapshot([])),inventory=ledgerInventory(await ledger.currentInventory(prefix));
  if(!fullSha(currentProductSha)||!before.head||inventory.head!==before.head||!fullSha(inventory.head))invalid();
  const entries=(inventory.entries as readonly LedgerInventoryEntry[]).map(entry=>inventoryEntry(entry,prefix)),byPath=new Map(entries.map(entry=>[entry.path,entry]));
  if(byPath.size!==entries.length)invalid();
  const acceptanceEntry=byPath.get(`${prefix}acceptance.json`);if(!acceptanceEntry)invalid();
  const acceptance=record(acceptanceEntry,validateAcceptanceEvidence),requests=new Map<string,{document:ReviewRequest;ordinal:number}>(),results=new Map<string,{document:ReviewResult;ordinal:number}>(),resolutions: Array<{document:FindingResolution;ordinal:number}>=[];
  for(const entry of entries){
    let match:RegExpExecArray|null;
    if((match=new RegExp(`^${escape(prefix)}review-request-([A-Za-z0-9-]+)\\.json$`).exec(entry.path))){const document=record(entry,validateReviewRequest);if(document.reviewId!==match[1]||requests.has(document.reviewId))invalid();requests.set(document.reviewId,{document,ordinal:entry.ordinal});continue;}
    if((match=new RegExp(`^${escape(prefix)}review-result-([A-Za-z0-9-]+)\\.json$`).exec(entry.path))){const document=record(entry,validateReviewResult);if(document.reviewId!==match[1]||results.has(document.reviewId))invalid();results.set(document.reviewId,{document,ordinal:entry.ordinal});continue;}
    if((match=new RegExp(`^${escape(prefix)}finding-resolution-([A-Za-z0-9-]+)\\.json$`).exec(entry.path))){const document=record(entry,validateFindingResolution);if(document.findingId!==match[1])invalid();resolutions.push({document,ordinal:entry.ordinal});}
  }
  if(results.size===0)invalid();
  for(const [reviewId,result] of results){const request=requests.get(reviewId);if(!request||request.ordinal>=result.ordinal)invalid();}
  for(const resolution of resolutions){const reviewed=results.get(resolution.document.reviewId);if(!reviewed||resolution.ordinal<=reviewed.ordinal)invalid();}
  const ordered=[...results.values()].sort((left,right)=>left.ordinal-right.ordinal);if(ordered.some((entry,index)=>index>0&&entry.ordinal===ordered[index-1]!.ordinal))invalid();
  const current=ordered.at(-1)!,currentRequest=requests.get(current.document.reviewId)!;
  const now=trustedNow(clock);for(const review of ordered)if(review.document.reviewer!=="codex"||Date.parse(review.document.startedAt)>now||Date.parse(review.document.finishedAt)>now)invalid();for(const resolution of resolutions)if(Date.parse(resolution.document.resolvedAt)>now)invalid();
  const citations=[...acceptance.items.flatMap(item=>item.evidenceRefs),...[...requests.values()].flatMap(({document})=>[...document.intentRefs,...document.evidenceRefs]),...ordered.flatMap(({document})=>document.findings.flatMap(finding=>finding.evidenceRefs)),...resolutions.flatMap(({document})=>document.evidenceRefs)];
  if(citations.length===0||citations.some(ref=>!allowedEvidenceRef(scope.deliveryId,ref)))invalid();
  const refs=[...new Set(citations)].sort(),resolved=ledgerRecords(await ledger.read(inventory.head,refs),refs);if(refs.some(ref=>typeof resolved[ref]!=="string"))invalid();
  const after=ledgerSnapshot(await ledger.snapshot([])),finalScope=authorityScope(await context.authorityScope());if(after.head!==inventory.head||await products.currentProductSha(scope.repoRoot)!==currentProductSha||!sameAuthorityScope(scope,finalScope))invalid();
  const sequence:EvidenceSequence={reviews:ordered.map(({document,ordinal})=>({reviewId:document.reviewId,ordinal})),resolutions:resolutions.map(({document,ordinal})=>({reviewId:document.reviewId,findingId:document.findingId,ordinal}))};
  const reviewedAfterAcceptance=current.ordinal>acceptanceEntry.ordinal;
  const advisory=evaluateFreshness({currentProductSha,manifest:issueManifest,acceptance,request:currentRequest.document,result:reviewedAfterAcceptance?current.document:undefined,priorResults:(reviewedAfterAcceptance?ordered.slice(0,-1):ordered).map(entry=>entry.document),resolutions:resolutions.map(entry=>entry.document),declaredEvidenceRefs:refs,sequence});
  const eligible=reviewedAfterAcceptance&&advisory.acceptanceFresh&&advisory.reviewFresh&&advisory.blockers.length===0&&advisory.blockingFindingIds.length===0;
  return Object.freeze({...advisory,promotionEligible:eligible,nextAction:eligible?"proceed-to-promotion-gate":advisory.nextAction});
}

function record<T>(entry:LedgerInventoryEntry,validator:(input:unknown)=>T):T{let parsed:unknown;try{parsed=JSON.parse(entry.contents);}catch{invalid();}const document=validator(parsed);if(canonicalJson(document)!==entry.contents)invalid();return document;}
function inventoryEntry(raw:LedgerInventoryEntry,prefix:string):LedgerInventoryEntry{const entry=snapshot(raw);if(!entry||typeof entry!=="object"||Object.keys(entry).sort().join(",")!=="contents,ordinal,path"||typeof entry.path!=="string"||!entry.path.startsWith(prefix)||!safePath(entry.path)||typeof entry.contents!=="string"||!Number.isSafeInteger(entry.ordinal)||entry.ordinal<=0)invalid();return Object.freeze(entry as LedgerInventoryEntry);}
function authorityScope(raw:unknown):Readonly<{repoRoot:string;deliveryId:string;commonDirectory:string;actorLogin:string}>{const scope:any=snapshot(raw);if(!scope||typeof scope!=="object"||Object.keys(scope).sort().join(",")!=="actorLogin,commonDirectory,deliveryId,repoRoot"||typeof scope.repoRoot!=="string"||scope.repoRoot.trim()===""||!safeId(scope.deliveryId)||typeof scope.commonDirectory!=="string"||scope.commonDirectory.trim()===""||typeof scope.actorLogin!=="string"||scope.actorLogin.trim()==="")invalid();return Object.freeze(scope);}
function ledgerSnapshot(raw:unknown):Readonly<{head?:string;records:Readonly<Record<string,string>>}>{const value:any=snapshot(raw),keys=value&&typeof value==="object"?Object.keys(value).sort().join(","):"";if(!value||typeof value!=="object"||(keys!=="records"&&keys!=="head,records")||(value.head!==undefined&&!fullSha(value.head))||!value.records||typeof value.records!=="object"||Array.isArray(value.records)||Object.getPrototypeOf(value.records)!==Object.prototype)invalid();return Object.freeze(value);}
function ledgerInventory(raw:unknown):Readonly<{head:string;entries:readonly LedgerInventoryEntry[]}>{const value:any=snapshot(raw);if(!value||typeof value!=="object"||Object.keys(value).sort().join(",")!=="entries,head"||!fullSha(value.head)||!Array.isArray(value.entries))invalid();return Object.freeze(value);}
function ledgerRecords(raw:unknown,expected:readonly string[]):Readonly<Record<string,string>>{const value:any=snapshot(raw);if(!value||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==expected.length||Object.keys(value).some(key=>!expected.includes(key))||Object.values(value).some(contents=>typeof contents!=="string"))invalid();return Object.freeze(value);}
function snapshot<T>(value:T):T{try{return JSON.parse(canonicalJson(value));}catch{invalid();}}
function construction(value:unknown,allowed:readonly string[],optional:readonly string[]):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();const out:Record<string,unknown>={};for(const key of Reflect.ownKeys(value)){if(typeof key!=="string"||!allowed.includes(key))invalid();const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!descriptor.enumerable||!("value" in descriptor))invalid();out[key]=descriptor.value;}if(allowed.some(key=>!optional.includes(key)&&!(key in out)))invalid();return out;}
function trustedNow(clock:EvidenceClock):number{let date:Date;try{date=clock.now();}catch{invalid();}if(!(date instanceof Date)||!Number.isFinite(date.getTime()))invalid();return date.getTime();}
function sameAuthorityScope(left:Readonly<{repoRoot:string;deliveryId:string;commonDirectory:string;actorLogin:string}>,right:Readonly<{repoRoot:string;deliveryId:string;commonDirectory:string;actorLogin:string}>):boolean{return left.repoRoot===right.repoRoot&&left.deliveryId===right.deliveryId&&left.commonDirectory===right.commonDirectory&&left.actorLogin===right.actorLogin;}
function allowedEvidenceRef(deliveryId:string,ref:string):boolean{return safePath(ref)&&(CODE_OWNED_REFERENCE_FILES.includes(ref)||CODE_OWNED_REFERENCE_PREFIXES.some(prefix=>ref.startsWith(prefix))||ref.startsWith(`deliveries/${deliveryId}/`));}
function safePath(path:string):boolean{return path.length>0&&!path.startsWith("/")&&!path.includes("\\")&&!path.split("/").some(part=>part===""||part==="."||part==="..");}
function safeId(value:string):boolean{return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value);}
function fullSha(value:unknown):value is string{return typeof value==="string"&&(/^[a-f0-9]{40}$/.test(value)||/^[a-f0-9]{64}$/.test(value));}
function escape(value:string):string{return value.replace(/[|\\{}()[\]^$+*?.-]/g,"\\$&");}
function invalid():never{throw new EvidenceError("evidence-invalid","Trusted acceptance evidence is invalid.");}
