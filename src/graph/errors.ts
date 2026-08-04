export class GraphError extends Error {
  constructor(public readonly code: "source-unavailable" | "invalid-descriptor" | "unsafe-path" | "adapter-failed", message: string) {
    super(message);
    this.name = "GraphError";
  }
}
