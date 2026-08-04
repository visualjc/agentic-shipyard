import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { GraphProfile, Profile } from "../contracts/types.js";
import { validateProfile } from "../contracts/validate.js";
import { createNodeGraphFiles, createNodeLocalGraphCommand, graphDescriptorPath, NodeGraphLockStore, readGraphDescriptorText, removeGraphDescriptor, writeGraphDescriptor } from "../adapters/graph-runtime.js";
import { DEFAULT_NODE_GIT_EXECUTABLE } from "../adapters/git-transport.js";
import { nodeProcess, type ProcessAdapter } from "../adapters/process.js";
import { refreshCodeGraph, seedCodeGraph } from "./codegraph.js";
import { createGitGraphSourceReader, snapshotGraphSource, type GraphSourceReader } from "./fingerprint.js";
import { evaluateGraphFreshness, graphDecision, graphLockPath, graphOperationLockIdentity } from "./freshness.js";
import { refreshGraphify, seedGraphify } from "./graphify.js";
import type { GraphSeedAuthorization } from "./baseline.js";
import { GraphLockService, type GraphLockStore } from "./lock.js";
import type { GraphDecision, GraphDescriptor, GraphResult } from "./types.js";
import { validateGraphDescriptor as snapshotDescriptor } from "./validation.js";

export interface GraphLaneStatusReader { status(profile: Profile, worktree: string): Promise<{ enabled: boolean; adapter?: string; receipt?: string; decision: GraphDecision }>; }
export interface GraphLaneController extends GraphLaneStatusReader { refresh(profile: Profile, worktree: string): Promise<GraphResult>; seed(profile: Profile, worktree: string, authorization: GraphSeedAuthorization): Promise<GraphResult>; }

