import "server-only";

import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";

export type EnsNetwork = "mainnet" | "sepolia";

const DEFAULT_RPC: Record<EnsNetwork, string> = {
  mainnet: "https://cloudflare-eth.com",
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
};

export function getEnsNetwork(): EnsNetwork {
  const raw = (process.env.ENS_CHAIN ?? "sepolia").trim().toLowerCase();
  if (raw === "mainnet" || raw === "eth" || raw === "1") return "mainnet";
  if (raw === "sepolia" || raw === "11155111") return "sepolia";
  throw new Error(`Unsupported ENS_CHAIN="${raw}" (use sepolia or mainnet)`);
}

export function getEnsChain(): Chain {
  return getEnsNetwork() === "mainnet" ? mainnet : sepolia;
}

export function getEnsRpcUrl(): string {
  const network = getEnsNetwork();
  return process.env.ETH_RPC_URL?.trim() || DEFAULT_RPC[network];
}

export function getEnsPublicClient(): PublicClient {
  return createPublicClient({
    chain: getEnsChain(),
    transport: http(getEnsRpcUrl()),
  });
}

export function getEnsAppUrl(): string {
  return getEnsNetwork() === "mainnet"
    ? "https://app.ens.domains"
    : "https://sepolia.app.ens.domains";
}
