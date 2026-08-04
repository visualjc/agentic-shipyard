import { verifyTrackerActor } from "./authority.js";
import type { GitHubApiCredentialResolver, GitHubRestClientFactory, GitHubTrackerSession } from "./types.js";
import { GitHubTrackerError, stableShipyardMarker } from "./markers.js";
import type { DevelopmentTrackingAuthorityResolver } from "./tracking-authority.js";
import type { DevelopmentTrackingAuthority } from "./tracking-authority.js";
import { DevelopmentRecordGuard } from "./tracking-guard.js";
import type { BoundProfileAuthority } from "../profile/bound-authority.js";
import type { RepositoryRef, Topology } from "../contracts/types.js";

export type DevelopmentIssueRequest = { title: string; body: string };
export type DevelopmentPullRequestRequest = {
  title: string;
  body: string;
};

/** Optional persisted facts supplied by a caller that is resuming a prior run. */
export type DevelopmentRecordResume = { issueId?: string; pullRequestId?: string };

export type DevelopmentRecordRequest = {
  deliveryId: string;
  issue: DevelopmentIssueRequest;
  pullRequest: DevelopmentPullRequestRequest;
  resume?: DevelopmentRecordResume;
};

/** Inputs required to establish a verified, command-scoped GitHub session. */
export type DevelopmentRecordAuthority = {
  /** Local path is identity input only; the resolver chooses actor and repository. */
  repositoryPath: string;
  trackingAuthority: DevelopmentTrackingAuthorityResolver;
  guard: DevelopmentRecordGuard;
  credentials: GitHubApiCredentialResolver;
  client: GitHubRestClientFactory;
};

export type DevelopmentIssueCheckpoint = {
  state: "discovered" | "created";
  id: string;
  number: number;
  url: string;
};

export type DevelopmentPullRequestCheckpoint = DevelopmentIssueCheckpoint & { expectedHeadSha: string };

/** Serializable only; its storage belongs to the caller/ledger owner. */
export type DevelopmentRecordsCheckpoint = {
  marker: string;
  actorLogin: string;
  issue: DevelopmentIssueCheckpoint;
  pullRequest: DevelopmentPullRequestCheckpoint;
};

type ProviderRecord = {
  id?: unknown;
  node_id?: unknown;
  number?: unknown;
  html_url?: unknown;
  body?: unknown;
  pull_request?: unknown;
  head?: { sha?: unknown; ref?: unknown; repo?: unknown };
  base?: { ref?: unknown };
};
type LocatedRecord = { state: "discovered" | "created"; record: ProviderRecord };
const MAX_DISCOVERY_PAGES = 100;

/**
 * Discovers or creates the intended issue/PR pair in the bound development
 * repository. The topology never accepts a caller-selected repository.
 */
export async function trackDevelopmentRecords(
  authority: DevelopmentRecordAuthority,
  request: DevelopmentRecordRequest,
): Promise<DevelopmentRecordsCheckpoint> {
  const input = validateDevelopmentRecordRequest(request);
  const marker = stableShipyardMarker(input.deliveryId);
  return authority.guard.run(authority.repositoryPath, input.deliveryId, async bound => {
    // Resolve inside the durable mutation boundary so resume/checkpoint writes
    // cannot reuse a profile or binding that changed while waiting for the lock.
    const trusted = await authority.trackingAuthority.resolve(authority.repositoryPath, input.deliveryId);
    assertTrackingAuthorityMatchesBound(trusted, bound, input.deliveryId);
    const repository = trusted.repository;
    const tracker = await verifyTrackerActor(trusted.actorLogin, repository, authority.credentials, authority.client);
    const basePath = `/repos/${repository.owner}/${repository.name}`;

    // Fully discover and validate the pair before the first write. This prevents
    // an unsafe PR state from leaving a newly-created issue behind.
    const [foundIssue, foundPullRequest] = await Promise.all([
      discover(tracker, `${basePath}/issues`, marker, input.resume?.issueId, "issue", isIssueRecord),
      discover(tracker, `${basePath}/pulls`, marker, input.resume?.pullRequestId, "pull request", isProviderRecord),
    ]);
    if (foundPullRequest) assertPullRequestMatches(foundPullRequest, trusted);
    let issue: LocatedRecord;
    if (foundIssue) issue = { state: "discovered", record: foundIssue };
    else {
      await revalidateBeforeWrite(authority, input, trusted, bound);
      issue = await createAndReconcile(tracker, `${basePath}/issues`, marker, input.issue, "issue", isIssueRecord);
    }
    let pullRequest: LocatedRecord;
    if (foundPullRequest) pullRequest = { state: "discovered", record: foundPullRequest };
    else {
      await revalidateBeforeWrite(authority, input, trusted, bound);
      pullRequest = await createAndReconcile(tracker, `${basePath}/pulls`, marker, input.pullRequest, "pull request", isProviderRecord, trusted);
    }
    assertPullRequestMatches(pullRequest.record, trusted);

    return {
      marker,
      actorLogin: trusted.actorLogin,
      issue: checkpoint(issue),
      pullRequest: { ...checkpoint(pullRequest), expectedHeadSha: trusted.expectedHeadSha },
    };
  });
}

