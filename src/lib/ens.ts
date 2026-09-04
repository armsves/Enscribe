import "server-only";

import { type Address } from "viem";
import { normalize } from "viem/ens";
import { getEnsPublicClient } from "./ens-client";

export type EnsProfile = {
  name: string | null;
  address: Address | null;
  avatar: string | null;
};

/** Resolve an ENS name to an EVM address + optional avatar (Sepolia or mainnet). */
export async function resolveEnsName(name: string): Promise<EnsProfile> {
  const client = getEnsPublicClient();
  let normalized: string;
  try {
    normalized = normalize(name.trim());
  } catch {
    return { name: null, address: null, avatar: null };
  }

  if (!normalized.includes(".")) {
    return { name: null, address: null, avatar: null };
  }

  const address = await client.getEnsAddress({ name: normalized });
  if (!address) {
    return { name: normalized, address: null, avatar: null };
  }

  let avatar: string | null = null;
  try {
    avatar = (await client.getEnsAvatar({ name: normalized })) ?? null;
  } catch {
    avatar = null;
  }

  return { name: normalized, address, avatar };
}

/** Reverse-resolve an address to a primary ENS name when available. */
export async function lookupEnsName(address: Address): Promise<string | null> {
  const client = getEnsPublicClient();
  try {
    return (await client.getEnsName({ address })) ?? null;
  } catch {
    return null;
  }
}
