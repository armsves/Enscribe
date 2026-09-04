import "server-only";

import { getEnsPublicClient } from "./ens-client";
import {
  normalizeEns,
  ENSCRIBE_KEYS,
  type EnsInvoiceRecord,
} from "./ens-records";

/** Read invoice metadata from ENS text records (no Solana — never stored on-chain). */
export async function readInvoiceFromEns(
  ensInput: string,
): Promise<EnsInvoiceRecord> {
  const ens = normalizeEns(ensInput);
  const client = getEnsPublicClient();

  const readText = async (key: string) => {
    try {
      return (await client.getEnsText({ name: ens, key })) ?? null;
    } catch {
      return null;
    }
  };

  let depositAddress = await readText(ENSCRIBE_KEYS.depositAddress);
  if (!depositAddress) {
    try {
      depositAddress = (await client.getEnsAddress({ name: ens })) ?? null;
    } catch {
      depositAddress = null;
    }
  }

  return {
    ens,
    depositAddress,
    amount: await readText(ENSCRIBE_KEYS.amount),
    amountFormatted: await readText(ENSCRIBE_KEYS.amountFormatted),
    originChain: await readText(ENSCRIBE_KEYS.originChain),
    originSymbol: await readText(ENSCRIBE_KEYS.originSymbol),
    refundTo: await readText(ENSCRIBE_KEYS.refundTo),
    createdAt: await readText(ENSCRIBE_KEYS.createdAt),
    clientName: await readText(ENSCRIBE_KEYS.clientName),
    description: await readText(ENSCRIBE_KEYS.description),
    invoiceNumber: await readText(ENSCRIBE_KEYS.invoiceNumber),
    freelancerName: await readText(ENSCRIBE_KEYS.freelancerName),
  };
}

export async function assertInvoiceExists(
  ensInput: string,
): Promise<EnsInvoiceRecord> {
  const record = await readInvoiceFromEns(ensInput);
  if (!record.depositAddress) {
    throw new Error(`No invoice found for ${record.ens}`);
  }
  return record;
}

/** @deprecated */
export const readPaymentFromEns = readInvoiceFromEns;
export const assertPaymentExists = assertInvoiceExists;
