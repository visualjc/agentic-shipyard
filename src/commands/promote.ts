/** The selected operation owns topology, actor, evidence, lock, and provider revalidation. */
export interface GovernedPromotionOperation { promote(input: Readonly<{ deliveryId: string; action: "initial" | "revision" | "certify" }>): Promise<unknown>; }

export async function promote(operation: GovernedPromotionOperation | undefined, input: Readonly<{ deliveryId: string; action: "initial" | "revision" | "certify" }>): Promise<unknown> {
  if (!operation) throw new Error("Promotion is not configured for this bound delivery. Run shipyard-status and resolve its evidence/topology blocker before retrying.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.deliveryId)) throw new Error("Delivery identifier is invalid.");
  return operation.promote({ deliveryId: input.deliveryId, action: input.action });
}
