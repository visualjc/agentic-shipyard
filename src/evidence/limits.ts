export const MAX_LEDGER_RECORD_BYTES=1_000_000;
export const MAX_CONTEXT_RECORD_BYTES=MAX_LEDGER_RECORD_BYTES;
export const MAX_CONTEXT_AGGREGATE_BYTES=2_000_000;
export const MAX_REVIEW_BUNDLE_BYTES=2_500_000;
export const MAX_CANONICAL_JSON_BYTES=3_000_000;
export const MAX_CANONICAL_JSON_NODES=100_000;

export function utf8Bytes(value:string):number{return Buffer.byteLength(value,"utf8");}
