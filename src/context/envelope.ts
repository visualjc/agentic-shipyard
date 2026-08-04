import { CANONICAL_LEDGER_REF, CONTEXT_ROLES, type ContextEnvelope, type ContextEnvelopeInput, type ContextRole } from "./types.js";
import type { RepositoryRef, Topology } from "../contracts/types.js";
import { ContextError } from "./errors.js";

const allowedRecords: Readonly<Record<ContextRole, readonly string[]>> = {
  implementer: ["contract.md", "assigned-task.md"],
  reviewer: ["intent.md", "acceptance.json", "review.json"],
  status: [],
};

/** Creates a canonical envelope; callers cannot choose or supplement a role's records. */
export function createEnvelope(input: ContextEnvelopeInput): ContextEnvelope {
  validateInput(input);
  const records = recordsFor(input.deliveryId, input.role);
  if (input.records !== undefined && !sameRecords(input.records, records)) {
    throw new ContextError("context-records-not-allowed", "The requested records are not exactly the role allowlist.");
  }
  return deepFreeze({
    schemaVersion: 1,
    profile: input.profile,
    topology: structuredClone(input.topology),
    repository: structuredClone(input.repository),
    deliveryId: input.deliveryId,
    host: input.host,
    role: input.role,
    productBranch: input.productBranch,
    productSha: input.productSha,
    ledgerRef: input.ledgerRef,
    ledgerSha: input.ledgerSha,
    objectFormat: input.objectFormat,
    records: [...records],
    adapter: { host: input.host, role: input.role, envelopePath: input.envelopePath, repoRoot: input.repoRoot },
  });
}

/** Validates untrusted serialized data and returns a detached, deeply frozen snapshot. */
export function validateContextEnvelope(value: unknown): ContextEnvelope {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "profile", "topology", "repository", "deliveryId", "host", "role", "productBranch", "productSha", "ledgerRef", "ledgerSha", "objectFormat", "records", "adapter"]) || value.schemaVersion !== 1 || !CONTEXT_ROLES.includes(value.role as ContextRole) || !record(value.adapter)) invalid();
  if (!exactKeys(value.adapter, ["host", "role", "envelopePath", "repoRoot"]) || value.adapter.host !== value.host || value.adapter.role !== value.role || !Array.isArray(value.records)) invalid();
  return createEnvelope({
    profile: text(value.profile), topology: value.topology as ContextEnvelope["topology"], repository: value.repository as ContextEnvelope["repository"],
    deliveryId: text(value.deliveryId), host: text(value.host), role: value.role as ContextRole, productBranch: text(value.productBranch), productSha: text(value.productSha), ledgerRef: text(value.ledgerRef), ledgerSha: text(value.ledgerSha), objectFormat: objectFormat(value.objectFormat),
    envelopePath: text(value.adapter.envelopePath), repoRoot: text(value.adapter.repoRoot), records: value.records.map(text),
  });
}

export function allowedRecordPaths(deliveryId: string, role: ContextRole): readonly string[] {
  if (!validSegment(deliveryId)) throw new ContextError("context-invalid-envelope", "Delivery ID must be a safe path segment.");
  if (!CONTEXT_ROLES.includes(role)) invalid();
  return Object.freeze(recordsFor(deliveryId, role));
}

function recordsFor(deliveryId: string, role: ContextRole): string[] { return allowedRecords[role].map((name) => `deliveries/${deliveryId}/${name}`); }
function sameRecords(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((path, index) => path === expected[index]); }
function validateInput(input: ContextEnvelopeInput): void {
  for (const value of [input.profile, input.deliveryId, input.host, input.productBranch, input.productSha, input.ledgerRef, input.ledgerSha, input.envelopePath, input.repoRoot]) if (!textOk(value)) invalid();
  if (!CONTEXT_ROLES.includes(input.role)) invalid();
  if (!validSegment(input.deliveryId)) invalid();
  topology(input.topology);
  repository(input.repository);
  if (!sameRepository(input.repository, deliveryRepository(input.topology))) {
    throw new ContextError("context-repository-mismatch", "The envelope repository must be the delivery repository selected by its topology.");
  }
  const format = objectFormat(input.objectFormat);
  if (!fullObjectId(format, input.productSha) || !fullObjectId(format, input.ledgerSha) || input.ledgerRef !== CANONICAL_LEDGER_REF) invalid();
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function text(value: unknown): string { if (!textOk(value)) invalid(); return value; }
function textOk(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function validSegment(value: string): boolean { return value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\"); }
function repository(value: unknown): RepositoryRef {
  if (!record(value) || !exactKeys(value, ["owner", "name", "remote", "defaultBranch"]) || !record(value.remote) || !exactKeys(value.remote, ["name", "url"])) invalid();
  return { owner: text(value.owner), name: text(value.name), remote: { name: text(value.remote.name), url: text(value.remote.url) }, defaultBranch: text(value.defaultBranch) };
}
function deliveryRepository(value: Topology): RepositoryRef { return value.kind === "staged-pair" ? value.development : value.repository; }
function sameRepository(left: RepositoryRef, right: RepositoryRef): boolean {
  return left.owner === right.owner && left.name === right.name && left.defaultBranch === right.defaultBranch
    && left.remote.name === right.remote.name && left.remote.url === right.remote.url;
}
function objectFormat(value: unknown): "sha1" | "sha256" { if (value === "sha1" || value === "sha256") return value; return invalid(); }
function fullObjectId(format: "sha1" | "sha256", value: string): boolean { return new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`).test(value); }
function topology(value: unknown): Topology {
  if (!record(value) || typeof value.kind !== "string") invalid();
  if (value.kind === "single-repository") {
    if (!exactKeys(value, ["kind", "repository"])) invalid();
    return { kind: "single-repository", repository: repository(value.repository) };
  }
  if (value.kind === "staged-pair") {
    if (!exactKeys(value, ["kind", "development", "destination"])) invalid();
    return { kind: "staged-pair", development: repository(value.development), destination: repository(value.destination) };
  }
  return invalid();
}
function invalid(): never { throw new ContextError("context-invalid-envelope", "Context envelope is not a valid canonical version 1 document."); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
