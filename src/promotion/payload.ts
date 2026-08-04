import { createHash } from "node:crypto";
import type { PathOwner } from "../contracts/types.js";
import { canonicalJson } from "../evidence/schema.js";
import { PromotionError } from "./errors.js";
import type { ClassifiedTreeEntry, GitTreeEntry, PayloadPlan } from "./types.js";

const MODES = new Set(["100644", "100755", "120000", "160000"]);
const PROHIBITED = [".git", ".shipyard", ".graphs", ".ccpm", ".codex", ".claude", ".cursor", "shipyard-ledger"];

export type PayloadClassification = Readonly<{ source: ReadonlyMap<string, PathOwner>; destination: ReadonlyMap<string, PathOwner> }>;

/** Canonical product projection: source-owned product plus destination-owned baseline. */
export function createPayloadPlan(input: Readonly<{sourceSha:string;parentDestinationSha:string;sourceEntries:readonly GitTreeEntry[];destinationEntries:readonly GitTreeEntry[];classification:PayloadClassification}>):PayloadPlan {
  const source=entries(input.sourceEntries,"development"),destination=entries(input.destinationEntries,"destination");
  const classified:ClassifiedTreeEntry[]=[];const product:GitTreeEntry[]=[];const preserved:GitTreeEntry[]=[];const removed:string[]=[];
  for(const entry of source){const owner=ownerFor(input.classification.source,entry.path);if(owner==="product")rejectProhibited(entry.path);classified.push({...entry,owner,source:"development"});if(owner==="product")product.push(entry);}
  for(const entry of destination){const owner=ownerFor(input.classification.destination,entry.path);rejectProhibited(entry.path);classified.push({...entry,owner,source:"destination"});if(owner==="destination-only")preserved.push(entry);else if(owner==="product")removed.push(entry.path);else throw new PromotionError("unsafe-payload",`Destination baseline contains non-product metadata at ${entry.path}.`);}
  const target=[...preserved,...product].sort(compare);if(new Set(target.map(entry=>entry.path)).size!==target.length)throw new PromotionError("unsafe-payload","Product and destination-owned projections overlap.");
  const classifications=classified.sort((a,b)=>a.source===b.source?compare(a,b):a.source<b.source?-1:1);
  const policyDigest=digest(classifications.map(({path,owner,source})=>({path,owner,source}))),projectionDigest=digest(target);
  return freeze({sourceSha:fullSha(input.sourceSha),parentDestinationSha:fullSha(input.parentDestinationSha),productEntries:Object.freeze(product.sort(compare)),preservedDestinationEntries:Object.freeze(preserved.sort(compare)),removedProductPaths:Object.freeze([...new Set(removed)].sort()),classifications:Object.freeze(classifications),policyDigest,projectionDigest});
}

export function projectedEntries(plan:PayloadPlan):readonly GitTreeEntry[]{return Object.freeze([...plan.preservedDestinationEntries,...plan.productEntries].sort(compare));}
export function isProhibitedDestinationPath(path:string):boolean{return PROHIBITED.some(prefix=>path===prefix||path.startsWith(`${prefix}/`));}
function rejectProhibited(path:string):void{if(isProhibitedDestinationPath(path))throw new PromotionError("unsafe-payload",`Prohibited metadata path ${path} cannot enter or seed a destination payload.`);}
function ownerFor(map:ReadonlyMap<string,PathOwner>,path:string):PathOwner{const owner=map.get(path);if(!owner)throw new PromotionError("path-policy",`Path ${path} has no single current owner classification.`);return owner;}
function entries(values:readonly GitTreeEntry[],label:string):GitTreeEntry[]{if(!Array.isArray(values))throw new PromotionError("unsafe-payload",`Invalid ${label} tree.`);const out=values.map(value=>{if(!value||typeof value!=="object"||Object.keys(value).sort().join(",")!=="mode,objectId,path"||typeof value.path!=="string"||!safePath(value.path)||!MODES.has(value.mode)||!isSha(value.objectId))throw new PromotionError("unsafe-payload",`Invalid ${label} tree entry.`);return Object.freeze({...value});}).sort(compare);if(new Set(out.map(entry=>entry.path)).size!==out.length)throw new PromotionError("unsafe-payload",`Duplicate ${label} tree path.`);return out;}
function safePath(path:string):boolean{return path.length>0&&!path.startsWith("/")&&!path.includes("\\")&&!path.includes("\0")&&!path.split("/").some(part=>part===""||part==="."||part==="..");}
function compare(left:GitTreeEntry,right:GitTreeEntry):number{return left.path<right.path?-1:left.path>right.path?1:0;}
function isSha(value:unknown):value is string{return typeof value==="string"&&(/^[a-f0-9]{40}$/.test(value)||/^[a-f0-9]{64}$/.test(value));}
function fullSha(value:string):string{if(!isSha(value))throw new PromotionError("unsafe-payload","Payload requires full object IDs.");return value;}
function digest(value:unknown):string{return createHash("sha256").update(canonicalJson(value)).digest("hex");}
function freeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))freeze(child);Object.freeze(value);}return value;}
