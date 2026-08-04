import type { RepositoryRef, Topology } from "../contracts/types.js";
import type { DeliveryResolver } from "../delivery/resolver.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import { sameTopology } from "../profile/policy.js";
import { GitHubTrackerError } from "./markers.js";
import type { WorkspaceGit } from "../workspace/service.js";

/** Trusted facts used to build the only permitted development PR request. */
export type DevelopmentTrackingAuthority = Readonly<{
  commonDirectory: string;
  actorLogin: string;
  repository: Readonly<RepositoryRef>;
  head: string;
  base: string;
  expectedHeadSha: string;
}>;

/** Resolves all mutation-target facts from the active profile/binding/delivery state. */
export interface DevelopmentTrackingAuthorityResolver {
  resolve(repositoryPath: string, deliveryId: string): Promise<DevelopmentTrackingAuthority>;
}

export class ActiveDevelopmentTrackingAuthorityResolver implements DevelopmentTrackingAuthorityResolver {
  constructor(private readonly deliveries: DeliveryResolver, private readonly bound: BoundProfileAuthorityResolver, private readonly git: Pick<WorkspaceGit, "worktreeIdentity" | "branchHead" | "productHead">) {}

  async resolve(repositoryPath: string, deliveryId: string): Promise<DevelopmentTrackingAuthority> {
    const [delivery, profile] = await Promise.all([
      this.deliveries.resolve({ repositoryPath, deliveryId }),
      this.bound.resolve(repositoryPath, "review"),
    ]);
    if (delivery.binding.commonDirectory !== profile.commonDirectory || delivery.binding.profileFingerprint !== profile.profileFingerprint || !sameTopology(delivery.binding.topology, profile.topology)) {
      throw new GitHubTrackerError("authority-mismatch", "Active delivery, binding, and profile authority do not describe the same repository.");
    }
    const repository = developmentRepository(profile.topology);
    const head = delivery.workspace.branch;
    if (head !== `shipyard/${deliveryId}` || head.includes(":")) throw new GitHubTrackerError("noncanonical-ref", "The development pull request head must be the delivery's canonical local branch.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(repository.defaultBranch) || repository.defaultBranch.includes("..") || repository.defaultBranch.includes(":")) throw new GitHubTrackerError("noncanonical-ref", "The development pull request base must be the bound repository's safe unqualified default branch.");
    const identity = await this.git.worktreeIdentity(delivery.workspace.worktreePath);
    if (!identity || identity.commonDirectory !== profile.commonDirectory || identity.branch !== head) throw new GitHubTrackerError("authority-mismatch", "The live delivery worktree no longer matches its registered common directory and branch.");
    const [expectedHeadSha, branchHead] = await Promise.all([this.git.productHead(delivery.workspace.worktreePath), this.git.branchHead(delivery.workspace.worktreePath, head)]);
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expectedHeadSha) || branchHead !== expectedHeadSha) throw new GitHubTrackerError("authority-mismatch", "The live delivery worktree HEAD is detached, stale, or differs from its canonical branch head.");
    return freeze({ commonDirectory: profile.commonDirectory, actorLogin: profile.actorLogin, repository: structuredClone(repository), head, base: repository.defaultBranch, expectedHeadSha });
  }
}

function developmentRepository(topology: Topology): RepositoryRef { return topology.kind === "staged-pair" ? topology.development : topology.repository; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
