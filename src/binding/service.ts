import { GitAdapter } from "../adapters/git.js";
import { BindingError } from "./errors.js";
import { BindingDocument, BindingStore, RepositoryBinding, RepositoryTopology } from "./types.js";

export class BindingService {
  constructor(private readonly store: BindingStore, private readonly git: GitAdapter) {}

  async resolve(repositoryPath: string): Promise<RepositoryBinding> {
    const commonDirectory = await this.git.commonDirectory(repositoryPath);
    const document = await this.store.read();
    if (!document) throw new BindingError("repository-unbound", "No Shipyard binding document exists.");
    const matches = document.bindings.filter((binding) => binding.commonDirectory === commonDirectory);
    if (matches.length === 0) throw new BindingError("repository-unbound", "Repository has no Shipyard binding.");
    if (matches.length !== 1) throw new BindingError("binding-duplicate", "Repository resolves to more than one Shipyard binding.");
    const binding = matches[0];
    await validateBoundRepository(repositoryPath, binding, this.git);
    return binding;
  }

  async bind(repositoryPath: string, candidate: Omit<RepositoryBinding, "version" | "commonDirectory">, rebind = false): Promise<RepositoryBinding> {
    validateTopology(candidate.topology);
    await validateRemotes(repositoryPath, candidate.topology, this.git);
    const commonDirectory = await this.git.commonDirectory(repositoryPath);
    const document = (await this.store.read()) ?? { version: 1, bindings: [] };
    const existing = document.bindings.filter((binding) => binding.commonDirectory === commonDirectory);
    if (existing.length > 1) throw new BindingError("binding-duplicate", "Repository resolves to more than one Shipyard binding.");
    if (existing.length === 1 && !rebind) throw new BindingError("binding-stale", "Repository is already bound; replacement requires explicit rebind intent.");
    const binding: RepositoryBinding = { ...candidate, version: 1, commonDirectory };
    const bindings = existing.length === 1
      ? document.bindings.map((entry) => entry.commonDirectory === commonDirectory ? binding : entry)
      : [...document.bindings, binding];
    await this.store.write({ version: 1, bindings });
    return binding;
  }
}

export function validateTopology(topology: RepositoryTopology): void {
  if (!topology.development?.name || !topology.development.url) {
    throw new BindingError("topology-incomplete", "Topology needs a development remote name and URL.");
  }
  if (topology.kind === "staged-pair") {
    if (!topology.destination?.name || !topology.destination.url) {
      throw new BindingError("topology-incomplete", "A staged-pair topology needs a destination remote name and URL.");
    }
    if (topology.destination.name === topology.development.name || topology.destination.url === topology.development.url) {
      throw new BindingError("topology-invalid", "A staged pair needs distinct development and destination remotes.");
    }
  } else if (topology.destination !== undefined) {
    throw new BindingError("topology-invalid", "A single-repository topology cannot declare a destination remote.");
  }
}

export async function validateBoundRepository(path: string, binding: RepositoryBinding, git: GitAdapter): Promise<void> {
  validateTopology(binding.topology);
  const commonDirectory = await git.commonDirectory(path);
  if (commonDirectory !== binding.commonDirectory) {
    throw new BindingError("binding-stale", "Repository common directory no longer matches its binding.");
  }
  await validateRemotes(path, binding.topology, git);
}

export async function validateRemotes(path: string, topology: RepositoryTopology, git: GitAdapter): Promise<void> {
  const expected = [topology.development, ...(topology.kind === "staged-pair" ? [topology.destination!] : [])];
  for (const remote of expected) {
    const actual = await git.remoteUrl(path, remote.name);
    if (actual !== remote.url) {
      throw new BindingError("binding-remote-mismatch", `Remote ${remote.name} does not match the bound topology.`);
    }
  }
}

export function newBindingDocument(bindings: RepositoryBinding[] = []): BindingDocument {
  return { version: 1, bindings };
}
