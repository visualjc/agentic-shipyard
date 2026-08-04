import type { RepositoryRef, Topology } from "../contracts/types.js";
import { verifyGitHubActor } from "./authority.js";
import type { GitHubApiCredentialResolver, GitHubRestClientFactory, VerifiedGitHubSession } from "./types.js";
import { GitHubTrackerError, stableShipyardMarker } from "./markers.js";

export type DevelopmentIssueRequest = { title: string; body: string };
export type DevelopmentPullRequestRequest = {
  title: string;
  body: string;
  head: string;
  base: string;
  expectedHeadSha: string;
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
  expectedActorLogin: string;
  credentials: GitHubApiCredentialResolver;
  client: GitHubRestClientFactory;
};

/** Durable caller-owned serialization; tracking never mutates outside this seam. */
export interface DevelopmentRecordMutationGuard {
  exclusive<T>(deliveryId: string, operation: () => Promise<T>): Promise<T>;
}

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

type ProviderRecord = { id?: unknown; node_id?: unknown; number?: unknown; html_url?: unknown; body?: unknown; pull_request?: unknown; head?: { sha?: unknown } };
type LocatedRecord = { state: "discovered" | "created"; record: ProviderRecord };
const MAX_DISCOVERY_PAGES = 100;

/**
 * Finds or creates Shipyard's one issue and one PR in the bound development
 * repository. The topology never accepts a caller-selected repository.
 */
export async function trackDevelopmentRecords(
  authority: DevelopmentRecordAuthority,
  mutationGuard: DevelopmentRecordMutationGuard,
  topology: Topology,
  request: DevelopmentRecordRequest,
): Promise<DevelopmentRecordsCheckpoint> {
  return mutationGuard.exclusive(request.deliveryId, async () => {
    assertExpectedHeadSha(request.pullRequest.expectedHeadSha);
    const session = await verifyGitHubActor(authority.expectedActorLogin, authority.credentials, authority.client);
    const repository = developmentRepository(topology);
    const marker = stableShipyardMarker(request.deliveryId);
    const basePath = `/repos/${repository.owner}/${repository.name}`;

    // Fully discover and validate the pair before the first write. This prevents
    // an unsafe PR state from leaving a newly-created issue behind.
    const [foundIssue, foundPullRequest] = await Promise.all([
      discover(session, `${basePath}/issues`, marker, request.resume?.issueId, "issue", isIssueRecord),
      discover(session, `${basePath}/pulls`, marker, request.resume?.pullRequestId, "pull request", isProviderRecord),
    ]);
    if (foundPullRequest) assertHeadSha(foundPullRequest, request.pullRequest.expectedHeadSha);
    const issue = foundIssue
      ? { state: "discovered" as const, record: foundIssue }
      : await createIssue(session, `${basePath}/issues`, marker, request.issue);
    const pullRequest = foundPullRequest
      ? { state: "discovered" as const, record: foundPullRequest }
      : await createPullRequest(session, `${basePath}/pulls`, marker, request.pullRequest);
    assertHeadSha(pullRequest.record, request.pullRequest.expectedHeadSha);

    return {
      marker,
      actorLogin: session.actorLogin,
      issue: checkpoint(issue),
      pullRequest: { ...checkpoint(pullRequest), expectedHeadSha: request.pullRequest.expectedHeadSha },
    };
  });
}

function developmentRepository(topology: Topology): RepositoryRef {
  return topology.kind === "staged-pair" ? topology.development : topology.repository;
}

async function createIssue(session: VerifiedGitHubSession, path: string, marker: string, input: DevelopmentIssueRequest): Promise<LocatedRecord> {
  const record = await session.write<ProviderRecord>({ method: "POST", path, body: { title: input.title, body: withMarker(input.body, marker) } });
  assertRecord(record, "issue");
  return { state: "created", record };
}

async function createPullRequest(session: VerifiedGitHubSession, path: string, marker: string, input: DevelopmentPullRequestRequest): Promise<LocatedRecord> {
  const record = await session.write<ProviderRecord>({ method: "POST", path, body: { title: input.title, body: withMarker(input.body, marker), head: input.head, base: input.base } });
  assertRecord(record, "pull request");
  return { state: "created", record };
}

async function discover(session: VerifiedGitHubSession, path: string, marker: string, expectedId: string | undefined, label: string, accepts: (value: unknown) => value is ProviderRecord): Promise<ProviderRecord | undefined> {
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

function assertHeadSha(record: ProviderRecord, expected: string): void {
  if (typeof record.head?.sha !== "string" || record.head.sha !== expected) {
    throw new GitHubTrackerError("head-sha-mismatch", "The development pull request head does not match the requested expected SHA.");
  }
}

function assertExpectedHeadSha(expected: string): void {
  if (!/^[0-9a-fA-F]{40}$/.test(expected)) {
    throw new GitHubTrackerError("invalid-head-sha", "The requested expected head SHA must be an exact Git commit SHA.");
  }
}

function withMarker(body: string, marker: string): string { return `${body}\n\n${marker}`; }

export { GitHubTrackerError, stableShipyardMarker } from "./markers.js";
