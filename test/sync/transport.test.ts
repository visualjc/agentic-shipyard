import assert from "node:assert/strict";
import test from "node:test";
import { DestinationSyncTransport, requireSourceFreePublication } from "../../src/sync/transport.js";
import type { GitTransportCommand } from "../../src/adapters/git-transport.js";

const topology = { kind: "staged-pair" as const, development: { owner: "acme", name: "dev", remote: { name: "origin", url: "https://github.com/acme/dev.git" }, defaultBranch: "main" }, destination: { owner: "acme", name: "dest", remote: { name: "upstream", url: "https://github.com/acme/dest.git" }, defaultBranch: "main" } };
function runner(commands: GitTransportCommand[], failCredentialed = false) { return { run: async (command: GitTransportCommand) => { commands.push(command); const credentialed = Object.values(command.env).some(value => value.includes("bearer")); if (credentialed && failCredentialed) return { exitCode: 1, stdout: "", stderr: `denied github_pat_transport_secret` }; const args = command.argv.join(" "); if (args.includes("rev-parse --show-object-format")) return { exitCode: 0, stdout: "sha1\n", stderr: "" }; if (args.includes("ls-remote")) return { exitCode: 0, stdout: `${"c".repeat(40)}\trefs/tags/v1\n`, stderr: "" }; if (args.includes("rev-parse refs/shipyard/staged-source")) return { exitCode: 0, stdout: `${"c".repeat(40)}\n`, stderr: "" }; if (args.includes("rev-parse refs/shipyard/staged-destination")) return { exitCode: 0, stdout: `${"b".repeat(40)}\n`, stderr: "" }; return { exitCode: 0, stdout: "", stderr: "" }; } }; }
function subject(commands: GitTransportCommand[], verifiedActorLogin = "actor", fail = false) { return new DestinationSyncTransport({ resolve: async () => ({ profileName: "p", commonDirectory: "/r/.git", profileFingerprint: "a".repeat(64), actorLogin: "actor", topology }) }, { commonDirectory: async () => "/r/.git", remoteUrl: async () => topology.destination.remote.url }, { resolve: async () => ({ token: "github_pat_transport_secret", verifiedActorLogin }) }, runner(commands, fail)); }

test("credentialed destination Git runs only in a temporary config-isolated bare repository", async () => {
  const commands: GitTransportCommand[] = []; const staged = await subject(commands).stage("/product", "main", "main", "v1");
  try { const credentialed = commands.filter(command => Object.values(command.env).some(value => value.includes("bearer"))); assert.ok(credentialed.length >= 2); assert.ok(credentialed.every(command => command.argv[1] !== "/product" && command.argv[0] === "-C")); assert.ok(credentialed.every(command => command.argv.join(" ").includes("upstream"))); assert.ok(commands.some(command => command.env.GIT_CONFIG_COUNT === undefined && command.argv.join(" ").includes("fetch --no-tags /product"))); assert.equal(commands.some(command => command.argv.join(" ").includes("github_pat_transport_secret")), false); } finally { await staged.release(); }
});

test("actor mismatch blocks before a token-bearing child", async () => { const commands: GitTransportCommand[] = []; await assert.rejects(subject(commands, "other").stage("/product", "main", "main"), /verified/i); assert.equal(commands.some(command => Object.values(command.env).some(value => value.includes("bearer"))), false); });

test("transport redacts failures and publication boundary rejects refspec and payload source refs", async () => {
  const commands: GitTransportCommand[] = []; await assert.rejects(subject(commands, "actor", true).stage("/product", "main", "main"), error => error instanceof Error && !error.message.includes("github_pat_transport_secret") && error.message.includes("[REDACTED]"));
  assert.throws(() => requireSourceFreePublication({ refspecs: ["refs/heads/main:refs/shipyard/source/x"] })); assert.throws(() => requireSourceFreePublication({ refspecs: ["refs/heads/main"], payload: { ref: "refs/shipyard/source/x" } })); assert.doesNotThrow(() => requireSourceFreePublication({ refspecs: ["refs/heads/main:refs/heads/main"], payload: { ref: "refs/heads/main" } }));
});
