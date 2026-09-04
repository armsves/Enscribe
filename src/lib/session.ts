"use client";

import { getAddress } from "viem";
import { connectMetaMask, getEthereum } from "@/lib/wallets";
import { loadProfile, saveProfile } from "@/lib/invoice-store";

const SESSION_KEY = "enscribe.session.v1";

export type WalletSession = {
  address: string;
  connectedAt: string;
};

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadSession(): WalletSession | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletSession;
    if (!parsed?.address) return null;
    return { ...parsed, address: getAddress(parsed.address) };
  } catch {
    return null;
  }
}

export function saveSession(session: WalletSession | null) {
  if (!canUseStorage()) return;
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  saveSession(null);
}

/** Connect MetaMask, persist session, and seed refund wallet on profile. */
export async function loginWithMetaMask(): Promise<WalletSession> {
  const address = getAddress(await connectMetaMask());
  const session: WalletSession = {
    address,
    connectedAt: new Date().toISOString(),
  };
  saveSession(session);
  const profile = loadProfile();
  if (!profile.defaultRefundTo) {
    saveProfile({ ...profile, defaultRefundTo: address });
  }
  return session;
}

export async function restoreSessionIfConnected(): Promise<WalletSession | null> {
  const eth = getEthereum();
  const existing = loadSession();
  if (!eth) return existing;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    if (!accounts[0]) {
      clearSession();
      return null;
    }
    const address = getAddress(accounts[0]);
    const session: WalletSession = {
      address,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
    };
    saveSession(session);
    return session;
  } catch {
    return existing;
  }
}
