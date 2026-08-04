/** Finalization is intentionally observational until a trusted topology operation is injected. */
export interface GovernedFinalizationOperation { finalize(input: Readonly<{ deliveryId: string }>): Promise<unknown>; }

export async function finalize(operation: GovernedFinalizationOperation | undefined, input: Readonly<{ deliveryId: string }>): Promise<unknown> {
  if (!operation) throw new Error("Finalization is not configured for this bound delivery. A human merge and current exact-SHA evidence are required first.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.deliveryId)) throw new Error("Delivery identifier is invalid.");
  return operation.finalize({ deliveryId: input.deliveryId });
}
