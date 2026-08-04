import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { nodeFilesystem } from "../adapters/filesystem.js";
import { nodeDependencyFilesystem } from "../adapters/dependency-filesystem.js";
import { NodeDependencyRuntime } from "../adapters/dependency-runtime.js";
import { nodeGit } from "../adapters/git.js";
import { nodeProcess } from "../adapters/process.js";
import { BindingService } from "../binding/service.js";
import { JsonBindingStore } from "../binding/store.js";
import { MutationLockService } from "../locking/mutation-lock.js";
import { GlobalProfileStore } from "./profile-store.js";
import { createGraphLaneService, type GraphLaneController } from "../graph/service.js";
import type { OrchestrationOperation } from "../commands/orchestrate.js";
import type { GovernedReviewOperation } from "../commands/review.js";
import type { GovernedPromotionOperation } from "../commands/promote.js";
import type { GovernedFinalizationOperation } from "../commands/finalize.js";
import { LocalDependencyObserver } from "../dependencies/observer.js";
import { DependencyStatusService } from "../dependencies/service.js";
import type { CapabilityHost, CapabilityLane, DependencyStatus } from "../dependencies/types.js";
import { GitLedgerStore } from "../adapters/ledger-git.js";
import { ShipyardOrchestrator, type StartPlanningRequest, type ResumePlanningRequest, type ReviewTargetObserver } from "../orchestration/service.js";
import type { PlanningAuthority } from "../orchestration/authority.js";
import { PlanningLedger } from "../orchestration/ledger.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import { sameTopology } from "../profile/policy.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "../adapters/git-transport.js";
import { loadPlanningHost } from "../adapters/codex-classifier.js";

const execFileAsync = promisify(execFile);

export type CommandRuntime = Readonly<{
  bindings: BindingService;
  bindingPath: string;
  git: typeof nodeGit;
  locks: MutationLockService;
  profiles: GlobalProfileStore;
  graphs: GraphLaneController;
  setupLockPath(commonDirectory: string): string;
  bindingMutationLockPath(): string;
  dependencyStatus: Readonly<{ inspect(selected: Readonly<{ host: CapabilityHost; lane: CapabilityLane }>): Promise<DependencyStatus> }>;
  /** These are supplied only by a reviewed, bound composition root.  The
   * default desktop/CLI runtime intentionally has no ambient provider access. */
  operations: Readonly<{
    orchestrate?: OrchestrationOperation;
    review?: GovernedReviewOperation;
    promote?: GovernedPromotionOperation;
    finalize?: GovernedFinalizationOperation;
  }>;
}>;

/** SHIPYARD_HOME is deliberately local machine state, never repository configuration. */
export function createRuntime(home = process.env.SHIPYARD_HOME ?? join(process.env.HOME ?? ".", ".shipyard")): CommandRuntime {
  const bindingPath = join(home, "bindings.json");
  return {
    bindingPath,
    bindings: new BindingService(new JsonBindingStore(nodeFilesystem, bindingPath), nodeGit),
    git: nodeGit,
    locks: new MutationLockService(nodeFilesystem, nodeProcess),
    profiles: new GlobalProfileStore(nodeFilesystem, home),
    graphs: createGraphLaneService(home),
    setupLockPath: (commonDirectory) => join(home, "locks", `${createHash("sha256").update(commonDirectory).digest("hex")}.lock`),
    bindingMutationLockPath: () => join(home, "locks", "binding-store.lock"),
    dependencyStatus: createDependencyStatus(home, process.env.HOME ?? "."),
    operations: Object.freeze({
      // Planning is the sole public private-ledger composition available from a
      // bound v1 profile. Release operations still require their dedicated,
      // credential-bearing reviewed composition roots.
      orchestrate: createBoundOrchestrationOperation({
        bindings: new BindingService(new JsonBindingStore(nodeFilesystem, bindingPath), nodeGit),
        profiles: new GlobalProfileStore(nodeFilesystem, home),
        dependencyStatus: createDependencyStatus(home, process.env.HOME ?? "."),
        planningHostPath: join(home, "planning-host.json"),
        locks: new MutationLockService(nodeFilesystem, nodeProcess),
        planningLockPath: (commonDirectory: string) => join(home, "locks", `${createHash("sha256").update(commonDirectory).digest("hex")}.lock`),
      }),
    }),
  };
}

/**
 * Concrete local composition for `shipyard <request>`.  It deliberately
 * performs no provider, GitHub, or product-ref write: a request with no
 * independently recorded classification evidence is conservatively recorded
 * as requiring Wayfinder.  The only write is an append-only private-ledger
 * checkpoint after the bound profile, product SHA, dependency receipt, and
 * existing ledger head have all been re-read.
 *
 * Exported for hermetic integration tests; callers may substitute only the
 * read-only dependency observer, never an actor or provider.
 */
