import "server-only";

import { getServerEnv } from "./env";

export type IntentsToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string | null;
};

export type QuoteRequestBody = {
  dry: boolean;
  confidentiality: "public" | "basic" | "advanced";
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";
  amount: string;
  originAsset: string;
  destinationAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
  slippageTolerance: number;
  deadline: string;
};

export type QuoteResponse = {
  timestamp: string;
  signature: string;
  correlationId?: string | null;
  quoteRequest: Record<string, unknown>;
  quote: {
    timeEstimate: number;
    deadline?: string;
    timeWhenInactive?: string;
    depositAddress?: string;
    depositMemo?: string;
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    minAmountIn: string;
    maxAmountIn?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    refundFee?: string | null;
    withdrawFee?: string | null;
  };
};

const EVM_CHAINS = new Set([
  "eth",
  "base",
  "arb",
  "op",
  "pol",
  "bsc",
  "avax",
  "gnosis",
  "bera",
  "scroll",
  "xlayer",
  "monad",
  "adi",
  "plasma",
]);

async function intentsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { intentsApiBaseUrl } = getServerEnv();
  const res = await fetch(`${intentsApiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : `Intents API error (${res.status})`;
    throw new Error(message);
  }

  return data as T;
}

export async function listTokens(): Promise<IntentsToken[]> {
  const { intentsApiKey } = getServerEnv();
  const data = await intentsFetch<IntentsToken[] | { tokens: IntentsToken[] }>(
    `/api/tokens/${intentsApiKey}`,
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tokens)) return data.tokens;
  throw new Error("Unexpected tokens response shape from Intents API");
}

export function isEvmToken(token: IntentsToken): boolean {
  return EVM_CHAINS.has(token.blockchain);
}

export function isSolanaToken(token: IntentsToken): boolean {
  return token.blockchain === "sol";
}

export async function findDestinationAsset(
  symbol = getServerEnv().destinationAssetSymbol,
): Promise<IntentsToken> {
  const tokens = await listTokens();
  const match = tokens.find(
    (t) => isSolanaToken(t) && t.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (!match) {
    throw new Error(`No Solana destination token found for symbol ${symbol}`);
  }
  return match;
}

export async function requestConfidentialQuote(input: {
  amount: string;
  originAsset: string;
  /** Solana settlement address from a verified payment request — never from the client. */
  solanaRecipient: string;
  destinationAsset?: string;
  refundTo: string;
  dry?: boolean;
  slippageTolerance?: number;
}): Promise<QuoteResponse> {
  const env = getServerEnv();
  const destination =
    input.destinationAsset ?? (await findDestinationAsset()).assetId;

  const deadline = new Date(
    Date.now() + env.quoteDeadlineMinutes * 60_000,
  ).toISOString();

  const body: QuoteRequestBody = {
    dry: input.dry ?? false,
    confidentiality: "advanced",
    swapType: "EXACT_INPUT",
    amount: input.amount,
    originAsset: input.originAsset,
    destinationAsset: destination,
    depositType: "ORIGIN_CHAIN",
    recipient: input.solanaRecipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    slippageTolerance: input.slippageTolerance ?? env.defaultSlippageBps,
    deadline,
  };

  return intentsFetch<QuoteResponse>(`/api/quote/${env.intentsApiKey}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSwapStatus(depositAddress: string) {
  const { intentsApiKey } = getServerEnv();
  const qs = new URLSearchParams({ depositAddress });
  return intentsFetch<unknown>(
    `/api/status/${intentsApiKey}?${qs.toString()}`,
  );
}

export async function createPersistentDepositAddress(input: {
  sender: string;
  solanaRecipient: string;
  depositChain?: string;
}) {
  const env = getServerEnv();
  return intentsFetch<{
    depositAddress: string;
    alreadyExists: boolean;
    memo?: string;
    correlationId?: string;
  }>(`/api/persistent-deposit-address/${env.intentsApiKey}`, {
    method: "POST",
    body: JSON.stringify({
      recipient: input.solanaRecipient,
      sender: input.sender,
      depositChain: input.depositChain ?? "evm",
      destinationChain: env.destinationChain,
      destinationAsset: env.destinationAssetSymbol,
    }),
  });
}

/** Strip any accidental leakage of the Solana recipient from API payloads. */
export function redactRecipient<T extends Record<string, unknown>>(
  payload: T,
  recipient: string,
): T {
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value === recipient ? "[redacted]" : value;
    }
    if (Array.isArray(value)) {
      return value.map(scrub);
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k.toLowerCase().includes("recipient") && typeof v === "string") {
          out[k] = "[redacted]";
        } else {
          out[k] = scrub(v);
        }
      }
      return out;
    }
    return value;
  };

  return scrub(payload) as T;
}
