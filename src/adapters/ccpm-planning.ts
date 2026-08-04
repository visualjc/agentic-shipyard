import type { PlanningArtifactResult } from "./matt-skills.js";
export type CcpmPlanningEnvelope = Readonly<{ role: "planner"; recordId: string; repositoryPath: string; productSha: string; objectFormat: "sha1" | "sha256"; steps: readonly ["ccpm-prd", "ccpm-vertical-tasks"]; requestText: string; acceptanceAuthority: false }>;
/** Synthesis has no acceptance/evidence/issue/PR/provider authority. */
export interface CcpmPlanner { synthesize(envelope: CcpmPlanningEnvelope): Promise<Readonly<{ resumeCheckpoint: string; artifacts: readonly PlanningArtifactResult[]; acceptanceAuthority: false }>>; }
