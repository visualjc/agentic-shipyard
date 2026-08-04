import { GitLedgerStore } from "../adapters/ledger-git.js";
import { NodeSyncGit } from "../adapters/sync-git.js";
import type { CommandRuntime } from "../cli/runtime.js";
import { ActiveBoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import { SyncService } from "../sync/service.js";
import { DestinationSyncTransport } from "../sync/transport.js";
import { FetchGitHubRestTransport, GitHubRestAdapter } from "../adapters/github-rest.js";
import { verifyGitHubActor } from "../github/authority.js";

export async function sync(runtime: CommandRuntime, repositoryPath: string, sourceRef: string | undefined) {
  const authority = new ActiveBoundProfileAuthorityResolver(runtime.bindings, runtime.profiles);
  const credentials = { resolve: async (expectedActorLogin: string) => { const token = process.env.SHIPYARD_GIT_TOKEN; if (!token) return undefined; const fixed = { resolve: async () => ({ authorizationValue: token }) }; const api = new GitHubRestAdapter(fixed, new FetchGitHubRestTransport()); await verifyGitHubActor(expectedActorLogin, fixed, api); return { token, verifiedActorLogin: expectedActorLogin }; } };
  const transport = new DestinationSyncTransport(authority, runtime.git, credentials);
  return new SyncService({ authority, profiles: runtime.profiles, git: new NodeSyncGit(), transport, ledger: new GitLedgerStore(repositoryPath), locks: runtime.locks, lockPath: runtime.setupLockPath }).sync({ repositoryPath, ...(sourceRef === undefined ? {} : { sourceRef }) });
}
