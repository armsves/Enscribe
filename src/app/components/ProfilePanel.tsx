"use client";

import { useEffect, useState } from "react";
import {
  loadInvoices,
  loadProfile,
  saveProfile,
  type FreelancerProfile,
} from "@/lib/invoice-store";
import {
  pullUserStoreFromSwarm,
  pushUserStoreToSwarm,
} from "@/lib/swarm-client";
import {
  connectMetaMask,
  connectPhantom,
  shorten,
} from "@/lib/wallets";

export function ProfilePanel() {
  const [profile, setProfile] = useState<FreelancerProfile>({
    displayName: "",
    solanaAddress: "",
    defaultRefundTo: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  const persist = (next: FreelancerProfile) => {
    setProfile(next);
    saveProfile(next);
  };

  const onMetaMask = async () => {
    setError(null);
    setMessage(null);
    try {
      const address = await connectMetaMask();
      persist({ ...profile, defaultRefundTo: address });
      setMessage(`MetaMask linked: ${shorten(address)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MetaMask connect failed");
    }
  };

  const onPhantom = async () => {
    setError(null);
    setMessage(null);
    try {
      const address = await connectPhantom();
      persist({ ...profile, solanaAddress: address });
      setMessage(`Phantom linked: ${shorten(address, 6)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Phantom connect failed");
    }
  };

  const onSaveLocal = () => {
    saveProfile(profile);
    setMessage("Profile saved in this browser");
    setError(null);
  };

  const onPushSwarm = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      saveProfile(profile);
      const { updatedAt } = await pushUserStoreToSwarm({
        profile,
        invoices: loadInvoices(),
        address: profile.defaultRefundTo || undefined,
      });
      setMessage(`Synced to Swarm at ${updatedAt}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swarm sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const onPullSwarm = async () => {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await pullUserStoreFromSwarm();
      if (result.profile) setProfile(result.profile);
      setMessage(
        result.found
          ? `Loaded Swarm store (${result.invoices.length} invoices, ${result.updatedAt})`
          : "No Swarm record yet — save once to create it",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swarm load failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-5 pb-16 pt-6">
      <p className="mb-3 font-[family-name:var(--font-mono)] text-xs tracking-[0.2em] text-[var(--ledger)] uppercase">
        Freelancer
      </p>
      <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl">
        Register wallets
      </h1>
      <p className="mt-4 text-[var(--fg-muted)]">
        Link MetaMask + Phantom locally, then sync an encrypted profile/ledger
        to Swarm. Postage batch stays on the server — you only sign with
        MetaMask to prove wallet ownership.
      </p>

      <div className="mt-8 space-y-4 border border-[var(--line)] bg-[var(--bg-panel)] p-6">
        <label className="block text-sm text-[var(--fg-muted)]">
          Display name
          <input
            value={profile.displayName}
            onChange={(e) =>
              setProfile({ ...profile, displayName: e.target.value })
            }
            className="mt-2 w-full border border-[var(--line)] bg-[#071018] px-3 py-3 text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </label>

        <div className="space-y-2">
          <p className="text-sm text-[var(--fg-muted)]">
            Solana settlement (Phantom)
          </p>
          <button
            type="button"
            onClick={() => void onPhantom()}
            className="border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--ledger)]"
          >
            Connect Phantom
          </button>
          <input
            value={profile.solanaAddress}
            onChange={(e) =>
              setProfile({ ...profile, solanaAddress: e.target.value })
            }
            placeholder="Solana address"
            className="w-full border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-[var(--fg-muted)]">
            EVM identity / refund (MetaMask) — used as Swarm store key
          </p>
          <button
            type="button"
            onClick={() => void onMetaMask()}
            className="border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--ledger)]"
          >
            Connect MetaMask
          </button>
          <input
            value={profile.defaultRefundTo}
            onChange={(e) =>
              setProfile({ ...profile, defaultRefundTo: e.target.value })
            }
            placeholder="0x…"
            className="w-full border border-[var(--line)] bg-[#071018] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--fg)] outline-none focus:border-[var(--ledger)]"
          />
        </div>

        <button
          type="button"
          onClick={onSaveLocal}
          className="w-full border border-[var(--line)] px-4 py-3 text-sm hover:border-[var(--ledger)]"
        >
          Save in browser
        </button>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={syncing}
            onClick={() => void onPushSwarm()}
            className="bg-[var(--ledger)] px-4 py-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Push to Swarm"}
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void onPullSwarm()}
            className="border border-[var(--line)] px-4 py-3 text-sm disabled:opacity-50 hover:border-[var(--ledger)]"
          >
            {syncing ? "Loading…" : "Pull from Swarm"}
          </button>
        </div>

        {message && <p className="text-sm text-[var(--ok)]">{message}</p>}
        {error && (
          <p className="border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
