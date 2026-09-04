/** Text record keys written on invoice subdomains (public metadata only). */
export const ENSCRIBE_KEYS = {
  depositAddress: "enscribe.depositAddress",
  amount: "enscribe.amount",
  amountFormatted: "enscribe.amountFormatted",
  originChain: "enscribe.originChain",
  originSymbol: "enscribe.originSymbol",
  refundTo: "enscribe.refundTo",
  createdAt: "enscribe.createdAt",
  clientName: "enscribe.clientName",
  description: "enscribe.description",
  invoiceNumber: "enscribe.invoiceNumber",
  freelancerName: "enscribe.freelancerName",
} as const;

export type EnsInvoiceRecord = {
  ens: string;
  depositAddress: string | null;
  amount: string | null;
  amountFormatted: string | null;
  originChain: string | null;
  originSymbol: string | null;
  refundTo: string | null;
  createdAt: string | null;
  clientName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  freelancerName: string | null;
};

export function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
}

export function normalizeEns(ens: string): string {
  return ens.trim().toLowerCase();
}

export function invoiceLabelFromNonce(nonce: string): string {
  const slug = nonce.replace(/-/g, "").slice(0, 10);
  return `inv-${slug}`;
}

/** @deprecated use invoiceLabelFromNonce */
export const paymentLabelFromNonce = invoiceLabelFromNonce;