export function createBoundOrchestrationOperation(dependencies: Readonly<{
  bindings: BindingService;
  profiles: GlobalProfileStore;
  dependencyStatus: CommandRuntime["dependencyStatus"];
  planningHostPath?: string;
  reviews?: ReviewTargetObserver;
  locks: MutationLockService;
  planningLockPath: (commonDirectory: string) => string;
}>): OrchestrationOperation {
  const authority: PlanningAuthority = {
    async resolve(repositoryPath: string, selectedLane?: CapabilityLane) {
      const binding = await dependencies.bindings.resolve(repositoryPath);
      const profile = await dependencies.profiles.read(binding.profileName);
      if (profile.name !== binding.profileName || profile.actor.login !== "visualjc" || !sameTopology(profile.topology, binding.topology) || profileFingerprint(profile) !== binding.profileFingerprint) {
        throw new Error("The bound profile authority is stale; rerun shipyard-setup --rebind after review.");
      }
      const ledger = new GitLedgerStore(repositoryPath);
      const [objectFormat, productSha, initialSnapshot, dependencyReceipt] = await Promise.all([
        ledger.objectFormat(),
        currentProductSha(repositoryPath),
        ledger.snapshot([]),
        dependencies.dependencyStatus.inspect({ host: "codex", lane: selectedLane ?? "small" }),
      ]);
      // First planning use is an explicit authority-owned bootstrap.  It writes
      // only the orphan private ledger ref, never a product ref; CAS makes a
      // concurrent bootstrap safely adopt the winner.
      if (!dependencyReceipt.ready) return Object.freeze({ repositoryPath, binding, profile, productSha, ledgerSha: initialSnapshot.head, objectFormat, dependencies: dependencyReceipt });
      let snapshot = initialSnapshot;
      if (!snapshot.head && selectedLane !== undefined) {
        const bootstrapPath = "planning/bootstrap.json", bootstrapContents = "{\"kind\":\"planning-bootstrap\",\"schemaVersion\":1}";
        try {
          await ledger.transact({ expectedHead: undefined, writes: [{ path: bootstrapPath, contents: bootstrapContents }], message: "initialize Shipyard planning ledger" });
        } catch { /* another bound invocation may have won the null-head CAS */ }
        snapshot = await ledger.snapshot([bootstrapPath]);
        if (!snapshot.head || snapshot.records[bootstrapPath] !== bootstrapContents) throw new Error("The private Shipyard ledger bootstrap could not be proven; inspect it before retrying.");
      }
      if (!snapshot.head && selectedLane !== undefined) throw new Error("The private Shipyard ledger bootstrap could not be confirmed; rerun shipyard-status before retrying planning.");
      if (!snapshot.head) return Object.freeze({ repositoryPath, binding, profile, productSha, ledgerSha: undefined, objectFormat, dependencies: dependencyReceipt });
      if (!fullSha(productSha, objectFormat) || !fullSha(snapshot.head, objectFormat)) throw new Error("The bound repository did not return exact Git object identities.");
      return Object.freeze({ repositoryPath, binding, profile, productSha, ledgerSha: snapshot.head, objectFormat, dependencies: dependencyReceipt });
    },
  };
  const fallbackClassifier = Object.freeze({
    // This deliberately recognizes only explicit, bounded request evidence;
    // every other request remains a Wayfinder clarification rather than an
    // inferred delivery decision. It has no provider, filesystem, or ledger
    // capability and cannot execute the request text.
    async classify(requestText: string) {
      const request = requestText.toLowerCase();
      if (/\bbug\b/.test(request) && /\b(repro|reproduction|regression)\b/.test(request)) return Object.freeze({ kind: "bug", scope: "settled", requirements: "compatible", regression: "proven", reasons: Object.freeze([{ code: "explicit-bug-evidence", evidence: "Request names a bug and reproduction/regression evidence." }]) });
      if (/\b(small|settled)\b/.test(request) && /\b(requirements?|acceptance|scope)\b/.test(request)) return Object.freeze({ kind: "feature", scope: "settled", requirements: "compatible", reasons: Object.freeze([{ code: "explicit-settled-scope", evidence: "Request explicitly supplies settled scope and requirements evidence." }]) });
      if (/\b(large|foggy)\b/.test(request) && /\b(requirements?|scope|integration)\b/.test(request)) return Object.freeze({ kind: "feature", scope: "foggy", requirements: "compatible", reasons: Object.freeze([{ code: "explicit-large-scope", evidence: "Request explicitly identifies a foggy or large integration boundary." }]) });
      return Object.freeze({ kind: "feature", scope: "unknown", requirements: "unknown", reasons: Object.freeze([{ code: "request-needs-wayfinding", evidence: "The request lacks the bounded planning evidence required for a delivery lane." }]) });
    },
  });
  // The fallback exists only for hermetic injected composition tests. The
  // desktop runtime always supplies the reviewed machine-local host path.
  const startService = async (repositoryPath: string) => new ShipyardOrchestrator(authority, dependencies.planningHostPath ? await loadPlanningHost(dependencies.planningHostPath) : fallbackClassifier, new PlanningLedger(new GitLedgerStore(repositoryPath)), undefined, dependencies.reviews);
  const resumeService = (repositoryPath: string) => new ShipyardOrchestrator(authority, fallbackClassifier, new PlanningLedger(new GitLedgerStore(repositoryPath)));
  return Object.freeze({
    start: async (input: StartPlanningRequest) => {
      // Resolve the canonical common directory before acquiring the one
      // repository-scoped mutation lock; service re-resolves authority after
      // acquisition before its first bootstrap or ledger write.
      const binding = await dependencies.bindings.resolve(input.repositoryPath);
      const lock = await dependencies.locks.acquire(dependencies.planningLockPath(binding.commonDirectory), binding.commonDirectory, "planning");
      try { return await (await startService(input.repositoryPath)).start(input); }
      finally { await lock.release(); }
    },
    resume: async (input: ResumePlanningRequest) => resumeService(input.repositoryPath).resume(input),
  });
}

