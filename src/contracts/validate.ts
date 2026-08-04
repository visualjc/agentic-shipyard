import { ContractValidationError, invalid } from "./errors.js";
import {
  CONTRACT_VERSION, DELIVERY_PHASES, OPERATIONS, type Binding, type LifecycleState,
  type Operation, type PathOwner, type PathPolicy, type Profile, type RepositoryRef,
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
  exactKeys(value, ["owner", "name", "remoteUrl", "defaultBranch"], path, code);
  return { owner: nonEmpty(value.owner, `${path}.owner`, code), name: nonEmpty(value.name, `${path}.name`, code), remoteUrl: nonEmpty(value.remoteUrl, `${path}.remoteUrl`, code), defaultBranch: nonEmpty(value.defaultBranch, `${path}.defaultBranch`, code) };
}
function topology(value: unknown, path: string, code: "invalid-profile" | "invalid-binding"): Topology {
  if (!isRecord(value)) invalid(code, path, "must be an object");
  if (value.kind === "staged-pair") {
    exactKeys(value, ["kind", "development", "destination"], path, code);
    return { kind: "staged-pair", development: repository(value.development, `${path}.development`, code), destination: repository(value.destination, `${path}.destination`, code) };
  }
  if (value.kind === "single-repository") {
    exactKeys(value, ["kind", "repository"], path, code);
    return { kind: "single-repository", repository: repository(value.repository, `${path}.repository`, code) };
  }
  return invalid(code, `${path}.kind`, "must be staged-pair or single-repository");
}
function date(value: unknown, path: string, code: "invalid-binding" | "invalid-lifecycle"): string {
  const text = nonEmpty(value, path, code);
  if (Number.isNaN(Date.parse(text))) invalid(code, path, "must be an ISO-8601 timestamp");
  return text;
}
export function validateProfile(value: unknown): Profile {
  if (!isRecord(value)) invalid("invalid-profile", "$", "must be an object");
  exactKeys(value, ["schemaVersion", "name", "actor", "topology", "allowedOperations"], "$", "invalid-profile"); version(value, "$", "invalid-profile");
  if (!isRecord(value.actor)) invalid("invalid-profile", "$.actor", "must be an object"); exactKeys(value.actor, ["login"], "$.actor", "invalid-profile");
  if (!Array.isArray(value.allowedOperations) || value.allowedOperations.length === 0) invalid("invalid-profile", "$.allowedOperations", "must be a non-empty array");
  const allowedOperations = value.allowedOperations.map((operation, index) => validateOperation(operation, `$.allowedOperations[${index}]`));
  if (new Set(allowedOperations).size !== allowedOperations.length) invalid("invalid-profile", "$.allowedOperations", "must not contain duplicates");
  return { schemaVersion: CONTRACT_VERSION, name: nonEmpty(value.name, "$.name", "invalid-profile"), actor: { login: nonEmpty(value.actor.login, "$.actor.login", "invalid-profile") }, topology: topology(value.topology, "$.topology", "invalid-profile"), allowedOperations };
}
export function validateBinding(value: unknown): Binding {
  if (!isRecord(value)) invalid("invalid-binding", "$", "must be an object");
  exactKeys(value, ["schemaVersion", "profileName", "commonDirectory", "topology", "boundAt"], "$", "invalid-binding"); version(value, "$", "invalid-binding");
  return { schemaVersion: CONTRACT_VERSION, profileName: nonEmpty(value.profileName, "$.profileName", "invalid-binding"), commonDirectory: nonEmpty(value.commonDirectory, "$.commonDirectory", "invalid-binding"), topology: topology(value.topology, "$.topology", "invalid-binding"), boundAt: date(value.boundAt, "$.boundAt", "invalid-binding") };
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