/** Validates and snapshots public JS/deserialized input before authority or provider access. */
function validateDevelopmentRecordRequest(value: unknown): DevelopmentRecordRequest {
  try {
    const root = snapshotObject(value);
    requireExactKeys(root, ["deliveryId", "issue", "pullRequest", "resume"], ["resume"]);
    const deliveryId = root.get("deliveryId");
    if (typeof deliveryId !== "string") throw new Error();
    const issue = validateDevelopmentRecordInput(root.get("issue"));
    const pullRequest = validateDevelopmentRecordInput(root.get("pullRequest"));
    let resume: DevelopmentRecordResume | undefined;
    if (root.has("resume") && root.get("resume") !== undefined) {
      const fields = snapshotObject(root.get("resume"));
      requireExactKeys(fields, ["issueId", "pullRequestId"], ["issueId", "pullRequestId"]);
      const issueId = fields.has("issueId") && fields.get("issueId") !== undefined ? canonicalId(fields.get("issueId")) : undefined;
      const pullRequestId = fields.has("pullRequestId") && fields.get("pullRequestId") !== undefined ? canonicalId(fields.get("pullRequestId")) : undefined;
      resume = { ...(issueId === undefined ? {} : { issueId }), ...(pullRequestId === undefined ? {} : { pullRequestId }) };
    }
    return { deliveryId, issue, pullRequest, ...(resume === undefined ? {} : { resume }) };
  } catch {
    throw invalidRequest();
  }
}

function validateDevelopmentRecordInput(value: unknown): DevelopmentIssueRequest {
  const fields = snapshotObject(value);
  requireExactKeys(fields, ["title", "body"]);
  const title = fields.get("title"); const body = fields.get("body");
  if (!meaningfulString(title) || !meaningfulString(body)) throw new Error();
  return { title, body };
}

function canonicalId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) throw new Error();
  return value;
}

/** Snapshots only ordinary own enumerable data properties without invoking accessors. */
function snapshotObject(value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string")) throw new Error();
  const snapshot = new Map<string, unknown>();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error();
    snapshot.set(key, descriptor.value);
  }
  return snapshot;
}
function requireExactKeys(value: ReadonlyMap<string, unknown>, allowed: readonly string[], optional: readonly string[] = []): void {
  const required = allowed.filter(key => !optional.includes(key));
  if (!required.every(key => value.has(key)) || [...value.keys()].some(key => !allowed.includes(key))) throw new Error();
}
function meaningfulString(value: unknown): value is string { return typeof value === "string" && value.trim() !== ""; }
function invalidRequest(): GitHubTrackerError { return new GitHubTrackerError("invalid-request", "Tracker request must contain exact non-empty issue, pull request, and canonical resume fields."); }

async function createIssue(session: GitHubTrackerSession, path: string, marker: string, input: DevelopmentIssueRequest): Promise<LocatedRecord> {
  const record = await session.request<ProviderRecord>({ method: "POST", path, body: { title: input.title, body: withMarker(input.body, marker) } });
  assertRecord(record, "issue");
  return { state: "created", record };
}

/**
 * GitHub does not provide a conditional/idempotent issue-create primitive.
 * Re-list after a POST: a caller may only report created when its exact record
 * is visible and unique.  A concurrent independent host can still create a
 * duplicate during discovery; that condition is deliberately surfaced.
 */
