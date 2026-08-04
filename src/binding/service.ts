import { GitAdapter } from "../adapters/git.js";
import { BindingError } from "./errors.js";
import type { Binding, Topology } from "../contracts/types.js";
import { validateBinding } from "../contracts/validate.js";
import { BindingDocument, BindingStore, RepositoryBinding } from "./types.js";

export class BindingService {
  constructor(private readonly store: BindingStore, private readonly git: GitAdapter) {}

  async resolve(repositoryPath: string): Promise<RepositoryBinding> {
    const commonDirectory = await this.git.commonDirectory(repositoryPath);
    const document = validateBindingDocument(await this.store.read());
    if (!document) throw new BindingError("repository-unbound", "No Shipyard binding document exists.");
    const matches = document.bindings.filter((binding) => binding.commonDirectory === commonDirectory);
    if (matches.length === 0) throw new BindingError("repository-unbound", "Repository has no Shipyard binding.");
    if (matches.length !== 1) throw new BindingError("binding-duplicate", "Repository resolves to more than one Shipyard binding.");
    const binding = matches[0];
    await validateBoundRepository(repositoryPath, binding, this.git);
    return binding;
  }

  async bind(repositoryPath: string, candidate: Omit<Binding, "schemaVersion" | "commonDirectory">, rebind = false): Promise<RepositoryBinding> {
    const candidateBinding = validateBinding({ ...candidate, schemaVersion: 1, commonDirectory: "/candidate" });
    await validateRemotes(repositoryPath, candidateBinding.topology, this.git);
    const commonDirectory = await this.git.commonDirectory(repositoryPath);
    const document = validateBindingDocument(await this.store.read()) ?? { schemaVersion: 1, bindings: [] };
    const existing = document.bindings.filter((binding) => binding.commonDirectory === commonDirectory);
    if (existing.length > 1) throw new BindingError("binding-duplicate", "Repository resolves to more than one Shipyard binding.");
    if (existing.length === 1 && !rebind) throw new BindingError("binding-stale", "Repository is already bound; replacement requires explicit rebind intent.");
    const binding = validateBinding({ ...candidateBinding, commonDirectory });
    const bindings = existing.length === 1
      ? document.bindings.map((entry) => entry.commonDirectory === commonDirectory ? binding : entry)
      : [...document.bindings, binding];
    await this.store.write(validateBindingDocument({ schemaVersion: 1, bindings })!);
    return binding;
  }
}

export function validateTopology(topology: Topology): void {
  try { validateBinding({ schemaVersion: 1, profileName: "topology-check", commonDirectory: "/topology-check", topology, profileFingerprint: "0".repeat(64), boundAt: "2026-01-01T00:00:00.000Z" }); }
  catch { throw new BindingError("topology-invalid", "Topology is not a valid canonical binding topology."); }
}

export async function validateBoundRepository(path: string, binding: Binding, git: GitAdapter): Promise<void> {
  try { validateBinding(binding); } catch { throw new BindingError("binding-store-invalid", "Binding is not a valid canonical version 1 binding."); }
  const commonDirectory = await git.commonDirectory(path);
  if (commonDirectory !== binding.commonDirectory) {
    throw new BindingError("binding-stale", "Repository common directory no longer matches its binding.");
  }
  await validateRemotes(path, binding.topology, git);
}

export async function validateRemotes(path: string, topology: Topology, git: GitAdapter): Promise<void> {
  const expected = topology.kind === "staged-pair" ? [topology.development.remote, topology.destination.remote] : [topology.repository.remote];
  for (const remote of expected) {
    const actual = await git.remoteUrl(path, remote.name);
    if (actual !== remote.url) {
      throw new BindingError("binding-remote-mismatch", `Remote ${remote.name} does not match the bound topology.`);
    }
  }
}

export function newBindingDocument(bindings: RepositoryBinding[] = []): BindingDocument {
  return validateBindingDocument({ schemaVersion: 1, bindings })!;
}

/** Canonical port boundary for every BindingStore, including in-memory adapters. */
export function validateBindingDocument(value: unknown): BindingDocument | undefined {
  if (value === undefined) return undefined;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || record.schemaVersion !== 1 || !Array.isArray(record.bindings)) throw new Error();
    const bindings = record.bindings.map((binding) => validateBinding(binding));
    const commonDirectories = bindings.map((binding) => binding.commonDirectory);
    if (new Set(commonDirectories).size !== commonDirectories.length) throw new Error();
    return { schemaVersion: 1, bindings };
  } catch { throw new BindingError("binding-store-invalid", "Binding store is not a valid canonical version 1 binding document."); }
}
