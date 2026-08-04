import type { RepositoryRef, Topology } from "../contracts/types.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import type { GitObjectFormat, ObjectFormatAuthority } from "../ledger/types.js";

export const CONTEXT_ROLES = ["implementer", "reviewer", "status"] as const;
export const CANONICAL_LEDGER_REF = "refs/heads/shipyard-ledger";
export type ContextRole = (typeof CONTEXT_ROLES)[number];

/** The only host-specific handoff data. Keep this shape independent of any host SDK. */
export type ContextAdapterRequest = Readonly<{ host: string; role: ContextRole; envelopePath: string; repoRoot: string }>;
/** Trusted dispatch capability, supplied by the host rather than the serialized envelope. */
export type ContextDispatchExpectation = Readonly<{
  profile: string;
  /** Trusted binding/profile identity; never sourced from the envelope. */
  profileFingerprint: string;
  topology: Readonly<Topology>;
  repository: Readonly<RepositoryRef>;
  deliveryId: string;
  host: string;
  role: ContextRole;
  envelopePath: string;
  repoRoot: string;
  productBranch: string;
  productSha: string;
  ledgerRef: string;
  ledgerSha: string;
  objectFormat: GitObjectFormat;
}>;

/** Revalidates the dispatch repository against the live binding/profile pair. */
export type ContextAuthorityResolver = Pick<BoundProfileAuthorityResolver, "resolve">;

/** A self-contained, pinned, role-limited ledger context. */
export type ContextEnvelope = Readonly<{
  schemaVersion: 1;
  profile: string;
  topology: Readonly<Topology>;
  repository: Readonly<RepositoryRef>;
  deliveryId: string;
  host: string;
  role: ContextRole;
  productBranch: string;
  productSha: string;
  ledgerRef: string;
  ledgerSha: string;
  objectFormat: GitObjectFormat;
  records: readonly string[];
  adapter: ContextAdapterRequest;
}>;

export type ContextEnvelopeInput = Omit<ContextEnvelope, "schemaVersion" | "records" | "adapter"> & {
  envelopePath: string;
  repoRoot: string;
  records?: readonly string[];
};

/** Deliberately narrow: records must be read from the envelope's exact ledger object. */
export interface PinnedLedgerReader extends ObjectFormatAuthority {
  read(ledgerSha: string, paths: readonly string[]): Promise<Readonly<Record<string, string>>>;
}

export interface ProductShaReader {
  currentProductSha(repoRoot: string): Promise<string>;
}
