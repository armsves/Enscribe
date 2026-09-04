import "server-only";

import { getEnsAppUrl, getEnsNetwork } from "./ens-client";
import { getParentEnsName, isControllerConfigured } from "./ens-subdomain";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function getServerEnv() {
  return {
    intentsApiKey: required("INTENTS_API_KEY"),
    ensNetwork: getEnsNetwork(),
    ethRpcUrl: optional("ETH_RPC_URL", ""),
    destinationAssetSymbol: optional("DESTINATION_ASSET_SYMBOL", "USDC"),
    destinationChain: optional("DESTINATION_CHAIN", "sol"),
    defaultSlippageBps: Number(optional("DEFAULT_SLIPPAGE_BPS", "100")),
    quoteDeadlineMinutes: Number(optional("QUOTE_DEADLINE_MINUTES", "15")),
    intentsConnectApiUrl: optional(
      "INTENTS_CONNECT_API_URL",
      "https://intents-connect-api.aurora.dev",
    ),
    intentsApiBaseUrl: "https://intents-api.aurora.dev",
    parentEns: getParentEnsName(),
  };
}

export function getPublicConfig() {
  const ensNetwork = getEnsNetwork();
  return {
    destinationAssetSymbol: optional("DESTINATION_ASSET_SYMBOL", "USDC"),
    destinationChain: optional("DESTINATION_CHAIN", "sol"),
    defaultSlippageBps: Number(optional("DEFAULT_SLIPPAGE_BPS", "100")),
    intentsConfigured: Boolean(process.env.INTENTS_API_KEY?.trim()),
    ensNetwork,
    ensAppUrl: getEnsAppUrl(),
    ensChainId: ensNetwork === "mainnet" ? 1 : 11155111,
    parentEns: getParentEnsName(),
    controllerConfigured: isControllerConfigured(),
    onChainMint: process.env.ENS_ONCHAIN_MINT?.trim() !== "false",
    swarmConfigured: isUserStoreConfiguredPublic(),
    appUrl: optional("NEXT_PUBLIC_APP_URL", ""),
  };
}

/** Public flag only — never expose BEE_BATCH_ID or secrets. */
function isUserStoreConfiguredPublic(): boolean {
  return Boolean(
    process.env.BEE_URL?.trim() &&
      process.env.BEE_BATCH_ID?.trim() &&
      process.env.SWARM_DATA_SECRET?.trim(),
  );
}
