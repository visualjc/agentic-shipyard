import { createHash } from "node:crypto";
import type { LedgerStore } from "../ledger/types.js";
import { PromotionError } from "./errors.js";
import { appendJournalEntry, promotionJournalContents, promotionManifestContents, validatePromotionJournal, validatePromotionManifest } from "./schema.js";
import type { PromotionJournal, PromotionJournalEntry, PromotionManifest } from "./types.js";

export function promotionManifestPath(deliveryId:string):string{return `deliveries/${deliveryId}/promotion/manifest.json`;}
export function promotionJournalPath(deliveryId:string):string{return `deliveries/${deliveryId}/promotion/journal.json`;}
export function promotionManifestDigest(manifest:PromotionManifest):string{return createHash("sha256").update(promotionManifestContents(manifest)).digest("hex");}

export type PromotionLedgerSnapshot=Readonly<{head:string|undefined;manifest?:PromotionManifest;journal:PromotionJournal;manifestBytes?:string;journalBytes?:string}>;

export class PromotionLedger {
  constructor(private readonly store:LedgerStore){}
  async read(deliveryId:string):Promise<PromotionLedgerSnapshot>{const manifestPath=promotionManifestPath(deliveryId),journalPath=promotionJournalPath(deliveryId),snapshot=await this.store.snapshot([manifestPath,journalPath]);try{const manifestBytes=snapshot.records[manifestPath],journalBytes=snapshot.records[journalPath],manifest=manifestBytes===undefined?undefined:canonicalManifest(manifestBytes),journal=journalBytes===undefined?validatePromotionJournal({schemaVersion:1,deliveryId,entries:[]}):canonicalJournal(journalBytes);return Object.freeze({head:snapshot.head,...(manifest?{manifest,manifestBytes}:{}),journal,...(journalBytes===undefined?{}:{journalBytes})});}catch{throw new PromotionError("checkpoint-conflict","Promotion ledger state is malformed or non-canonical.");}}
  async writeManifest(expected:PromotionLedgerSnapshot,manifest:PromotionManifest):Promise<string>{const contents=promotionManifestContents(manifest),path=promotionManifestPath(manifest.deliveryId);try{return await this.store.transact({expectedHead:expected.head,writes:[{path,contents,...(expected.manifestBytes===undefined?{}:{expectedContents:expected.manifestBytes})}],message:`Checkpoint promotion ${manifest.deliveryId}`});}catch{throw new PromotionError("checkpoint-conflict","Promotion manifest CAS failed; reread before resuming.");}}
  async append(expected:PromotionLedgerSnapshot,entry:Omit<PromotionJournalEntry,"sequence">):Promise<string>{const journal=appendJournalEntry(expected.journal,entry),contents=promotionJournalContents(journal),path=promotionJournalPath(journal.deliveryId);if(journal===expected.journal)return expected.head??"";try{return await this.store.transact({expectedHead:expected.head,writes:[{path,contents,...(expected.journalBytes===undefined?{}:{expectedContents:expected.journalBytes})}],message:`Record ${entry.step} for ${journal.deliveryId}`});}catch{throw new PromotionError("checkpoint-conflict","Promotion journal CAS failed; reread before resuming.");}}
}
function canonicalManifest(bytes:string):PromotionManifest{const value=validatePromotionManifest(JSON.parse(bytes));if(promotionManifestContents(value)!==bytes)throw new Error();return value;}
function canonicalJournal(bytes:string):PromotionJournal{const value=validatePromotionJournal(JSON.parse(bytes));if(promotionJournalContents(value)!==bytes)throw new Error();return value;}