async function createAndReconcile(
  session: GitHubTrackerSession,
  path: string,
  marker: string,
  input: DevelopmentIssueRequest | DevelopmentPullRequestRequest,
  label: string,
  accepts: (value: unknown) => value is ProviderRecord,
  trusted?: DevelopmentTrackingAuthority,
): Promise<LocatedRecord> {
  const created = trusted
    ? await createPullRequest(session, path, marker, input as DevelopmentPullRequestRequest, trusted)
    : await createIssue(session, path, marker, input as DevelopmentIssueRequest);
  const confirmed = await discover(session, path, marker, undefined, label, accepts);
  if (!confirmed) throw new GitHubTrackerError("write-unconfirmed", `GitHub did not confirm the created ${label}; re-run discovery before retrying and manually review any duplicate marked records.`);
  if (providerId(confirmed) !== providerId(created.record)) {
    throw new GitHubTrackerError("ambiguous-record", `A different Shipyard-marked ${label} appeared after creation; manually reconcile duplicate marked records before retrying.`);
  }
  return { state: "created", record: confirmed };
}

/** Re-reads the registered worktree and bound repository immediately before a POST. */
async function revalidateBeforeWrite(authority: DevelopmentRecordAuthority, request: DevelopmentRecordRequest, expected: DevelopmentTrackingAuthority, bound: BoundProfileAuthority): Promise<DevelopmentTrackingAuthority> {
  const currentBound = await authority.guard.revalidate(authority.repositoryPath, bound);
  const current = await authority.trackingAuthority.resolve(authority.repositoryPath, request.deliveryId);
  assertTrackingAuthorityMatchesBound(current, currentBound, request.deliveryId);
  if (!sameTrackingAuthority(expected, current)) {
    throw new GitHubTrackerError("authority-mismatch", "Delivery or worktree authority changed before the provider write.");
  }
  return current;
}

async function createPullRequest(session: GitHubTrackerSession, path: string, marker: string, input: DevelopmentPullRequestRequest, trusted: Awaited<ReturnType<DevelopmentTrackingAuthorityResolver["resolve"]>>): Promise<LocatedRecord> {
  const record = await session.request<ProviderRecord>({ method: "POST", path, body: { title: input.title, body: withMarker(input.body, marker), head: trusted.head, base: trusted.base } });
  assertRecord(record, "pull request");
  return { state: "created", record };
}

async function discover(session: GitHubTrackerSession, path: string, marker: string, expectedId: string | undefined, label: string, accepts: (value: unknown) => value is ProviderRecord): Promise<ProviderRecord | undefined> {
  let record: ProviderRecord | undefined;
  let exhausted = false;
  for (let page = 1; page <= MAX_DISCOVERY_PAGES; page += 1) {
    const records = await session.request<unknown>({ method: "GET", path: `${path}?state=all&per_page=100&page=${page}` });
    if (!Array.isArray(records)) throw new GitHubTrackerError("invalid-record", `GitHub returned an invalid ${label} listing.`);
    for (const candidate of records) {
      if (!accepts(candidate) || !isMarkedRecord(candidate, marker)) continue;
      if (record) throw new GitHubTrackerError("ambiguous-record", `Multiple Shipyard-marked ${label} records prevent a safe resume.`);
      record = candidate;
    }
    if (records.length < 100) { exhausted = true; break; }
  }
  if (!exhausted) throw new GitHubTrackerError("pagination-limit", `GitHub ${label} discovery exceeded the safe pagination limit.`);
  if (!record) {
    if (expectedId) throw new GitHubTrackerError("resume-mismatch", `The checkpointed ${label} is absent or no longer has its Shipyard marker.`);
    return undefined;
  }
  assertRecord(record, label);
  if (expectedId && providerId(record) !== expectedId) throw new GitHubTrackerError("resume-mismatch", `The Shipyard-marked ${label} does not match the checkpointed provider ID.`);
  return record;
}

function isMarkedRecord(value: unknown, marker: string): value is ProviderRecord {
  return isProviderRecord(value) && typeof value.body === "string" && value.body.split(/\r?\n/).some(line => line === marker);
}

function isProviderRecord(value: unknown): value is ProviderRecord {
  return typeof value === "object" && value !== null;
}

/** GitHub's issues listing includes pull requests; those have this discriminator. */
function isIssueRecord(value: unknown): value is ProviderRecord {
  return isProviderRecord(value) && !("pull_request" in value);
}

