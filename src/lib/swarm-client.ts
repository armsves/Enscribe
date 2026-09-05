"use client";

import { getAddress, type Hex } from "viem";
import {
  loadInvoices,
  loadProfile,
  saveInvoices,
  saveProfile,
  type FreelancerProfile,
  type LocalInvoice,
} from "@/lib/invoice-store";
import { connectMetaMask, getEthereum } from "@/lib/wallets";

const AUTH_PREFIX = "Enscribe user store";

export function buildUserAuthMessage(address: string, timestamp: number): string {
  return `${AUTH_PREFIX}\nAddress: ${getAddress(address)}\nTimestamp: ${timestamp}`;
}

export async function signUserAuth(address?: string): Promise<{
  address: string;
  timestamp: number;
  signature: Hex;
}> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask is required to sync with Swarm");

  const wallet = address?.trim() || (await connectMetaMask());
  const normalized = getAddress(wallet);
  const timestamp = Date.now();
  const message = buildUserAuthMessage(normalized, timestamp);
  const signature = (await eth.request({
    method: "personal_sign",
    params: [message, normalized],
  })) as Hex;

  return { address: normalized, timestamp, signature };
}

export async function pullUserStoreFromSwarm(): Promise<{
  profile: FreelancerProfile | null;
  invoices: LocalInvoice[];
  updatedAt: string | null;
  found: boolean;
}> {
  const auth = await signUserAuth();
  const qs = new URLSearchParams({
    address: auth.address,
    timestamp: String(auth.timestamp),
    signature: auth.signature,
  });
  const res = await fetch(`/api/user/data?${qs}`);
  const data = (await res.json()) as {
    error?: string;
    found?: boolean;
    updatedAt?: string | null;
    profile?: FreelancerProfile | null;
    invoices?: LocalInvoice[];
  };
  if (!res.ok) throw new Error(data.error ?? "Failed to load Swarm user store");

  if (data.profile) saveProfile(data.profile);
  if (Array.isArray(data.invoices) && data.invoices.length > 0) {
    saveInvoices(data.invoices);
  }

  return {
    profile: data.profile ?? null,
    invoices: data.invoices ?? [],
    updatedAt: data.updatedAt ?? null,
    found: Boolean(data.found),
  };
}

export async function pushUserStoreToSwarm(input?: {
  profile?: FreelancerProfile;
  invoices?: LocalInvoice[];
  address?: string;
}): Promise<{ updatedAt: string }> {
  const profile = input?.profile ?? loadProfile();
  const invoices = input?.invoices ?? loadInvoices();
  const auth = await signUserAuth(
    input?.address || profile.defaultRefundTo || undefined,
  );

  const res = await fetch("/api/user/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...auth,
      profile,
      invoices,
    }),
  });
  const data = (await res.json()) as { error?: string; updatedAt?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to save Swarm user store");
  return { updatedAt: data.updatedAt ?? new Date().toISOString() };
}
