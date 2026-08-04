import type { StatusContributor } from "../status/projection.js";

export type DeliveryStatusPins = Readonly<{ productSha?: string; ledgerSha?: string; workspacePath?: string; workspaceBranch?: string }>;

/** A pure status contribution: it carries pins only and never reads delivery records. */
export function deliveryStatusContributor(pins: DeliveryStatusPins): StatusContributor {
  return () => ({ ...(pins.productSha === undefined ? {} : { productSha: pins.productSha }), ...(pins.ledgerSha === undefined ? {} : { ledgerSha: pins.ledgerSha }), ...(pins.workspacePath === undefined ? {} : { workspacePath: pins.workspacePath }), ...(pins.workspaceBranch === undefined ? {} : { workspaceBranch: pins.workspaceBranch }) });
}
