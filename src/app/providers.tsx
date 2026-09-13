"use client";

import {
  PrivyProvider,
  usePrivy,
  useSignMessage,
  useWallets,
} from "@privy-io/react-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAddress, isAddress } from "viem";
import { sepolia } from "viem/chains";
import {
  clearSession,
  loadSession,
  loginWithMetaMask,
  saveSession,
  type WalletSession,
} from "@/lib/session";
import { loadProfile, saveProfile } from "@/lib/invoice-store";
import { setSwarmMessageSigner } from "@/lib/swarm-client";

type EnscribeAuthValue = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  session: WalletSession | null;
  address: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const EnscribeAuthContext = createContext<EnscribeAuthValue | null>(null);

function seedProfileRefund(address: string) {
  const profile = loadProfile();
  if (!profile.defaultRefundTo) {
    saveProfile({ ...profile, defaultRefundTo: address });
  }
}

function persistSession(address: string): WalletSession {
  const session: WalletSession = {
    address: getAddress(address),
    connectedAt: loadSession()?.connectedAt ?? new Date().toISOString(),
  };
  saveSession(session);
  seedProfileRefund(session.address);
  return session;
}

function PrivySwarmBridge() {
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();

  useEffect(() => {
    if (!wallets[0]?.address) {
      setSwarmMessageSigner(null);
      return;
    }

    setSwarmMessageSigner(async (message, address) => {
      const { signature } = await signMessage(
        { message },
        {
          address,
          uiOptions: {
            title: "Sign to sync Enscribe Swarm store",
          },
        },
      );
      return signature as `0x${string}`;
    });

    return () => setSwarmMessageSigner(null);
  }, [signMessage, wallets]);

  return null;
}

function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout: privyLogout, user } =
    usePrivy();
  const { wallets } = useWallets();

  const address = useMemo(() => {
    const fromWallet = wallets.find((w) => isAddress(w.address))?.address;
    if (fromWallet) return getAddress(fromWallet);
    const linked = user?.wallet?.address;
    if (linked && isAddress(linked)) return getAddress(linked);
    return null;
  }, [wallets, user]);

  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (authenticated && address) {
      setSession(persistSession(address));
      return;
    }
    if (!authenticated) {
      clearSession();
      setSession(null);
    }
  }, [ready, authenticated, address]);

  const loginFn = useCallback(async () => {
    login();
  }, [login]);

  const logoutFn = useCallback(async () => {
    clearSession();
    setSession(null);
    await privyLogout();
  }, [privyLogout]);

  const value: EnscribeAuthValue = {
    configured: true,
    ready,
    authenticated: Boolean(session),
    session,
    address: session?.address ?? null,
    login: loginFn,
    logout: logoutFn,
  };

  return (
    <EnscribeAuthContext.Provider value={value}>
      <PrivySwarmBridge />
      {children}
    </EnscribeAuthContext.Provider>
  );
}

/** MetaMask-only fallback when NEXT_PUBLIC_PRIVY_APP_ID is unset. */
function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  const loginFn = useCallback(async () => {
    const next = await loginWithMetaMask();
    setSession(next);
  }, []);

  const logoutFn = useCallback(async () => {
    clearSession();
    setSession(null);
  }, []);

  const value: EnscribeAuthValue = {
    configured: false,
    ready,
    authenticated: Boolean(session),
    session,
    address: session?.address ?? null,
    login: loginFn,
    logout: logoutFn,
  };

  return (
    <EnscribeAuthContext.Provider value={value}>
      {children}
    </EnscribeAuthContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();

  if (!appId) {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#1fa97a",
          logo: "/logo.png",
        },
        defaultChain: sepolia,
        supportedChains: [sepolia],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <PrivyAuthProvider>{children}</PrivyAuthProvider>
    </PrivyProvider>
  );
}

export function useEnscribeAuth(): EnscribeAuthValue {
  const ctx = useContext(EnscribeAuthContext);
  if (!ctx) {
    throw new Error("useEnscribeAuth must be used within Providers");
  }
  return ctx;
}
