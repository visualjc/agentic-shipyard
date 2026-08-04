import { verifyTrackerActor } from "./authority.js";
import type { GitHubApiCredentialResolver, GitHubRestClientFactory, GitHubTrackerSession } from "./types.js";
import { GitHubTrackerError, stableShipyardMarker } from "./markers.js";
import type { DevelopmentTrackingAuthorityResolver } from "./tracking-authority.js";
import { DevelopmentRecordGuard } from "./tracking-guard.js";

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
 * Finds or creates Shipyard's one issue and one PR in the bound development
 * repository. The topology never accepts a caller-selected repository.
 */
export async function trackDevelopmentRecords(
  authority: DevelopmentRecordAuthority,
  request: DevelopmentRecordRequest,
): Promise<DevelopmentRecordsCheckpoint> {
  return authority.guard.run(authority.repositoryPath, request.deliveryId, async () => {
    // Resolve inside the durable mutation boundary so resume/checkpoint writes
    // cannot reuse a profile or binding that changed while waiting for the lock.
    const trusted = await authority.trackingAuthority.resolve(authority.repositoryPath, request.deliveryId);
    const repository = trusted.repository;
    const tracker = await verifyTrackerActor(trusted.actorLogin, repository, authority.credentials, authority.client);
    const marker = stableShipyardMarker(request.deliveryId);
    const basePath = `/repos/${repository.owner}/${repository.name}`;

    // Fully discover and validate the pair before the first write. This prevents
    // an unsafe PR state from leaving a newly-created issue behind.
    const [foundIssue, foundPullRequest] = await Promise.all([
      discover(tracker, `${basePath}/issues`, marker, request.resume?.issueId, "issue", isIssueRecord),
      discover(tracker, `${basePath}/pulls`, marker, request.resume?.pullRequestId, "pull request", isProviderRecord),
    ]);
    if (foundPullRequest) assertPullRequestMatches(foundPullRequest, trusted);
    const issue = foundIssue
      ? { state: "discovered" as const, record: foundIssue }
      : await createIssue(tracker, `${basePath}/issues`, marker, request.issue);
    const pullRequest = foundPullRequest
      ? { state: "discovered" as const, record: foundPullRequest }
      : await createPullRequest(tracker, `${basePath}/pulls`, marker, request.pullRequest, trusted);
    assertPullRequestMatches(pullRequest.record, trusted);

    return {
      marker,
      actorLogin: trusted.actorLogin,
      issue: checkpoint(issue),
      pullRequest: { ...checkpoint(pullRequest), expectedHeadSha: trusted.expectedHeadSha },
    };
  });
}

async function createIssue(session: GitHubTrackerSession, path: string, marker: string, input: DevelopmentIssueRequest): Promise<LocatedRecord> {
  const record = await session.request<ProviderRecord>({ method: "POST", path, body: { title: input.title, body: withMarker(input.body, marker) } });
  assertRecord(record, "issue");
  return { state: "created", record };
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

function withMarker(body: string, marker: string): string { return `${body}\n\n${marker}`; }

export { GitHubTrackerError, stableShipyardMarker } from "./markers.js";