/** Controlled production graph lane. No installer, provider, network, or raw mutation port is exposed. */
export function createGraphLaneService(home: string, gitExecutable = DEFAULT_NODE_GIT_EXECUTABLE): GraphLaneController { return createService(home, gitExecutable, {}); }
/** Internal deterministic test seam; deliberately absent from the package barrel. */
export function createGraphLaneServiceForTesting(home: string, gitExecutable: string, dependencies: { reader?: GraphSourceReader; process?: ProcessAdapter; lockStore?: GraphLockStore }): GraphLaneController { return createService(home, gitExecutable, dependencies); }
function createService(home: string, gitExecutable: string, dependencies: { reader?: GraphSourceReader; process?: ProcessAdapter; lockStore?: GraphLockStore }): GraphLaneController {
  const process = dependencies.process ?? nodeProcess;
  const store = dependencies.lockStore ?? new NodeGraphLockStore();
  const lock = new GraphLockService(store, process);
  const operationLock = { acquire: (path: string) => lock.acquire(path), release: (path: string, owner: import("./types.js").GraphCacheLock) => lock.release(path, owner) };
  let productionReader: GraphSourceReader | undefined;
  const sourceReader = () => dependencies.reader ?? (productionReader ??= createGitGraphSourceReader(gitExecutable));
  return {
    async status(input, worktree) {
      let profile: Profile; try { profile = validateProfile(input); } catch { return { enabled: false, decision: graphDecision("invalid", "Graph profile is invalid.") }; }
      if (!profile.graph?.enabled) return disabled("Experimental graph acceleration is disabled.");
      try {
        const source = await snapshotGraphSource(sourceReader(), worktree); const path = graphDescriptorPath(home, profile.graph.adapter, source.worktreeInstanceId); const text = await readGraphDescriptorText(path);
        let descriptor: GraphDescriptor | undefined;
        if (text !== undefined) { try { descriptor = snapshotDescriptor(JSON.parse(text)); } catch { return projected(profile.graph, graphDecision("invalid", "Stored graph descriptor is malformed.")); } }
        if (descriptor && profile.graph.adapter === "graphify" && descriptor.cacheRoot !== join(profile.graph.cacheRoot, createHash("sha256").update(source.worktreeInstanceId).digest("hex"))) return projected(profile.graph, graphDecision("invalid", "Stored Graphify descriptor is outside the configured private cache root."));
        const identity = graphOperationLockIdentity(profile.graph.adapter, profile.graph.reviewedToolSource, source);
        let held; try { held = await store.read(lockPath(profile.graph, source.worktreeRoot, identity, descriptor)); } catch { return projected(profile.graph, graphDecision("blocked", "Graph lock state could not be read safely.")); }
        const decision = await evaluateGraphFreshness({ source, descriptor, adapter: profile.graph.adapter, reviewedToolSource: profile.graph.reviewedToolSource, artifactSha256: profile.graph.artifactSha256, ...(profile.graph.adapter === "codegraph" ? { runtimeArtifactSha256: profile.graph.nodeArtifactSha256 } : {}), lock: held, process });
        return projected(profile.graph, decision);
      } catch { return projected(profile.graph, graphDecision("unavailable", "Graph status source could not be read safely.")); }
    },
    async refresh(input, worktree) {
      let profile: Profile; try { profile = validateProfile(input); } catch { return { decision: graphDecision("invalid", "Graph profile is invalid.") }; }
      if (!profile.graph?.enabled) return { decision: graphDecision("disabled", "Experimental graph acceleration is disabled.") };
      try {
        const reader = sourceReader(); const files = createNodeGraphFiles(gitExecutable); const command = createNodeLocalGraphCommand();
        const source = await snapshotGraphSource(reader, worktree); const descriptorPath = graphDescriptorPath(home, profile.graph.adapter, source.worktreeInstanceId);
        const descriptorPublisher = { write: (descriptor: GraphDescriptor) => writeGraphDescriptor(descriptorPath, descriptor), remove: () => removeGraphDescriptor(descriptorPath) };
        if (profile.graph.adapter === "graphify") return refreshGraphify(source, { ...profile.graph, cacheRoot: join(profile.graph.cacheRoot, createHash("sha256").update(source.worktreeInstanceId).digest("hex")), executablePath: profile.graph.executablePath, sourceReader: reader, command, files, lock: operationLock, descriptorPublisher, now: () => process.now() });
        return refreshCodeGraph(source, { ...profile.graph, codegraphExecutablePath: profile.graph.executablePath, nodeExecutablePath: profile.graph.nodeExecutablePath, sourceReader: reader, command, files, lock: operationLock, descriptorPublisher, now: () => process.now() });
      } catch { return { decision: graphDecision("failed", "Graph refresh service failed safely.") }; }
    },
    async seed(input, worktree, authorization) {
      let profile: Profile; try { profile = validateProfile(input); } catch { return { decision: graphDecision("invalid", "Graph profile is invalid.") }; }
      if (!profile.graph?.enabled) return { decision: graphDecision("disabled", "Experimental graph acceleration is disabled.") };
      try {
        const reader = sourceReader(); const files = createNodeGraphFiles(gitExecutable); const command = createNodeLocalGraphCommand(); const source = await snapshotGraphSource(reader, worktree); const descriptorPath = graphDescriptorPath(home, profile.graph.adapter, source.worktreeInstanceId); const descriptorPublisher = { write: (descriptor: GraphDescriptor) => writeGraphDescriptor(descriptorPath, descriptor), remove: () => removeGraphDescriptor(descriptorPath) };
        if (profile.graph.adapter === "graphify") return seedGraphify(source, authorization, { ...profile.graph, cacheRoot: join(profile.graph.cacheRoot, createHash("sha256").update(source.worktreeInstanceId).digest("hex")), executablePath: profile.graph.executablePath, sourceReader: reader, command, files, lock: operationLock, descriptorPublisher, now: () => process.now() });
        return seedCodeGraph(source, authorization, { ...profile.graph, codegraphExecutablePath: profile.graph.executablePath, nodeExecutablePath: profile.graph.nodeExecutablePath, sourceReader: reader, command, files, lock: operationLock, descriptorPublisher, now: () => process.now() });
      } catch { return { decision: graphDecision("failed", "Graph seed service failed safely.") }; }
    },
  };
}

function disabled(reason: string) { return { enabled: false, decision: graphDecision("disabled", reason) }; }
function projected(graph: Extract<GraphProfile, { enabled: true }>, decision: GraphDecision) { return { enabled: true, adapter: graph.adapter, receipt: graph.reviewedToolSource, decision }; }
function lockPath(graph: Extract<GraphProfile, { enabled: true }>, root: string, identity: string, descriptor?: GraphDescriptor): string { const stateRoot = graph.adapter === "graphify" ? join(descriptor ? dirname(descriptor.cacheRoot) : graph.cacheRoot, ".shipyard-graph-state") : join(resolve(root), "..", ".shipyard-graph-state"); return graphLockPath(stateRoot, identity); }
