export type FinalizationFailureCode="invalid-state"|"authority-changed"|"merge-unverified"|"checkpoint-conflict"|"unsafe-recovery";
export class FinalizationError extends Error {readonly name="FinalizationError";constructor(readonly code:FinalizationFailureCode,message:string){super(message);}}
