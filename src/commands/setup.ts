import { BindingService, RepositoryTopology } from "../index.js";

export type SetupInput = Readonly<{
  repositoryPath: string;
  profile: string;
  topology: RepositoryTopology;
  rebind: boolean;
  now?: () => Date;
}>;

export async function setup(bindings: BindingService, input: SetupInput) {
  return bindings.bind(input.repositoryPath, {
    profile: input.profile,
    topology: input.topology,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  }, input.rebind);
}
