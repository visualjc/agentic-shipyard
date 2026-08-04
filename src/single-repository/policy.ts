import { createHash } from "node:crypto";
import type { Profile } from "../contracts/types.js";
import { canonicalJson } from "../evidence/schema.js";
import { classifyProfilePath, PathPolicyError } from "../policy/path-classifier.js";
import { isProhibitedDestinationPath } from "../promotion/payload.js";
import type { SingleRepositoryProductObservation } from "./types.js";
import { SingleRepositoryError } from "./errors.js";

/** Full-tree certification receipt. With no projection lane, every certified path must be publishable product cargo. */
export function singleRepositoryPolicyDigest(profile: Profile, observation: SingleRepositoryProductObservation): string {
  try {
    const seen = new Set<string>();
    const classify = (path: string) => {
      if (!safePath(path)) throw new Error();
      if (isProhibitedDestinationPath(path)) throw new SingleRepositoryError("path-policy", `Prohibited metadata path ${path} cannot be certified.`);
      const owner = classifyProfilePath(profile, path);
      if (owner !== "product") throw new SingleRepositoryError("path-policy", `${owner} path ${path} is non-product cargo and cannot be certified without a projection lane.`);
      return owner;
    };
    const rows = observation.entries.map((entry) => {
      if (!safePath(entry.path) || seen.has(entry.path) || !new Set(["100644", "100755", "120000", "160000"]).has(entry.mode) || !fullSha(entry.objectId)) throw new Error();
      seen.add(entry.path);
      const owner = classify(entry.path);
      return { path: entry.path, mode: entry.mode, objectId: entry.objectId, owner };
    }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    if (!fullSha(observation.baseSha) || !Array.isArray(observation.touchedPaths)) throw new Error();
    const touched = observation.touchedPaths.map((path) => ({ path, owner: classify(path) }));
    if (touched.some((row, index) => index > 0 && touched[index - 1]!.path >= row.path) || new Set(touched.map((row) => row.path)).size !== touched.length) throw new Error();
    return createHash("sha256").update(canonicalJson({ baseSha: observation.baseSha, tree: rows, touched })).digest("hex");
  } catch (error) {
    if (error instanceof SingleRepositoryError) throw error;
    if (error instanceof PathPolicyError) throw new SingleRepositoryError("path-policy", error.message);
    throw new SingleRepositoryError("path-policy", "Single-repository tree or path ownership is invalid.");
  }
}

function safePath(path: string): boolean { return path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && !path.split("/").some((part) => part === "" || part === "." || part === ".."); }
function fullSha(value: string): boolean { return /^[a-f0-9]{40}$/.test(value) || /^[a-f0-9]{64}$/.test(value); }
