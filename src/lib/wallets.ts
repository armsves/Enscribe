"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";

export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
};

export type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString: () => string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{
    publicKey: { toString: () => string };
  }>;
  disconnect?: () => Promise<void>;
};

export function getEthereum(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  };
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
  if (w.solana?.isPhantom) return w.solana;
  return null;
}

export async function connectMetaMask(): Promise<string> {
  const eth = getEthereum();
  if (!eth) {
    throw new Error("MetaMask (or another EVM wallet) is not installed");
  }
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts[0]) throw new Error("No MetaMask account returned");
  return accounts[0];
}

export async function connectPhantom(): Promise<string> {
  const phantom = getPhantom();
  if (!phantom) {
    throw new Error("Phantom wallet is not installed");
  }
  const res = await phantom.connect();
  const key = res.publicKey?.toString() || phantom.publicKey?.toString();
  if (!key) throw new Error("No Phantom account returned");
  return key;
}

function isSolanaWallet(wallet: Wallet): boolean {
  const chains = wallet.chains ?? [];
  return chains.some((c) => c.startsWith("solana:"));
}

function findMetaMaskSolanaWallet(): Wallet | null {
  if (typeof window === "undefined") return null;
  const { get } = getWallets();
  const wallets = get();
  return (
    wallets.find(
      (w) =>
        /metamask/i.test(w.name) &&
        isSolanaWallet(w) &&
        "standard:connect" in w.features,
    ) ?? null
  );
}

/** Connect MetaMask's Solana account (multichain / Wallet Standard). */
export async function connectMetaMaskSolana(): Promise<string> {
  const wallet = findMetaMaskSolanaWallet();
  if (!wallet) {
    throw new Error(
      "MetaMask Solana not available — update MetaMask or use Phantom",
    );
  }
  const connectFeature = wallet.features["standard:connect"] as
    | {
        connect: (input?: {
          silent?: boolean;
        }) => Promise<{ accounts: ReadonlyArray<{ address: string }> }>;
      }
    | undefined;
  if (!connectFeature?.connect) {
    throw new Error("MetaMask Solana connect is not supported in this wallet");
  }
  const { accounts } = await connectFeature.connect();
  const address = accounts[0]?.address;
  if (!address) throw new Error("No MetaMask Solana account returned");
  return address;
}

export function shorten(address: string, size = 4) {
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size + (address.startsWith("0x") ? 2 : 0))}…${address.slice(-size)}`;
}

export function payUrlAbsolute(ens: string, appOrigin?: string): string {
  const origin =
    appOrigin?.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/pay/${encodeURIComponent(ens)}`;
}
