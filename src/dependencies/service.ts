import { verifyDependencies } from "./verification.js";
import type { DependencyObserver } from "./observer.js";
import type { CapabilityHost, CapabilityLane, DependencyStatus } from "./types.js";

export class DependencyStatusService {
  constructor(private readonly observer: DependencyObserver, private readonly manifest: unknown) {}
  async inspect(selected: Readonly<{ host: CapabilityHost; lane: CapabilityLane }>): Promise<DependencyStatus> {
    // Validate descriptors/proxies before ever reading a caller-owned field.
    verifyDependencies(this.manifest, [], selected);
    const host = selected.host;
    if (host !== "codex") return Object.freeze({ schemaVersion: 1 as const, findings: Object.freeze([{ dependency: host === "claude-code" ? "claude-code" as const : "cursor-pstack" as const, state: "incompatible" as const, remediation: "Claude Code and Cursor/Pstack are deferred and unsupported in v1." }]), ready: false, nextSafeAction: "shipyard-help" });
    // Observation output is parsed again by the pure verifier; it remains a detached status, never authority.
    try { return verifyDependencies(this.manifest, await this.observer.inspect(this.manifest), selected); }
    catch { return Object.freeze({ schemaVersion: 1 as const, findings: Object.freeze([{ dependency: "matt-skills" as const, state: "missing" as const, remediation: "Dependency observation failed safely; inspect the canonical maintenance receipt." }]), ready: false, nextSafeAction: "shipyard-setup" }); }
  }
}
