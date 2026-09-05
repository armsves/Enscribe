import "server-only";

import {
  createPublicClient,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { getSwapStatus, listTokens } from "@/lib/intents";
import { PAY_CHAINS } from "@/lib/pay-chains";
import { getEnsRpcUrl } from "@/lib/ens-client";
import type { InvoiceStatus } from "@/lib/invoice-store";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type PaymentCheckResult = {
  status: Extract<InvoiceStatus, "paid" | "pending" | "failed" | "unknown">;
  paymentTxHash: Hex | null;
  paidAmount: string | null;
  source: "intents" | "onchain" | "none";
  intents: unknown;
  onchain: {
    found: boolean;
    txHash: Hex | null;
    value: string | null;
    token: Address | null;
    chain: string | null;
  };
};

function inferIntentsStatus(
  payload: unknown,
): Extract<InvoiceStatus, "paid" | "pending" | "failed" | "unknown"> {
  const text = JSON.stringify(payload).toLowerCase();
  if (
    text.includes("success") ||
    text.includes('"completed"') ||
    text.includes("fulfilled") ||
    text.includes("settled")
  ) {
    return "paid";
  }
  if (text.includes("fail") || text.includes("refund") || text.includes("error")) {
    return "failed";
  }
  if (
    text.includes("pending") ||
    text.includes("waiting") ||
    text.includes("known") ||
    text.includes("processing")
  ) {
    return "pending";
  }
  return "unknown";
}

function extractTxHash(payload: unknown): Hex | null {
  if (!payload || typeof payload !== "object") return null;
  const walk = (value: unknown, depth = 0): Hex | null => {
    if (depth > 6 || value == null) return null;
    if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value as Hex;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = walk(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of [
        "txHash",
        "transactionHash",
        "originTxHash",
        "depositTxHash",
        "hash",
      ]) {
        const hit = walk(obj[key], depth + 1);
        if (hit) return hit;
      }
      for (const v of Object.values(obj)) {
        const hit = walk(v, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(payload);
}

async function findOnchainPayment(input: {
  depositAddress: Address;
  amount?: string | null;
  originChain?: string | null;
  originSymbol?: string | null;
  createdAt?: string | null;
}): Promise<PaymentCheckResult["onchain"]> {
  const chainKey = (input.originChain ?? "").toLowerCase();
  const payChain = PAY_CHAINS[chainKey];
  if (!payChain) {
    return {
      found: false,
      txHash: null,
      value: null,
      token: null,
      chain: null,
    };
  }

  const tokens = await listTokens();
  const symbol = (input.originSymbol ?? "USDC").toUpperCase();
  const match = tokens.find(
    (t) =>
      t.blockchain === chainKey &&
      t.symbol.toUpperCase() === symbol &&
      Boolean(t.contractAddress) &&
      isAddress(t.contractAddress!),
  );
  if (!match?.contractAddress || !isAddress(match.contractAddress)) {
    return {
      found: false,
      txHash: null,
      value: null,
      token: null,
      chain: chainKey,
    };
  }

  const token = match.contractAddress as Address;
  const client = createPublicClient({
    chain: payChain.chain,
    transport: http(
      payChain.chain.rpcUrls.default.http[0] ?? getEnsRpcUrl(),
    ),
  });

  const latest = await client.getBlockNumber();
  // ~7–14 days of L2 history depending on chain; enough for invoice checks.
  const lookback = BigInt(400_000);
  const fromBlock = latest > lookback ? latest - lookback : BigInt(0);

  const logs = await client.getLogs({
    address: token,
    event: transferEvent,
    args: { to: input.depositAddress },
    fromBlock,
    toBlock: "latest",
  });

  if (logs.length === 0) {
    return {
      found: false,
      txHash: null,
      value: null,
      token,
      chain: chainKey,
    };
  }

  const expected =
    input.amount && /^\d+$/.test(input.amount) ? BigInt(input.amount) : null;

  // Prefer exact amount match; otherwise take the latest transfer.
  const ordered = [...logs].reverse();
  const hit =
    (expected != null
      ? ordered.find((log) => (log.args.value as bigint | undefined) === expected)
      : null) ?? ordered[0];

  return {
    found: true,
    txHash: hit.transactionHash,
    value: (hit.args.value as bigint | undefined)?.toString() ?? null,
    token,
    chain: chainKey,
  };
}

/** Check Intents settlement + on-chain ERC-20 transfers into the deposit address. */
export async function checkInvoicePayment(input: {
  depositAddress: string;
  amount?: string | null;
  originChain?: string | null;
  originSymbol?: string | null;
  createdAt?: string | null;
}): Promise<PaymentCheckResult> {
  if (!isAddress(input.depositAddress)) {
    throw new Error("Invalid deposit address");
  }
  const depositAddress = input.depositAddress as Address;

  let intents: unknown = null;
  let intentsStatus: PaymentCheckResult["status"] = "unknown";
  let intentsTx: Hex | null = null;
  try {
    intents = await getSwapStatus(depositAddress);
    intentsStatus = inferIntentsStatus(intents);
    intentsTx = extractTxHash(intents);
  } catch {
    intents = { error: "Intents status unavailable" };
  }

  let onchain: PaymentCheckResult["onchain"] = {
    found: false,
    txHash: null,
    value: null,
    token: null,
    chain: input.originChain ?? null,
  };
  try {
    onchain = await findOnchainPayment({
      depositAddress,
      amount: input.amount,
      originChain: input.originChain,
      originSymbol: input.originSymbol,
      createdAt: input.createdAt,
    });
  } catch {
    // keep empty onchain
  }

  if (intentsStatus === "paid" || onchain.found) {
    return {
      status: "paid",
      paymentTxHash: onchain.txHash ?? intentsTx,
      paidAmount: onchain.value,
      source: onchain.found ? "onchain" : "intents",
      intents,
      onchain,
    };
  }

  if (intentsStatus === "failed") {
    return {
      status: "failed",
      paymentTxHash: intentsTx,
      paidAmount: null,
      source: "intents",
      intents,
      onchain,
    };
  }

  if (intentsStatus === "pending") {
    return {
      status: "pending",
      paymentTxHash: null,
      paidAmount: null,
      source: "intents",
      intents,
      onchain,
    };
  }

  return {
    status: "unknown",
    paymentTxHash: null,
    paidAmount: null,
    source: "none",
    intents,
    onchain,
  };
}
