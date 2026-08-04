export class EvidenceError extends Error { readonly name = "EvidenceError"; constructor(readonly code: "evidence-invalid" | "evidence-incomplete", message: string) { super(message); } }
