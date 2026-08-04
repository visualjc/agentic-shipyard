import type { StatusBlocker, StatusContributor } from "../status/projection.js";
import type { DevelopmentRecordsCheckpoint } from "./tracker.js";

export type GitHubTrackerStatus = {
  actorLogin: string;
  permission: "verified" | "blocked";
  checkpoint?: DevelopmentRecordsCheckpoint;
  blocker?: StatusBlocker;
};

/** Pure status projection: it reports tracker facts and never calls the provider. */
export function githubTrackerStatusContributor(status: GitHubTrackerStatus): StatusContributor {
  return current => {
    const checkpoint = status.checkpoint;
    const providerRefs: Record<string, string> = {
      ...(current.providerRefs ?? {}),
      githubActor: status.actorLogin,
      githubPermission: status.permission,
    };
    if (checkpoint) {
      providerRefs.developmentIssue = checkpoint.issue.url;
      providerRefs.developmentIssueId = checkpoint.issue.id;
      providerRefs.developmentPullRequest = checkpoint.pullRequest.url;
      providerRefs.developmentPullRequestId = checkpoint.pullRequest.id;
      providerRefs.developmentPullRequestExpectedHeadSha = checkpoint.pullRequest.expectedHeadSha;
      providerRefs.developmentRecordMarker = checkpoint.marker;
    }
    return {
      providerRefs,
      ...(status.blocker ? {
        blockers: [status.blocker],
        nextSafeAction: "Resolve the GitHub tracker blocker before retrying.",
      } : { nextSafeAction: "shipyard-status" }),
    };
  };
}
