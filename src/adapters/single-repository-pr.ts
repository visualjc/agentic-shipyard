import type { RepositoryRef } from "../contracts/types.js";
import type { GitHubApiCredentialResolver, GitHubRestClient, GitHubRestClientFactory } from "../github/types.js";
import { stableShipyardMarker } from "../github/markers.js";
import { certificationEndMarker, certificationMarker, dossierDigest } from "../single-repository/dossier.js";
import { SingleRepositoryError } from "../single-repository/errors.js";
import type { SingleRepositoryProviderAuthority, SingleRepositoryProviderSession } from "../single-repository/provider.js";
import type { SingleRepositoryPullRequest, SingleRepositoryTrackedIssue } from "../single-repository/types.js";

type Shape = { id?: unknown; node_id?: unknown; number?: unknown; html_url?: unknown; body?: unknown; state?: unknown; draft?: unknown; merged?: unknown; merged_at?: unknown; merge_commit_sha?: unknown; head?: { ref?: unknown; sha?: unknown; repo?: unknown }; base?: { ref?: unknown; sha?: unknown; repo?: unknown }; pull_request?: unknown };
const MAX_PAGES = 100;

/** Verified actor capability for one existing same-repository PR. It has no create, fork, retarget, or merge operation. */
export class GitHubSingleRepositoryProviderAuthority implements SingleRepositoryProviderAuthority {
  constructor(private readonly credentials: GitHubApiCredentialResolver, private readonly clients: GitHubRestClientFactory) {}

  async open(request: Readonly<{ actorLogin: string; repository: RepositoryRef }>): Promise<SingleRepositoryProviderSession> {
    const client = await this.verified(request.actorLogin), repository = checkedRepository(request.repository);
    const session: SingleRepositoryProviderSession = {
      observeExistingPullRequest: async ({ deliveryId, resumeNumber }) => {
        const marker = stableShipyardMarker(deliveryId), found = await discover(client, repository, "pulls", marker, resumeNumber);
        if (!found) throw new SingleRepositoryError("provider-mismatch", "The one existing marked pull request is missing.");
        return pullRequest(found, repository, deliveryId);
      },
      updateReviewDossier: async ({ expected, dossier }) => {
        const desiredDigest = dossierDigest(dossier), firstRaw = await exactPull(client, repository, expected.number), before = pullRequest(firstRaw, repository, markerDelivery(expected.deliveryMarker));
        requireSamePull(before, expected, true); requireOpen(before); if (before.dossierDigest === desiredDigest) return before;
        await assertViewer(client, request.actorLogin);
        const currentRaw = await exactPull(client, repository, expected.number), current = pullRequest(currentRaw, repository, markerDelivery(expected.deliveryMarker)); requireSamePull(current, expected, true); requireOpen(current);
        if (current.dossierDigest === desiredDigest) return current;
        const body = replaceDossier(rawBody(currentRaw), markerDelivery(expected.deliveryMarker), dossier);
        await client.request({ method: "PATCH", path: `${base(repository)}/pulls/${expected.number}`, body: { body } });
        const after = pullRequest(await exactPull(client, repository, expected.number), repository, markerDelivery(expected.deliveryMarker)); requireSamePull(after, expected, true); requireOpen(after);
        if (after.dossierDigest !== desiredDigest) throw new SingleRepositoryError("unsafe-recovery", "Review dossier update was not confirmed exactly.");
        return after;
      },
      markReady: async ({ expected, dossierDigest: expectedDigest }) => {
        const before = pullRequest(await exactPull(client, repository, expected.number), repository, markerDelivery(expected.deliveryMarker)); requireSamePull(before, expected, true); requireOpen(before);
        if (before.dossierDigest !== expectedDigest) throw new SingleRepositoryError("provider-mismatch", "The exact review dossier is missing before ready certification.");
        if (!before.draft) return before;
        await assertViewer(client, request.actorLogin);
        const current = pullRequest(await exactPull(client, repository, expected.number), repository, markerDelivery(expected.deliveryMarker)); requireSamePull(current, expected, true); requireOpen(current);
        if (current.dossierDigest !== expectedDigest) throw new SingleRepositoryError("provider-mismatch", "The exact review dossier changed before ready certification.");
        if (!current.draft) return current;
        await client.request({ method: "POST", path: `${base(repository)}/pulls/${expected.number}/ready_for_review` });
        const after = pullRequest(await exactPull(client, repository, expected.number), repository, markerDelivery(expected.deliveryMarker)); requireSamePull(after, expected, true); requireOpen(after);
        if (after.draft || after.dossierDigest !== expectedDigest) throw new SingleRepositoryError("unsafe-recovery", "Pull request readiness was not confirmed exactly.");
        return after;
      },
      observeTrackedIssue: async (deliveryId) => { const found = await discover(client, repository, "issues", stableShipyardMarker(deliveryId), undefined, true); return found ? issue(found, repository, deliveryId) : undefined; },
      closeTrackedIssue: async (expected) => {
        const deliveryId = markerDelivery(expected.deliveryMarker), before = issue(await exactIssue(client, repository, expected.number), repository, deliveryId); if (!sameIssue(before, expected)) throw new SingleRepositoryError("provider-mismatch", "Tracked issue identity changed before close."); if (before.state === "closed") return;
        await assertViewer(client, request.actorLogin); const current = issue(await exactIssue(client, repository, expected.number), repository, deliveryId); if (!sameIssue(current, expected)) throw new SingleRepositoryError("provider-mismatch", "Tracked issue identity changed before close."); if (current.state === "closed") return; await client.request({ method: "PATCH", path: `${base(repository)}/issues/${expected.number}`, body: { state: "closed" } });
        const after = issue(await exactIssue(client, repository, expected.number), repository, deliveryId); if (!sameIssue(after, expected) || after.state !== "closed") throw new SingleRepositoryError("unsafe-recovery", "Tracked issue close was not confirmed exactly.");
      },
    };
    return Object.freeze(session);
  }