async function currentProductSha(repositoryPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(canonicalGitExecutable(DEFAULT_NODE_GIT_EXECUTABLE), ["-C", repositoryPath, "rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8", env: sanitizedGitEnvironment(), timeout: 30_000, maxBuffer: 1_048_576 });
    return stdout.trim();
  } catch { throw new Error("The bound repository has no exact product HEAD to plan from."); }
}
function fullSha(value: string, format: "sha1" | "sha256"): boolean { return format === "sha1" ? /^[a-f0-9]{40}$/.test(value) : /^[a-f0-9]{64}$/.test(value); }

/** Read-only capability composition.  It never installs, relinks, invokes a
 * shell, or receives an actor/provider credential. */
/**
 * Construct the read-only installation observer.  The separate parameters are
 * intentional: `SHIPYARD_HOME` contains only Shipyard's local profile/state,
 * while discovery is always rooted at the real user's `HOME`.  Exporting this
 * narrow factory also permits hermetic tests to prove that separation without
 * mutating a developer's actual skill installation.
 */
export function createDependencyStatus(shipyardHome = process.env.SHIPYARD_HOME ?? join(process.env.HOME ?? ".", ".shipyard"), userHome = process.env.HOME ?? "."): CommandRuntime["dependencyStatus"] {
  const runtime = new NodeDependencyRuntime(async (file, args, options) => {
    try {
      const result = await execFileAsync(file, [...args], { encoding: "utf8", timeout: options.timeoutMs, maxBuffer: options.maximumOutputBytes, shell: false });
      return { code: 0, stdout: result.stdout };
    } catch (error: unknown) {
      const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string };
      return { code: typeof failure.code === "number" ? failure.code : 1, stdout: typeof failure.stdout === "string" ? failure.stdout.slice(0, options.maximumOutputBytes) : "" };
    }
  });
  const observer = new LocalDependencyObserver(nodeDependencyFilesystem, runtime, {
    agentsHome: join(userHome, ".agents"),
    claudeSkillsHome: join(userHome, ".claude", "skills"),
    cursorSkillsHome: join(userHome, ".cursor", "skills"),
  });
  let manifest: Promise<unknown> | undefined;
  const load = () => manifest ??= readFile(join(dirname(fileURLToPath(import.meta.url)), "../../../config/capabilities.v1.json"), "utf8").then((body) => JSON.parse(body));
  return Object.freeze({ async inspect(selected) {
    const base = await new DependencyStatusService(observer, await load()).inspect(selected);
    const hostPath = join(shipyardHome, "planning-host.json");
    let hostFinding: DependencyStatus["findings"][number];
    try {
      // Parse only; classifier performs the exact fixed-version probe before
      // dispatch. Setup/status remain read-only and never spawn a planner.
      await readFile(hostPath, "utf8");
      await (await loadPlanningHost(hostPath)).verify();
      hostFinding = { dependency: "planning-host", state: "ready", remediation: "Reviewed machine-local Codex planning host is configured." };
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      hostFinding = code === "ENOENT"
        ? { dependency: "planning-host", state: "missing", remediation: "Create and review $SHIPYARD_HOME/planning-host.json with fixed Codex v1 paths." }
        : { dependency: "planning-host", state: "incompatible", remediation: "Repair the reviewed machine-local planning-host.json; Shipyard will not infer Codex paths." };
    }
    const findings = Object.freeze([...base.findings, hostFinding]);
    return Object.freeze({ schemaVersion: 1 as const, findings, ready: base.ready && hostFinding.state === "ready", nextSafeAction: base.ready && hostFinding.state === "ready" ? base.nextSafeAction : "shipyard-setup" });
  } });
}
