import { ContractValidationError, invalid } from "./errors.js";
import { isAbsolute, resolve } from "node:path";
import {
  CONTRACT_VERSION, DELIVERY_PHASES, OPERATIONS, type Binding, type LifecycleState,
  type GraphProfile, type Operation, type PathOwner, type PathPolicy, type Profile, type RepositoryRef,
  type Topology,
} from "./types.js";

type RecordValue = Record<string, unknown>;
const owners: readonly PathOwner[] = ["product", "development-record", "development-generated", "destination-only", "context-overlay", "scratch"];
const isRecord = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown, path: string, code: "invalid-profile" | "invalid-binding" | "invalid-path-policy" | "invalid-lifecycle" = "invalid-profile"): string => {
  if (typeof value !== "string" || value.trim() === "") invalid(code, path, "must be a non-empty string");
  return value;
};
const exactKeys = (value: RecordValue, allowed: readonly string[], path: string, code: "invalid-profile" | "invalid-binding" | "invalid-path-policy" | "invalid-lifecycle") => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(code, `${path}.${key}`, "is not allowed");
};
const version = (value: RecordValue, path: string, code: "invalid-profile" | "invalid-binding" | "invalid-path-policy" | "invalid-lifecycle") => {
  if (value.schemaVersion !== CONTRACT_VERSION) invalid(value.schemaVersion === undefined ? code : "unsupported-schema-version", `${path}.schemaVersion`, `must equal ${CONTRACT_VERSION}`);
};
function repository(value: unknown, path: string, code: "invalid-profile" | "invalid-binding"): RepositoryRef {
  if (!isRecord(value)) invalid(code, path, "must be an object");
  exactKeys(value, ["owner", "name", "remote", "defaultBranch"], path, code);
  const owner = githubSegment(value.owner, `${path}.owner`, code);
  const name = githubSegment(value.name, `${path}.name`, code);
  return { owner, name, remote: validateRemoteExpectation(value.remote, `${path}.remote`, code), defaultBranch: nonEmpty(value.defaultBranch, `${path}.defaultBranch`, code) };
}
function githubSegment(value: unknown, path: string, code: "invalid-profile" | "invalid-binding"): string {
  const text = nonEmpty(value, path, code);
  if (text.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(text) || text === "." || text === ".." || text.includes("..")) invalid(code, path, "must be one safe canonical GitHub path segment");
  return text;
}
/** Validates the complete remote identity required before any setup mutation. */
export function validateRemoteExpectation(value: unknown, path = "$", code: "invalid-profile" | "invalid-binding" = "invalid-profile"): RepositoryRef["remote"] {
  if (!isRecord(value)) invalid(code, path, "must be an object");
  exactKeys(value, ["name", "url"], path, code);
  return { name: nonEmpty(value.name, `${path}.name`, code), url: nonEmpty(value.url, `${path}.url`, code) };
}
function topology(value: unknown, path: string, code: "invalid-profile" | "invalid-binding"): Topology {
  if (!isRecord(value)) invalid(code, path, "must be an object");
  if (value.kind === "staged-pair") {
    exactKeys(value, ["kind", "development", "destination"], path, code);
    const development = repository(value.development, `${path}.development`, code);
    const destination = repository(value.destination, `${path}.destination`, code);
    if (development.remote.name === destination.remote.name || development.remote.url === destination.remote.url) {
      invalid(code, path, "staged-pair development and destination remotes must be distinct");
    }
    return { kind: "staged-pair", development, destination };
  }
  if (value.kind === "single-repository") {
    exactKeys(value, ["kind", "repository"], path, code);
    return { kind: "single-repository", repository: repository(value.repository, `${path}.repository`, code) };
  }
  return invalid(code, `${path}.kind`, "must be staged-pair or single-repository");
}
function date(value: unknown, path: string, code: "invalid-binding" | "invalid-lifecycle"): string {
  const text = nonEmpty(value, path, code);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) invalid(code, path, "must be an ISO-8601 timestamp");
  return text;
}
export function validateProfile(value: unknown): Profile {
  try { value = snapshotJson(value); } catch { invalid("invalid-profile", "$", "must be a plain data document"); }
  if (!isRecord(value)) invalid("invalid-profile", "$", "must be an object");
  exactKeys(value, ["schemaVersion", "name", "actor", "topology", "allowedOperations", "pathPolicy", "graph"], "$", "invalid-profile"); version(value, "$", "invalid-profile");
  if (!isRecord(value.actor)) invalid("invalid-profile", "$.actor", "must be an object"); exactKeys(value.actor, ["login"], "$.actor", "invalid-profile");
  if (!Array.isArray(value.allowedOperations) || value.allowedOperations.length === 0) invalid("invalid-profile", "$.allowedOperations", "must be a non-empty array");
  const allowedOperations = value.allowedOperations.map((operation, index) => validateOperation(operation, `$.allowedOperations[${index}]`));
  if (new Set(allowedOperations).size !== allowedOperations.length) invalid("invalid-profile", "$.allowedOperations", "must not contain duplicates");
  let pathPolicy: PathPolicy;
  try { pathPolicy = validatePathPolicy(value.pathPolicy); }
  catch { invalid("invalid-profile", "$.pathPolicy", "must be a valid canonical path policy"); }
  const graph = value.graph === undefined ? undefined : validateGraphProfile(value.graph);
  return { schemaVersion: CONTRACT_VERSION, name: nonEmpty(value.name, "$.name", "invalid-profile"), actor: { login: nonEmpty(value.actor.login, "$.actor.login", "invalid-profile") }, topology: topology(value.topology, "$.topology", "invalid-profile"), allowedOperations, pathPolicy, ...(graph ? { graph } : {}) };
}
function snapshotJson(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new Error();
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === undefined) return value;
  if (Array.isArray(value)) { const d = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>; const length = d["length"]; const size = length && "value" in length ? length.value : undefined; if (!Number.isSafeInteger(size) || size < 0 || Object.values(d).some(field => !("value" in field))) throw new Error(); const result: unknown[] = []; for (let index = 0; index < size; index++) { const field = d[String(index)]; if (!field || !("value" in field)) throw new Error(); result.push(snapshotJson(field.value, depth + 1)); } if (Object.keys(d).some(key => key !== "length" && !/^\d+$/.test(key))) throw new Error(); return result; }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
  const d = Object.getOwnPropertyDescriptors(value); if (Object.values(d).some(field => !("value" in field))) throw new Error(); return Object.fromEntries(Object.entries(d).map(([key, field]) => [key, snapshotJson(field.value, depth + 1)]));
}
function validateGraphProfile(value: unknown): GraphProfile {
  if (!isRecord(value)) invalid("invalid-profile", "$.graph", "must be an object");
  if (value.enabled === false) { exactKeys(value, ["enabled"], "$.graph", "invalid-profile"); return Object.freeze({ enabled: false }); }
  if (value.enabled !== true || value.localOnlyApproved !== true) invalid("invalid-profile", "$.graph", "enabled graphs require explicit localOnlyApproved true");
  if (value.adapter === "graphify") {
    exactKeys(value, ["enabled", "localOnlyApproved", "adapter", "reviewedToolSource", "executablePath", "cacheRoot"], "$.graph", "invalid-profile");
    if (value.reviewedToolSource !== "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df") invalid("invalid-profile", "$.graph.reviewedToolSource", "must equal the reviewed Graphify pin");
    return Object.freeze({ enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: value.reviewedToolSource, executablePath: absolute(value.executablePath, "$.graph.executablePath"), cacheRoot: absolute(value.cacheRoot, "$.graph.cacheRoot") });
  }
  if (value.adapter === "codegraph") {
    exactKeys(value, ["enabled", "localOnlyApproved", "adapter", "reviewedToolSource", "executablePath", "nodeExecutablePath"], "$.graph", "invalid-profile");
    if (value.reviewedToolSource !== "codegraph@1.5.0#49c11fc2e0c02170742be8411e66a31af611f4b7") invalid("invalid-profile", "$.graph.reviewedToolSource", "must equal the reviewed CodeGraph pin");
    return Object.freeze({ enabled: true, localOnlyApproved: true, adapter: "codegraph", reviewedToolSource: value.reviewedToolSource, executablePath: absolute(value.executablePath, "$.graph.executablePath"), nodeExecutablePath: absolute(value.nodeExecutablePath, "$.graph.nodeExecutablePath") });
  }
  return invalid("invalid-profile", "$.graph.adapter", "must be graphify or codegraph");
}
function absolute(value: unknown, path: string): string {
  const text = nonEmpty(value, path, "invalid-profile");
  if (!isAbsolute(text) || resolve(text) !== text) invalid("invalid-profile", path, "must be a canonical absolute path");
  return text;
}
export function validateBinding(value: unknown): Binding {
  if (!isRecord(value)) invalid("invalid-binding", "$", "must be an object");
  exactKeys(value, ["schemaVersion", "profileName", "commonDirectory", "topology", "profileFingerprint", "boundAt"], "$", "invalid-binding"); version(value, "$", "invalid-binding");
  const profileFingerprint = nonEmpty(value.profileFingerprint, "$.profileFingerprint", "invalid-binding");
  if (!/^[a-f0-9]{64}$/.test(profileFingerprint)) invalid("invalid-binding", "$.profileFingerprint", "must be a lowercase SHA-256 digest");
  return { schemaVersion: CONTRACT_VERSION, profileName: nonEmpty(value.profileName, "$.profileName", "invalid-binding"), commonDirectory: nonEmpty(value.commonDirectory, "$.commonDirectory", "invalid-binding"), topology: topology(value.topology, "$.topology", "invalid-binding"), profileFingerprint, boundAt: date(value.boundAt, "$.boundAt", "invalid-binding") };
}
export function validatePathPolicy(value: unknown): PathPolicy {
  if (!isRecord(value)) invalid("invalid-path-policy", "$", "must be an object"); exactKeys(value, ["schemaVersion", "rules"], "$", "invalid-path-policy"); version(value, "$", "invalid-path-policy");
  if (!Array.isArray(value.rules) || value.rules.length === 0) invalid("invalid-path-policy", "$.rules", "must be a non-empty array");
  const rules = value.rules.map((rule, index) => {
    const path = `$.rules[${index}]`; if (!isRecord(rule)) invalid("invalid-path-policy", path, "must be an object"); exactKeys(rule, ["owner", "pattern"], path, "invalid-path-policy");
    if (!owners.includes(rule.owner as PathOwner)) invalid("invalid-path-policy", `${path}.owner`, "must be a recognized path owner");
    return { owner: rule.owner as PathOwner, pattern: nonEmpty(rule.pattern, `${path}.pattern`, "invalid-path-policy") };
  });
  if (new Set(rules.map((rule) => rule.pattern)).size !== rules.length) invalid("invalid-path-policy", "$.rules", "must not contain duplicate patterns");
  return { schemaVersion: CONTRACT_VERSION, rules };
}
export function validateOperation(value: unknown, path = "$"): Operation {
  if (typeof value !== "string" || !OPERATIONS.includes(value as Operation)) invalid("invalid-operation", path, `must be one of ${OPERATIONS.join(", ")}`);
  return value as Operation;
}
export function validateLifecycleState(value: unknown): LifecycleState {
  if (!isRecord(value)) invalid("invalid-lifecycle", "$", "must be an object"); exactKeys(value, ["schemaVersion", "deliveryId", "phase", "productSha", "ledgerSha", "destinationSha", "updatedAt"], "$", "invalid-lifecycle"); version(value, "$", "invalid-lifecycle");
  if (typeof value.phase !== "string" || !DELIVERY_PHASES.includes(value.phase as never)) invalid("invalid-lifecycle", "$.phase", `must be one of ${DELIVERY_PHASES.join(", ")}`);
  const state: LifecycleState = { schemaVersion: CONTRACT_VERSION, deliveryId: nonEmpty(value.deliveryId, "$.deliveryId", "invalid-lifecycle"), phase: value.phase as LifecycleState["phase"], updatedAt: date(value.updatedAt, "$.updatedAt", "invalid-lifecycle") };
  for (const key of ["productSha", "ledgerSha", "destinationSha"] as const) if (value[key] !== undefined) state[key] = nonEmpty(value[key], `$.${key}`, "invalid-lifecycle");
  return state;
}
export { ContractValidationError };