  private async verified(actorLogin: string): Promise<GitHubRestClient> { let credential; try { credential = await this.credentials.resolve(); } catch { throw authority(); } if (!credential?.authorizationValue) throw authority(); let client; try { client = this.clients.forCredential(credential); } catch { throw authority(); } await assertViewer(client, actorLogin); return client; }
}

async function assertViewer(client: GitHubRestClient, actor: string): Promise<void> { try { const viewer = await client.request<{ login?: unknown }>({ method: "GET", path: "/user" }); if (viewer.login !== actor) throw new Error(); } catch { throw authority(); } }
async function discover(client: GitHubRestClient, repository: RepositoryRef, kind: "issues" | "pulls", marker: string, resumeNumber?: number, issuesOnly = false): Promise<Shape | undefined> { let found: Shape | undefined, exhausted = false; for (let page = 1; page <= MAX_PAGES; page++) { const values = await client.request<unknown>({ method: "GET", path: `${base(repository)}/${kind}?state=all&per_page=100&page=${page}` }); if (!Array.isArray(values)) throw mismatch(); for (const candidate of values) { if (!shape(candidate) || (issuesOnly && "pull_request" in candidate) || typeof candidate.body !== "string" || !candidate.body.split(/\r?\n/).includes(marker)) continue; if (found) throw new SingleRepositoryError("provider-mismatch", "Multiple marked provider records make single-repository authority ambiguous."); found = candidate; } if (values.length < 100) { exhausted = true; break; } } if (!exhausted) throw mismatch(); if (resumeNumber !== undefined && (!found || recordNumber(found) !== resumeNumber)) throw new SingleRepositoryError("provider-mismatch", "Checkpointed existing pull request is missing or replaced."); return found; }
async function exactPull(client: GitHubRestClient, repository: RepositoryRef, number: number): Promise<Shape> { const value = await client.request<unknown>({ method: "GET", path: `${base(repository)}/pulls/${number}` }); if (!shape(value)) throw mismatch(); return value; }
async function exactIssue(client: GitHubRestClient, repository: RepositoryRef, number: number): Promise<Shape> { const value = await client.request<unknown>({ method: "GET", path: `${base(repository)}/issues/${number}` }); if (!shape(value) || "pull_request" in value) throw mismatch(); return value; }
function pullRequest(value: Shape, repository: RepositoryRef, deliveryId: string): SingleRepositoryPullRequest { const state = value.merged === true || value.merged_at ? "merged" : value.state === "open" ? "open" : value.state === "closed" ? "closed" : undefined, merge = state === "merged" ? objectId(value.merge_commit_sha) : undefined, headRepository = repoIdentity(value.head?.repo), baseRepository = repoIdentity(value.base?.repo), deliveryMarker = stableShipyardMarker(deliveryId); if (!state || typeof value.draft !== "boolean" || !markerLine(value.body, deliveryMarker) || !recordId(value) || !recordNumber(value) || typeof value.html_url !== "string" || typeof value.head?.ref !== "string" || typeof value.base?.ref !== "string") throw mismatch(); if (!sameRepo(headRepository, repository) || !sameRepo(baseRepository, repository)) throw new SingleRepositoryError("provider-mismatch", "Existing pull request is forked or cross-repository."); const digest = observedDossierDigest(value.body, deliveryId); return freeze({ id: recordId(value)!, number: recordNumber(value)!, url: value.html_url, deliveryMarker, repository: { owner: repository.owner, name: repository.name }, headRepository, baseRepository, headRef: value.head.ref, baseRef: value.base.ref, headSha: objectId(value.head.sha), baseSha: objectId(value.base.sha), state, draft: value.draft, isCrossRepository: false, ...(digest ? { dossierDigest: digest } : {}), ...(merge ? { mergeCommitSha: merge } : {}) }); }
function issue(value: Shape, repository: RepositoryRef, deliveryId: string): SingleRepositoryTrackedIssue { const deliveryMarker = stableShipyardMarker(deliveryId); if (!recordId(value) || !recordNumber(value) || value.html_url !== `https://github.com/${repository.owner}/${repository.name}/issues/${recordNumber(value)}` || !markerLine(value.body, deliveryMarker) || (value.state !== "open" && value.state !== "closed")) throw mismatch(); return freeze({ id: recordId(value)!, number: recordNumber(value)!, url: value.html_url, deliveryMarker, state: value.state }); }
function requireSamePull(left: SingleRepositoryPullRequest, right: SingleRepositoryPullRequest, permitPresentationChange: boolean): void { if (left.id !== right.id || left.number !== right.number || left.url !== right.url || left.deliveryMarker !== right.deliveryMarker || left.headRef !== right.headRef || left.baseRef !== right.baseRef || left.headSha !== right.headSha || left.baseSha !== right.baseSha || !sameRepo(left.repository, right.repository) || !sameRepo(left.headRepository, right.headRepository) || !sameRepo(left.baseRepository, right.baseRepository) || left.isCrossRepository !== false || right.isCrossRepository !== false || (!permitPresentationChange && (left.draft !== right.draft || left.dossierDigest !== right.dossierDigest))) throw new SingleRepositoryError("provider-mismatch", "Existing pull request identity, topology, base, or exact head changed."); }
function requireOpen(value: SingleRepositoryPullRequest): void { if (value.state !== "open" || value.mergeCommitSha) throw new SingleRepositoryError("provider-mismatch", "Certification requires the existing pull request to remain open and unmerged."); }
function replaceDossier(body: string, deliveryId: string, dossier: string): string { dossierDigest(dossier); const start = certificationMarker(deliveryId), end = certificationEndMarker(deliveryId), starts = lines(body, start), ends = lines(body, end); if (starts.length !== ends.length || starts.length > 1) throw new SingleRepositoryError("provider-mismatch", "Existing certification dossier markers are incomplete or ambiguous."); const section = `${start}\n${dossier}\n${end}`; if (starts.length === 0) return `${body.trim()}\n\n${section}`.trim(); if (starts[0]! >= ends[0]!) throw mismatch(); const values = body.split(/\r?\n/); return [...values.slice(0, starts[0]), ...section.split("\n"), ...values.slice(ends[0]! + 1)].join("\n").trim(); }
function observedDossierDigest(body: unknown, deliveryId: string): string | undefined { if (typeof body !== "string") return undefined; const start = certificationMarker(deliveryId), end = certificationEndMarker(deliveryId), starts = lines(body, start), ends = lines(body, end); if (starts.length === 0 && ends.length === 0) return undefined; if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) throw mismatch(); const dossier = body.split(/\r?\n/).slice(starts[0]! + 1, ends[0]!).join("\n"); return dossierDigest(dossier); }
function lines(body: string, marker: string): number[] { const found: number[] = []; body.split(/\r?\n/).forEach((line, index) => { if (line === marker) found.push(index); }); return found; }
function rawBody(value: Shape): string { if (typeof value.body !== "string" || value.body.length > 60_000) throw mismatch(); return value.body; }
function markerDelivery(marker: string): string { const match = /^<!-- shipyard:development-record:v1:([a-z0-9][a-z0-9._-]{0,63}) -->$/.exec(marker); if (!match || match[1]!.includes("..")) throw mismatch(); return match[1]!; }
function checkedRepository(value: RepositoryRef): RepositoryRef { if (!value.owner || !value.name || !value.defaultBranch || !exactGitHubRepositoryUrl(value.remote.url, value.owner, value.name)) throw authority(); return freeze(structuredClone(value)); }
function exactGitHubRepositoryUrl(value: string, owner: string, name: string): boolean { return value === `https://github.com/${owner}/${name}` || value === `https://github.com/${owner}/${name}.git`; }
function repoIdentity(value: unknown): Readonly<{ owner: string; name: string }> { if (!value || typeof value !== "object") throw mismatch(); const repository = value as { name?: unknown; full_name?: unknown; owner?: { login?: unknown } }; if (typeof repository.name !== "string" || typeof repository.owner?.login !== "string" || repository.full_name !== `${repository.owner.login}/${repository.name}`) throw mismatch(); return freeze({ owner: repository.owner.login, name: repository.name }); }
function sameRepo(left: Readonly<{ owner: string; name: string }>, right: Readonly<{ owner: string; name: string }>): boolean { return left.owner === right.owner && left.name === right.name; }
function sameIssue(left: SingleRepositoryTrackedIssue, right: SingleRepositoryTrackedIssue): boolean { return left.id === right.id && left.number === right.number && left.url === right.url && left.deliveryMarker === right.deliveryMarker; }
function base(repository: RepositoryRef): string { return `/repos/${repository.owner}/${repository.name}`; }
function markerLine(value: unknown, marker: string): boolean { return typeof value === "string" && value.split(/\r?\n/).includes(marker); }
function recordId(value: Shape): string | undefined { return typeof value.node_id === "string" && value.node_id ? value.node_id : typeof value.id === "string" && value.id ? value.id : typeof value.id === "number" && Number.isFinite(value.id) ? String(value.id) : undefined; }
function recordNumber(value: Shape): number | undefined { return typeof value.number === "number" && Number.isSafeInteger(value.number) && value.number > 0 ? value.number : undefined; }
function objectId(value: unknown): string { if (typeof value !== "string" || !(/^[a-f0-9]{40}$/.test(value) || /^[a-f0-9]{64}$/.test(value))) throw mismatch(); return value; }
function shape(value: unknown): value is Shape { return typeof value === "object" && value !== null && !Array.isArray(value); }
function authority(): SingleRepositoryError { return new SingleRepositoryError("authority-changed", "GitHub command-scoped actor authority could not be verified."); }
function mismatch(): SingleRepositoryError { return new SingleRepositoryError("provider-mismatch", "Provider record does not match exact single-repository authority."); }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
