import { canonicalAbsolutePath, canonicalWorkspaceBranch, stableDeliveryId } from "../delivery/registry.js";
import type { DeliveryWorkspace } from "../delivery/types.js";

export type WorkspaceProofKind = "ownership" | "readiness";
export type WorkspaceProofRecord = Readonly<{
  schemaVersion: 1;
  kind: WorkspaceProofKind;
  creationToken: string;
  deliveryId: string;
  commonDirectory: string;
  branch: string;
  worktreePath: string;
  startProductSha: string;
}>;

export type WorkspaceProofObservation = Readonly<
  | { exists: false }
  | { exists: true; record?: WorkspaceProofRecord }
>;

export function createWorkspaceProofRecord(kind: WorkspaceProofKind, workspace: DeliveryWorkspace, startProductSha: string): WorkspaceProofRecord {
  return validateWorkspaceProofRecord({
    schemaVersion: 1,
    kind,
    creationToken: workspace.creationToken,
    deliveryId: workspace.deliveryId,
    commonDirectory: workspace.commonDirectory,
    branch: workspace.branch,
    worktreePath: workspace.worktreePath,
    startProductSha,
  })!;
}

export function serializeWorkspaceProofRecord(record: WorkspaceProofRecord): string {
  const validated = validateWorkspaceProofRecord(record);
  if (!validated) throw new Error("Invalid workspace proof record.");
  return JSON.stringify(validated);
}

/** Parses only the canonical bytes written by serializeWorkspaceProofRecord. */
export function parseWorkspaceProofRecord(contents: string): WorkspaceProofRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(contents);
    const record = validateWorkspaceProofRecord(parsed);
    return record && JSON.stringify(record) === contents ? record : undefined;
  } catch { return undefined; }
}

export function validateWorkspaceProofRecord(value: unknown): WorkspaceProofRecord | undefined {
  if (!isRecord(value)) return undefined;
  const keys = ["schemaVersion", "kind", "creationToken", "deliveryId", "commonDirectory", "branch", "worktreePath", "startProductSha"] as const;
  if (Object.keys(value).length !== keys.length || !Object.keys(value).every(key => keys.includes(key as typeof keys[number]))) return undefined;
  if (value.schemaVersion !== 1 || (value.kind !== "ownership" && value.kind !== "readiness") || !creationToken(value.creationToken)) return undefined;
  try {
    const deliveryId = stableDeliveryId(value.deliveryId);
    const commonDirectory = canonicalAbsolutePath(value.commonDirectory);
    const worktreePath = canonicalAbsolutePath(value.worktreePath);
    const branch = canonicalWorkspaceBranch(value.branch, deliveryId);
    if (commonDirectory === worktreePath || typeof value.startProductSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.startProductSha)) return undefined;
    return { schemaVersion: 1, kind: value.kind, creationToken: value.creationToken, deliveryId, commonDirectory, branch, worktreePath, startProductSha: value.startProductSha };
  } catch { return undefined; }
}

export function proofMatchesWorkspace(record: WorkspaceProofRecord, kind: WorkspaceProofKind, workspace: DeliveryWorkspace, startProductSha?: string): boolean {
  return record.kind === kind
    && record.creationToken === workspace.creationToken
    && record.deliveryId === workspace.deliveryId
    && record.commonDirectory === workspace.commonDirectory
    && record.branch === workspace.branch
    && record.worktreePath === workspace.worktreePath
    && (startProductSha === undefined || record.startProductSha === startProductSha);
}

export function workspaceProofRef(kind: WorkspaceProofKind, token: string): string {
  if ((kind !== "ownership" && kind !== "readiness") || !creationToken(token)) throw new Error("Invalid workspace proof identity.");
  return `refs/shipyard/workspace-${kind}/${token}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function creationToken(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
