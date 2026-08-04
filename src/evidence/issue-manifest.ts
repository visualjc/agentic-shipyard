import type { EvidenceManifest } from "./types.js";
export const issueManifest: EvidenceManifest = Object.freeze({ issueId: "6", items: Object.freeze([
  ...["stable-item-fields", "sha-freshness", "independent-process", "finding-lifecycle", "non-authoritative-ccpm", "prd-ac-014-015"].map((id) => Object.freeze({ id: `ac-${id}`, kind: "acceptance" as const })),
  ...["deterministic-validation", "test-coverage", "documentation", "self-evidence", "independent-review"].map((id) => Object.freeze({ id: `dod-${id}`, kind: "definition-of-done" as const })),
] as EvidenceManifest["items"] ) });
