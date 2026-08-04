import type { CapabilityHost } from "../dependencies/types.js";

export interface DependencyRuntime {
  version(host: CapabilityHost): Promise<string | undefined>;
}

/** Fixed executable mapping, fixed --version argument, timeout, and bounded output. */
export class NodeDependencyRuntime implements DependencyRuntime {
  constructor(private readonly execute: (file: string, args: readonly string[], options: Readonly<{ timeoutMs: number; maximumOutputBytes: number }>) => Promise<Readonly<{ code: number; stdout: string }>>, private readonly executables: Readonly<Record<CapabilityHost, string>> = { codex: "codex", "claude-code": "claude", "cursor-pstack": "pstack" }) {}
  async version(host: CapabilityHost): Promise<string | undefined> {
    try {
      const result = await this.execute(this.executables[host], ["--version"], { timeoutMs: 3_000, maximumOutputBytes: 4_096 });
      if (result.code !== 0 || result.stdout.length > 4_096) return undefined;
      const match = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/.exec(result.stdout);
      return match?.[1];
    } catch { return undefined; }
  }
}
