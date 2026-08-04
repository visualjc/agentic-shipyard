import { createHash } from "node:crypto";
import { canonicalJson } from "../evidence/schema.js";
import type { SingleRepositoryCertification } from "./types.js";
import { SingleRepositoryError } from "./errors.js";

export function certificationMarker(deliveryId: string): string { return `<!-- shipyard-certification:${safeId(deliveryId)} -->`; }
export function certificationEndMarker(deliveryId: string): string { return `<!-- /shipyard-certification:${safeId(deliveryId)} -->`; }

export function singleRepositoryDossier(deliveryId: string, certifications: readonly SingleRepositoryCertification[]): string {
  if (!Array.isArray(certifications) || certifications.length === 0) throw invalid();
  const current = certifications.at(-1)!;
  return [
    "## Shipyard review certification",
    "",
    `Delivery: \`${safeId(deliveryId)}\``,
    `Reviewed head: \`${current.headSha}\``,
    `Acceptance/review receipt: \`${current.evidence.reviewResultDigest}\``,
    `Certification revision: ${current.revision}`,
    "",
    "The existing same-repository pull request is certified at this exact head. Human/team merge policy remains authoritative.",
  ].join("\n");
}

export function dossierDigest(value: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 60_000 || /shipyard-ledger|refs\/shipyard|authorization\s*:|https?:\/\/[^\s/@]+@/i.test(value)) throw invalid();
  return createHash("sha256").update(canonicalJson({ dossier: value })).digest("hex");
}

function safeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) || value.includes("..")) throw invalid();
  return value;
}
function invalid(): SingleRepositoryError { return new SingleRepositoryError("invalid-state", "Single-repository dossier is not safe canonical content."); }