function checkpoint(located: LocatedRecord): DevelopmentIssueCheckpoint {
  const { number, html_url: url } = located.record;
  const id = providerId(located.record);
  if (!id || typeof number !== "number" || typeof url !== "string") throw new GitHubTrackerError("invalid-record", "GitHub returned an invalid provider record.");
  return { state: located.state, id, number, url };
}

function assertRecord(record: ProviderRecord, label: string): void {
  if (!providerId(record) || typeof record.number !== "number" || typeof record.html_url !== "string") {
    throw new GitHubTrackerError("invalid-record", `GitHub returned an invalid ${label} record.`);
  }
}

/** Prefer GitHub's opaque node ID; numeric database IDs remain compatible. */
function providerId(record: ProviderRecord): string | undefined {
  if (typeof record.node_id === "string" && record.node_id) return record.node_id;
  if (typeof record.id === "string" && record.id) return record.id;
  if (typeof record.id === "number" && Number.isFinite(record.id)) return String(record.id);
  return undefined;
}

function assertPullRequestMatches(record: ProviderRecord, expected: Awaited<ReturnType<DevelopmentTrackingAuthorityResolver["resolve"]>>): void {
  if (typeof record.head?.sha !== "string" || record.head.sha !== expected.expectedHeadSha) {
    throw new GitHubTrackerError("head-sha-mismatch", "The development pull request head does not match the requested expected SHA.");
  }
  if (typeof record.head?.ref !== "string" || record.head.ref !== expected.head || !sameRepository(record.head.repo, expected.repository)) {
    throw new GitHubTrackerError("head-ref-mismatch", "The development pull request head ref does not match the requested head ref.");
  }
  if (typeof record.base?.ref !== "string" || record.base.ref !== expected.base) {
    throw new GitHubTrackerError("base-ref-mismatch", "The development pull request base ref does not match the requested base ref.");
  }
}

function sameRepository(value: unknown, expected: { owner: string; name: string }): boolean {
  if (typeof value !== "object" || value === null) return false;
  const repo = value as { name?: unknown; full_name?: unknown; owner?: { login?: unknown } };
  return repo.name === expected.name && repo.full_name === `${expected.owner}/${expected.name}` && repo.owner?.login === expected.owner;
}

function sameTrackingAuthority(left: DevelopmentTrackingAuthority, right: DevelopmentTrackingAuthority): boolean {
  return left.commonDirectory === right.commonDirectory
    && left.actorLogin === right.actorLogin
    && left.head === right.head
    && left.base === right.base
    && left.expectedHeadSha === right.expectedHeadSha
    && left.repository.owner === right.repository.owner
    && left.repository.name === right.repository.name
    && left.repository.defaultBranch === right.repository.defaultBranch
    && left.repository.remote.name === right.repository.remote.name
    && left.repository.remote.url === right.repository.remote.url;
}

/** The resolver supplies delivery facts, but it may never select actor/repository authority. */
function assertTrackingAuthorityMatchesBound(tracking: DevelopmentTrackingAuthority, bound: BoundProfileAuthority, deliveryId: string): void {
  const repository = developmentRepository(bound.topology);
  if (tracking.commonDirectory !== bound.commonDirectory
    || tracking.actorLogin !== bound.actorLogin
    || !sameRepositoryRef(tracking.repository, repository)
    || tracking.head !== `shipyard/${deliveryId}`
    || tracking.base !== repository.defaultBranch
    || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(tracking.expectedHeadSha)) {
    throw new GitHubTrackerError("authority-mismatch", "Tracker authority does not exactly match the fresh bound development repository, actor, head, base, and SHA authority.");
  }
}

function developmentRepository(topology: Topology): RepositoryRef { return topology.kind === "staged-pair" ? topology.development : topology.repository; }

function sameRepositoryRef(left: RepositoryRef, right: RepositoryRef): boolean {
  return left.owner === right.owner && left.name === right.name && left.defaultBranch === right.defaultBranch
    && left.remote.name === right.remote.name && left.remote.url === right.remote.url;
}

function withMarker(body: string, marker: string): string { return `${body}\n\n${marker}`; }

export { GitHubTrackerError, stableShipyardMarker } from "./markers.js";
