import type { Operation, Profile, Topology } from "../contracts/types.js";
import { BindingError } from "../binding/errors.js";

/** Core port; filesystem-backed profile lookup lives at the CLI adapter boundary. */
export interface ProfileReader { read(name: string): Promise<Profile>; }
export type TopologyRequest = { kind: Topology["kind"]; development: { name: string; url: string }; destination?: { name: string; url: string } };

export function requireProfileAuthorization(profile: Profile, operation: Operation): void {
  if (!profile.allowedOperations.includes(operation)) throw new BindingError("profile-operation-denied", `Profile ${profile.name} does not authorize ${operation}.`);
}

export function requireMatchingTopology(profile: Profile, requested: TopologyRequest): void {
  const expected = profile.topology.kind === "staged-pair"
    ? { kind: "staged-pair" as const, development: profile.topology.development.remote, destination: profile.topology.destination.remote }
    : { kind: "single-repository" as const, development: profile.topology.repository.remote };
  const same = (left: { name: string; url: string }, right: { name: string; url: string }) => left.name === right.name && left.url === right.url;
  if (expected.kind !== requested.kind || !same(expected.development, requested.development) || (expected.kind === "staged-pair" && (!requested.destination || !same(expected.destination, requested.destination)))) {
    throw new BindingError("profile-topology-mismatch", `Requested topology does not match global profile ${profile.name}.`);
  }
}

export function sameTopology(left: Topology, right: Topology): boolean { return JSON.stringify(left) === JSON.stringify(right); }
