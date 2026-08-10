/**
 * The message a provider signs to prove they authored a delivery upload.
 *
 * The on-chain `deliveryHash` already pins *what* was delivered, so this signature is not what
 * makes the content trustworthy — it is what stops a third party from filling our database with
 * text nobody committed to. It is a plain personal_sign message rather than typed data because it
 * authorises an off-chain upload, not an on-chain action; keeping the two shapes visibly different
 * means a signature harvested here can never be replayed against the escrow.
 */

export interface DeliveryAuthParams {
  chainId: number;
  contractAddress: string;
  jobId: string;
  deliveryHash: string;
}

export function deliveryAuthMessage(params: DeliveryAuthParams): string {
  return [
    "BOTLatch delivery upload",
    "",
    `Chain: ${params.chainId}`,
    `Escrow: ${params.contractAddress.toLowerCase()}`,
    `Job: ${params.jobId}`,
    `Delivery hash: ${params.deliveryHash.toLowerCase()}`,
    "",
    "Signing this stores the delivery text for verification. It moves no funds.",
  ].join("\n");
}
