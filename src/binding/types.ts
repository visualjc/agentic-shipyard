import type { Binding } from "../contracts/types.js";

/** The store contains the public, durable Binding contract verbatim. */
export type RepositoryBinding = Binding;
export type RepositoryTopology = Binding["topology"];

export interface BindingDocument { schemaVersion: 1; bindings: RepositoryBinding[]; }

export interface BindingStore {
  read(): Promise<BindingDocument | undefined>;
  write(document: BindingDocument): Promise<void>;
}
