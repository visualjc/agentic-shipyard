import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ExclusiveDirectoryResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

/** Narrow filesystem boundary. Production code and tests can supply different implementations. */
export interface FilesystemAdapter {
  readText(path: string): Promise<string | undefined>;
  writeTextAtomic(path: string, contents: string): Promise<void>;
  /** Returns false when a file already exists; it must never overwrite it. */
  createTextExclusive(path: string, contents: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** Removes only an empty directory. False means another owner replaced or populated it. */
  removeEmptyDirectory(path: string): Promise<boolean>;
  /**
   * Runs a lifecycle transition while holding an atomic mkdir-based guard.
   * Every participant that can create, recover, or release the guarded state
   * must use this boundary, eliminating check-then-remove replacement races.
   */
  withExclusiveDirectory<T>(path: string, operation: () => Promise<T>): Promise<ExclusiveDirectoryResult<T>>;
}

export const nodeFilesystem: FilesystemAdapter = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async writeTextAtomic(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  },
  async createTextExclusive(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  },
  async remove(path) {
    await rm(path, { force: true });
  },
  async removeEmptyDirectory(path) {
    try {
      await rmdir(path);
      return true;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTEMPTY") return false;
      throw error;
    }
  },
  async withExclusiveDirectory(path, operation) {
    await mkdir(dirname(path), { recursive: true });
    try {
      await mkdir(path);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { acquired: false };
      throw error;
    }
    try {
      return { acquired: true, value: await operation() };
    } finally {
      // The guard is implementation state and always empty. rmdir is deliberate:
      // it cannot recursively erase an unexpected path if invariants are broken.
      await rmdir(path);
    }
  },
};
