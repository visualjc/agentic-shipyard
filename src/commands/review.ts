/** A composition-root-only wrapper around Issue #6's trusted exact-SHA review operation. */
export interface GovernedReviewOperation { review(input: Readonly<{ deliveryId: string }>): Promise<unknown>; }

export async function review(operation: GovernedReviewOperation | undefined, input: Readonly<{ deliveryId: string }>): Promise<unknown> {
  if (!operation) throw new Error("Independent review is not configured for this bound delivery. Run shipyard-status, then use the reviewed delivery composition root.");
  return operation.review({ deliveryId: id(input.deliveryId) });
}
function id(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Delivery identifier is invalid."); return value; }
