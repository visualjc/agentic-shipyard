import { hostname } from "node:os";

/** Process observations are injected so stale-lock rules can be tested deterministically. */
export interface ProcessAdapter {
  hostName(): string;
  processId(): number;
  isProcessAlive(processId: number): Promise<boolean>;
  now(): Date;
}

export const nodeProcess: ProcessAdapter = {
  hostName: hostname,
  processId: () => process.pid,
  async isProcessAlive(processId) {
    try {
      process.kill(processId, 0);
      return true;
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  now: () => new Date(),
};
