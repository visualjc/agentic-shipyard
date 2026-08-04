export interface GraphExecutableObservation { executable: string; version: string; sourceReceipt: string; artifactSha256: string; }
export interface GraphArtifactExpectation { sourceReceipt: string; artifactSha256: string; }
export interface GraphArtifactObserver { observe(executable: string, expectation: GraphArtifactExpectation): Promise<unknown>; }

function plain(value: unknown): Record<string, unknown> | undefined { try { if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined; const d = Object.getOwnPropertyDescriptors(value); if (Object.values(d).some(field => !("value" in field))) return undefined; return Object.fromEntries(Object.entries(d).map(([key, field]) => [key, field.value])); } catch { return undefined; } }

export function snapshotGraphExecutableObservation(value: unknown): Readonly<GraphExecutableObservation> | undefined {
  const v = plain(value);
  if (!v || Object.keys(v).length !== 4 || typeof v.executable !== "string" || typeof v.version !== "string" || typeof v.sourceReceipt !== "string" || typeof v.artifactSha256 !== "string" || !/^[0-9a-f]{64}$/.test(v.artifactSha256) || Buffer.byteLength(v.executable) > 4096 || Buffer.byteLength(v.version) > 256 || Buffer.byteLength(v.sourceReceipt) > 512) return undefined;
  return Object.freeze({ executable: v.executable, version: v.version, sourceReceipt: v.sourceReceipt, artifactSha256: v.artifactSha256 });
}

export async function observeGraphArtifact(command: GraphArtifactObserver, executablePath: string, expectedReceipt: string, expectedArtifactSha256: string): Promise<Readonly<GraphExecutableObservation> | undefined> {
  try { const observation = snapshotGraphExecutableObservation(await command.observe(executablePath, { sourceReceipt: expectedReceipt, artifactSha256: expectedArtifactSha256 })); return observation?.executable === executablePath && observation.sourceReceipt === expectedReceipt && observation.artifactSha256 === expectedArtifactSha256 && observation.version.length > 0 ? observation : undefined; }
  catch { return undefined; }
}
