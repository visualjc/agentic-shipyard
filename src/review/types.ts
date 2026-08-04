import type { ReviewRequest, ReviewResult } from "../evidence/types.js";
export type ReviewDispatch = Readonly<{ host: string; reviewRequestPath: string; reviewerEnvelopePath: string; repoRoot: string; role: "reviewer"; sealedBundle: string }>;
export type ReviewProcessAttestation = Readonly<{ processId: number; sessionId: string; fresh: true; commandVersion: string; bundleDigest: string }>;
export type ProcessRun = Readonly<{ stdout: string; stderr: string; processId: number; sessionId: string; exitCode?: number; timedOut?: boolean; oversize?: boolean; reused?: boolean }>;
export interface EphemeralProcessRunner { run(input: Readonly<{ executable: string; args: readonly string[]; env: Readonly<Record<string,string>>; stdin: string; cwd: string; timeoutMs: number }>): Promise<ProcessRun>; }
export interface IndependentReviewAdapter { review(dispatch: ReviewDispatch, request: ReviewRequest): Promise<Readonly<{ result: ReviewResult; attestation: ReviewProcessAttestation }>>; }
export type ReviewDispatchResult = Awaited<ReturnType<IndependentReviewAdapter["review"]>>;
