export type TopologyKind = "staged-pair" | "single-repository";

export interface RemoteExpectation {
  name: string;
  url: string;
}

export interface RepositoryTopology {
  kind: TopologyKind;
  /** Development repository remote is required for both topology kinds. */
  development: RemoteExpectation;
  /** Required only for a staged pair; setup only validates, it never rewrites it. */
  destination?: RemoteExpectation;
}

export interface RepositoryBinding {
  version: 1;
  profile: string;
  commonDirectory: string;
  topology: RepositoryTopology;
  createdAt: string;
}

export interface BindingDocument {
  version: 1;
  bindings: RepositoryBinding[];
}

export interface BindingStore {
  read(): Promise<BindingDocument | undefined>;
  write(document: BindingDocument): Promise<void>;
}
