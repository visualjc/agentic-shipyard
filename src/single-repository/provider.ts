import type { RepositoryRef } from "../contracts/types.js";
import type { SingleRepositoryPullRequest, SingleRepositoryTrackedIssue } from "./types.js";

export interface SingleRepositoryProviderSession {
  observeExistingPullRequest(request: Readonly<{ deliveryId: string; resumeNumber?: number }>): Promise<SingleRepositoryPullRequest>;
  updateReviewDossier(request: Readonly<{ expected: SingleRepositoryPullRequest; dossier: string }>): Promise<SingleRepositoryPullRequest>;
  markReady(request: Readonly<{ expected: SingleRepositoryPullRequest; dossierDigest: string }>): Promise<SingleRepositoryPullRequest>;
  observeTrackedIssue(deliveryId: string): Promise<SingleRepositoryTrackedIssue | undefined>;
  closeTrackedIssue(expected: SingleRepositoryTrackedIssue): Promise<void>;
}

export interface SingleRepositoryProviderAuthority {
  open(request: Readonly<{ actorLogin: string; repository: RepositoryRef }>): Promise<SingleRepositoryProviderSession>;
}
