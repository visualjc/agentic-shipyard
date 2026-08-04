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
  try {
    const snapshot = validateInput(input);
    const records = recordsFor(snapshot.deliveryId, snapshot.role);
    if (snapshot.records !== undefined && !sameRecords(snapshot.records, records)) {
      throw new ContextError("context-records-not-allowed", "The requested records are not exactly the role allowlist.");
    }
    return deepFreeze({
    schemaVersion: 1,
    profile: snapshot.profile,
    topology: snapshot.topology,
    repository: snapshot.repository,
    deliveryId: snapshot.deliveryId,
    host: snapshot.host,
    role: snapshot.role,
    productBranch: snapshot.productBranch,
    productSha: snapshot.productSha,
    ledgerRef: snapshot.ledgerRef,
    ledgerSha: snapshot.ledgerSha,
    objectFormat: snapshot.objectFormat,
    records: [...records],
    adapter: { host: snapshot.host, role: snapshot.role, envelopePath: snapshot.envelopePath, repoRoot: snapshot.repoRoot },
    });
  } catch (error) {
    rethrowContextError(error);
  }
}

/** Validates untrusted serialized data and returns a detached, deeply frozen snapshot. */
export function validateContextEnvelope(value: unknown): ContextEnvelope {
  try {
    const root = snapshotObject(value);
    requireExactKeys(root, ["schemaVersion", "profile", "topology", "repository", "deliveryId", "host", "role", "productBranch", "productSha", "ledgerRef", "ledgerSha", "objectFormat", "records", "adapter"]);
    const schemaVersion = root.get("schemaVersion");
    const role = root.get("role");
    const adapter = snapshotObject(root.get("adapter"));
    const host = root.get("host");
    const records = root.get("records");
    if (schemaVersion !== 1 || !CONTEXT_ROLES.includes(role as ContextRole) || !exactKeys(adapter, ["host", "role", "envelopePath", "repoRoot"]) || adapter.get("host") !== host || adapter.get("role") !== role) invalid();
    return createEnvelope({
      profile: text(root.get("profile")), topology: root.get("topology") as ContextEnvelope["topology"], repository: root.get("repository") as ContextEnvelope["repository"],
      deliveryId: text(root.get("deliveryId")), host: text(host), role: role as ContextRole, productBranch: text(root.get("productBranch")), productSha: text(root.get("productSha")), ledgerRef: text(root.get("ledgerRef")), ledgerSha: text(root.get("ledgerSha")), objectFormat: objectFormat(root.get("objectFormat")),
      envelopePath: text(adapter.get("envelopePath")), repoRoot: text(adapter.get("repoRoot")), records: recordsSnapshot(records),
    });
  } catch (error) {
    rethrowContextError(error);
  }
}

export function allowedRecordPaths(deliveryId: string, role: ContextRole): readonly string[] {
  if (!validSegment(deliveryId)) throw new ContextError("context-invalid-envelope", "Delivery ID must be a safe path segment.");
  if (!isRole(role)) invalid();
  return Object.freeze(recordsFor(deliveryId, role));
}

function recordsFor(deliveryId: string, role: ContextRole): string[] { return allowedRecords[role].map((name) => `deliveries/${deliveryId}/${name}`); }
function sameRecords(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((path, index) => path === expected[index]); }
type InputSnapshot = Readonly<{ profile: string; topology: Topology; repository: RepositoryRef; deliveryId: string; host: string; role: ContextRole; productBranch: string; productSha: string; ledgerRef: string; ledgerSha: string; objectFormat: "sha1" | "sha256"; envelopePath: string; repoRoot: string; records?: readonly string[] }>;
function validateInput(input: ContextEnvelopeInput): InputSnapshot {
  const root = snapshotObject(input);
  requireExactKeys(root, ["profile", "topology", "repository", "deliveryId", "host", "role", "productBranch", "productSha", "ledgerRef", "ledgerSha", "objectFormat", "envelopePath", "repoRoot", "records"], ["records"]);
  const profile = text(root.get("profile"));
  const topologySnapshot = topology(root.get("topology"));
  const repositorySnapshot = repository(root.get("repository"));
  const deliveryId = text(root.get("deliveryId"));
  const host = text(root.get("host"));
  const role = root.get("role");
  const productBranch = text(root.get("productBranch"));
  const productSha = text(root.get("productSha"));
  const ledgerRef = text(root.get("ledgerRef"));
  const ledgerSha = text(root.get("ledgerSha"));
  const envelopePath = text(root.get("envelopePath"));
  const repoRoot = text(root.get("repoRoot"));
  const format = objectFormat(root.get("objectFormat"));
  const inputRecords = root.get("records");
  const records = inputRecords === undefined ? undefined : recordsSnapshot(inputRecords);
  if (!isRole(role)) invalid();
  if (!validSegment(deliveryId)) invalid();
  if (!sameRepository(repositorySnapshot, deliveryRepository(topologySnapshot))) {
    throw new ContextError("context-repository-mismatch", "The envelope repository must be the delivery repository selected by its topology.");
  }
  if (!fullObjectId(format, productSha) || !fullObjectId(format, ledgerSha) || ledgerRef !== CANONICAL_LEDGER_REF) invalid();
  return deepFreeze({ profile, topology: topologySnapshot, repository: repositorySnapshot, deliveryId, host, role, productBranch, productSha, ledgerRef, ledgerSha, objectFormat: format, envelopePath, repoRoot, records });
}
function exactKeys(value: ReadonlyMap<string, unknown>, keys: readonly string[]): boolean { return value.size === keys.length && [...value.keys()].every((key) => keys.includes(key)); }
function text(value: unknown): string { if (!textOk(value)) invalid(); return value; }
function textOk(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function validSegment(value: string): boolean { return value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\"); }
function repository(value: unknown): RepositoryRef {
  const fields = snapshotObject(value);
  if (!exactKeys(fields, ["owner", "name", "remote", "defaultBranch"])) invalid();
  const remote = snapshotObject(fields.get("remote"));
  if (!exactKeys(remote, ["name", "url"])) invalid();
  return deepFreeze({ owner: text(fields.get("owner")), name: text(fields.get("name")), remote: { name: text(remote.get("name")), url: text(remote.get("url")) }, defaultBranch: text(fields.get("defaultBranch")) });
}
function deliveryRepository(value: Topology): RepositoryRef { return value.kind === "staged-pair" ? value.development : value.repository; }
function sameRepository(left: RepositoryRef, right: RepositoryRef): boolean {
  return left.owner === right.owner && left.name === right.name && left.defaultBranch === right.defaultBranch
    && left.remote.name === right.remote.name && left.remote.url === right.remote.url;
}
function objectFormat(value: unknown): "sha1" | "sha256" { if (value === "sha1" || value === "sha256") return value; return invalid(); }
function fullObjectId(format: "sha1" | "sha256", value: string): boolean { return new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`).test(value); }
function topology(value: unknown): Topology {
  const fields = snapshotObject(value);
  const kind = fields.get("kind");
  if (typeof kind !== "string") invalid();
  if (kind === "single-repository") {
    if (!exactKeys(fields, ["kind", "repository"])) invalid();
    return deepFreeze({ kind: "single-repository", repository: repository(fields.get("repository")) });
  }
  if (kind === "staged-pair") {
    if (!exactKeys(fields, ["kind", "development", "destination"])) invalid();
    return deepFreeze({ kind: "staged-pair", development: repository(fields.get("development")), destination: repository(fields.get("destination")) });
  }
  return invalid();
}
function recordsSnapshot(value: unknown): string[] {
  if (!Array.isArray(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(descriptors).some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)))) invalid();
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
    snapshot.push(text(descriptor.value));
  }
  return snapshot;
}
/** Snapshots only ordinary own enumerable data properties without invoking accessors. */
function snapshotObject(value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) invalid();
  const snapshot = new Map<string, unknown>();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
    snapshot.set(key, descriptor.value);
  }
  return snapshot;
}
function requireExactKeys(value: ReadonlyMap<string, unknown>, allowed: readonly string[], optional: readonly string[] = []): void {
  if (!allowed.filter((key) => !optional.includes(key)).every((key) => value.has(key)) || [...value.keys()].some((key) => !allowed.includes(key))) invalid();
}
function isRole(value: unknown): value is ContextRole { return CONTEXT_ROLES.includes(value as ContextRole); }
function rethrowContextError(error: unknown): never { if (error instanceof ContextError) throw error; return invalid(); }
function invalid(): never { throw new ContextError("context-invalid-envelope", "Context envelope is not a valid canonical version 1 document."); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
