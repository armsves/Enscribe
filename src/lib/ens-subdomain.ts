import "server-only";

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash, normalize } from "viem/ens";
import { sepolia } from "viem/chains";
import { getEnsNetwork, getEnsRpcUrl } from "./ens-client";
import { ENSCRIBE_KEYS } from "./ens-records";

/** ENSv2 Sepolia ETHRegistry (matches current Universal Resolver deployment). */
export const ENS_V2_SEPOLIA = {
  ethRegistry: "0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2" as Address,
  userRegistryImpl: "0x624a25d67B59D587752EbEc8DdeD8827dAe52050" as Address,
  verifiableFactory: "0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef" as Address,
} as const;

const ethRegistryAbi = parseAbi([
  "function findTokenId(string label) view returns (uint256)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
  "function getSubregistry(string label) view returns (address)",
  "function setSubregistry(uint256 anyId, address registry)",
]);

const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)",
]);

const userRegistryAbi = parseAbi([
  "function initialize(address rootAccount, uint256 roleBitmap)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function findOwner(string label) view returns (address)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function ROOT_RESOURCE() view returns (uint256)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
]);

/**
 * RegistryRolesLib bit positions (ENSv2).
 * Admin bit for each role is the same position + 128.
 */
const ROLE_REGISTRAR = BigInt(1) << BigInt(0);
const ROLE_REGISTRAR_ADMIN = BigInt(1) << BigInt(128);
const ROLE_UNREGISTER = BigInt(1) << BigInt(12);
const ROLE_UNREGISTER_ADMIN = BigInt(1) << BigInt(140);
const ROLE_RENEW = BigInt(1) << BigInt(16);
const ROLE_RENEW_ADMIN = BigInt(1) << BigInt(144);
const ROLE_SET_SUBREGISTRY = BigInt(1) << BigInt(20);
const ROLE_SET_SUBREGISTRY_ADMIN = BigInt(1) << BigInt(148);
const ROLE_SET_RESOLVER = BigInt(1) << BigInt(24);
const ROLE_SET_RESOLVER_ADMIN = BigInt(1) << BigInt(152);
const ROLE_UPGRADE = BigInt(1) << BigInt(124);
const ROLE_UPGRADE_ADMIN = BigInt(1) << BigInt(252);

/** Roles granted to the Enscribe controller on new UserRegistry proxies. */
const CONTROLLER_ROOT_ROLES =
  ROLE_REGISTRAR |
  ROLE_REGISTRAR_ADMIN |
  ROLE_UNREGISTER |
  ROLE_UNREGISTER_ADMIN |
  ROLE_RENEW |
  ROLE_RENEW_ADMIN |
  ROLE_SET_SUBREGISTRY |
  ROLE_SET_SUBREGISTRY_ADMIN |
  ROLE_SET_RESOLVER |
  ROLE_SET_RESOLVER_ADMIN |
  ROLE_UPGRADE |
  ROLE_UPGRADE_ADMIN;

/** PermissionedResolver used by superteambk.eth on Sepolia (controller already has all roles). */
export const ENS_PUBLIC_RESOLVER_SEPOLIA =
  "0x542F6c04D90AFa3a1059e0d2aB4356A8fa2aFFf0" as Address;

const publicResolverAbi = parseAbi([
  "function setAddr(bytes32 node, address a)",
  "function setText(bytes32 node, string key, string value)",
  "function multicallWithNodeCheck(bytes32 node, bytes[] data) returns (bytes[])",
]);

export type PaymentEnsMetadata = {
  depositAddress: Address;
  amount: string;
  amountFormatted: string;
  originChain: string;
  originSymbol: string;
  refundTo: Address;
  createdAt: string;
  clientName: string;
  description: string;
  invoiceNumber: string;
  freelancerName: string;
};

function getParentLabel(): string {
  const parent = (process.env.ENS_PARENT_NAME ?? "commons3nse.eth")
    .trim()
    .toLowerCase();
  if (!parent.endsWith(".eth")) {
    throw new Error("ENS_PARENT_NAME must be a .eth name");
  }
  return parent.slice(0, -4);
}

export function getParentEnsName(): string {
  return (process.env.ENS_PARENT_NAME ?? "commons3nse.eth").trim().toLowerCase();
}

export function isControllerConfigured(): boolean {
  return Boolean(process.env.ENS_CONTROLLER_PRIVATE_KEY?.trim());
}

/** Controller EVM address (default Intents refund target). */
export function getControllerAddress(): Address | null {
  if (!isControllerConfigured()) return null;
  try {
    return getControllerAccount().address;
  } catch {
    return null;
  }
}

function getControllerAccount() {
  const raw = process.env.ENS_CONTROLLER_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("ENS_CONTROLLER_PRIVATE_KEY is not set");
  }
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return privateKeyToAccount(key);
}

function getClients() {
  if (getEnsNetwork() !== "sepolia") {
    throw new Error(
      "On-chain subdomain mint currently supports ENS_CHAIN=sepolia only",
    );
  }
  const account = getControllerAccount();
  const transport = http(getEnsRpcUrl());
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  return { publicClient, wallet, account };
}

function saltForParent(parentLabel: string, version = "v2"): bigint {
  const bytes = new TextEncoder().encode(`solpay:${parentLabel}:${version}`);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(`0x${hex.slice(0, 64).padEnd(64, "0")}`);
}

async function controllerCanRegister(
  publicClient: ReturnType<typeof createPublicClient>,
  subregistry: Address,
  account: Address,
): Promise<boolean> {
  try {
    const root = (await publicClient.readContract({
      address: subregistry,
      abi: userRegistryAbi,
      functionName: "ROOT_RESOURCE",
    })) as bigint;
    return Boolean(
      await publicClient.readContract({
        address: subregistry,
        abi: userRegistryAbi,
        functionName: "hasRoles",
        args: [root, ROLE_REGISTRAR, account],
      }),
    );
  } catch {
    return false;
  }
}

export type MintResult = {
  ens: string;
  label: string;
  parentEns: string;
  ownerAddress: Address;
  txHash: Hex | null;
  status: "minted" | "skipped" | "failed";
  subregistry: Address | null;
  error?: string;
};

async function ensureSubregistry(
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  parentLabel: string,
): Promise<Address> {
  const existing = (await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getSubregistry",
    args: [parentLabel],
  })) as Address;

  // v1 proxy was initialized with roleBitmap=0 → controller cannot register.
  // Reuse only if ROLE_REGISTRAR is present; otherwise redeploy with roles.
  if (
    existing &&
    existing !== zeroAddress &&
    (await controllerCanRegister(publicClient, existing, account.address))
  ) {
    return existing;
  }

  const parentTokenId = (await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "findTokenId",
    args: [parentLabel],
  })) as bigint;

  const parentOwner = (await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getOwner",
    args: [parentTokenId],
  })) as Address;

  if (parentOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Controller ${account.address} is not owner of ${parentLabel}.eth (owner ${parentOwner}). Put the parent owner key in ENS_CONTROLLER_PRIVATE_KEY.`,
    );
  }

  const initData = encodeFunctionData({
    abi: userRegistryAbi,
    functionName: "initialize",
    args: [account.address, CONTROLLER_ROOT_ROLES],
  });

  // Bump salt version when replacing a broken (zero-role) proxy.
  const saltVersion =
    existing && existing !== zeroAddress ? "v2-roles" : "v2";

  const { request, result: proxy } = await publicClient.simulateContract({
    account,
    address: ENS_V2_SEPOLIA.verifiableFactory,
    abi: factoryAbi,
    functionName: "deployProxy",
    args: [
      ENS_V2_SEPOLIA.userRegistryImpl,
      saltForParent(parentLabel, saltVersion),
      initData,
    ],
  });

  const deployHash = await wallet.writeContract(request);
  const deployReceipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  if (deployReceipt.status !== "success") {
    throw new Error("Failed to deploy parent subregistry proxy");
  }

  const setHash = await wallet.writeContract({
    account,
    chain: sepolia,
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "setSubregistry",
    args: [parentTokenId, proxy],
  });
  const setReceipt = await publicClient.waitForTransactionReceipt({
    hash: setHash,
  });
  if (setReceipt.status !== "success") {
    throw new Error("setSubregistry failed");
  }

  if (!(await controllerCanRegister(publicClient, proxy, account.address))) {
    throw new Error(
      `Deployed subregistry ${proxy} but controller still lacks ROLE_REGISTRAR`,
    );
  }

  return proxy;
}

function paymentNode(label: string, parentEns: string): Hex {
  return namehash(normalize(`${label}.${parentEns}`));
}

async function writePaymentEnsRecords(input: {
  wallet: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  label: string;
  parentEns: string;
  metadata: PaymentEnsMetadata;
}): Promise<Hex> {
  const node = paymentNode(input.label, input.parentEns);
  const deposit = input.metadata.depositAddress;

  const recordEntries: [string, string][] = [
    [ENSCRIBE_KEYS.depositAddress, deposit],
    [ENSCRIBE_KEYS.amount, input.metadata.amount],
    [ENSCRIBE_KEYS.amountFormatted, input.metadata.amountFormatted],
    [ENSCRIBE_KEYS.originChain, input.metadata.originChain],
    [ENSCRIBE_KEYS.originSymbol, input.metadata.originSymbol],
    [ENSCRIBE_KEYS.refundTo, input.metadata.refundTo],
    [ENSCRIBE_KEYS.createdAt, input.metadata.createdAt],
    [ENSCRIBE_KEYS.clientName, input.metadata.clientName],
    [ENSCRIBE_KEYS.description, input.metadata.description],
    [ENSCRIBE_KEYS.invoiceNumber, input.metadata.invoiceNumber],
    [ENSCRIBE_KEYS.freelancerName, input.metadata.freelancerName],
  ];

  const calls = [
    encodeFunctionData({
      abi: publicResolverAbi,
      functionName: "setAddr",
      args: [node, deposit],
    }),
    ...recordEntries.map(([key, value]) =>
      encodeFunctionData({
        abi: publicResolverAbi,
        functionName: "setText",
        args: [node, key, value],
      }),
    ),
  ];

  const hash = await input.wallet.writeContract({
    account: input.account,
    chain: sepolia,
    address: ENS_PUBLIC_RESOLVER_SEPOLIA,
    abi: publicResolverAbi,
    functionName: "multicallWithNodeCheck",
    args: [node, calls],
  });

  return hash;
}

export type PaymentMintResult = MintResult & {
  recordsTxHash: Hex | null;
};

/**
 * Mint a one-off payment subdomain and write public deposit metadata to ENS.
 * Solana is never written on-chain.
 */
export async function mintPaymentRequestSubdomain(input: {
  label: string;
  metadata: PaymentEnsMetadata;
}): Promise<PaymentMintResult> {
  const parentEns = getParentEnsName();
  const parentLabel = getParentLabel();
  const label = input.label.trim().toLowerCase();
  const ens = `${label}.${parentEns}`;

  const base: PaymentMintResult = {
    ens,
    label,
    parentEns,
    ownerAddress: zeroAddress,
    txHash: null,
    recordsTxHash: null,
    status: "skipped",
    subregistry: null,
  };

  if (!isControllerConfigured()) {
    return {
      ...base,
      error: "ENS_CONTROLLER_PRIVATE_KEY not set — cannot mint payment subdomain",
    };
  }

  if (process.env.ENS_ONCHAIN_MINT?.trim() === "false") {
    return { ...base, error: "ENS_ONCHAIN_MINT=false" };
  }

  try {
    const { publicClient, wallet, account } = getClients();
    base.ownerAddress = account.address;

    const subregistry = await ensureSubregistry(
      publicClient,
      wallet,
      account,
      parentLabel,
    );

    const existingOwner = (await publicClient.readContract({
      address: subregistry,
      abi: userRegistryAbi,
      functionName: "findOwner",
      args: [label],
    })) as Address;
    if (existingOwner && existingOwner !== zeroAddress) {
      throw new Error(`${ens} already exists on-chain`);
    }

    const parentTokenId = (await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "findTokenId",
      args: [parentLabel],
    })) as bigint;
    const expiry = (await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "getExpiry",
      args: [parentTokenId],
    })) as bigint;

    const txHash = await wallet.writeContract({
      account,
      chain: sepolia,
      address: subregistry,
      abi: userRegistryAbi,
      functionName: "register",
      args: [
        label,
        account.address,
        zeroAddress,
        ENS_PUBLIC_RESOLVER_SEPOLIA,
        BigInt(0),
        expiry,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`register reverted (tx ${txHash})`);
    }

    const recordsTxHash = await writePaymentEnsRecords({
      wallet,
      account,
      label,
      parentEns,
      metadata: input.metadata,
    });
    const recordsReceipt = await publicClient.waitForTransactionReceipt({
      hash: recordsTxHash,
    });
    if (recordsReceipt.status !== "success") {
      throw new Error(`ENS record writes reverted (tx ${recordsTxHash})`);
    }

    return {
      ens,
      label,
      parentEns,
      ownerAddress: account.address,
      txHash,
      recordsTxHash,
      status: "minted",
      subregistry,
    };
  } catch (error) {
    return {
      ...base,
      ownerAddress: getControllerAccount().address,
      status: "failed",
      error: error instanceof Error ? error.message : "Payment mint failed",
    };
  }
}

/**
 * Mint `label.parent.eth` on ENSv2 Sepolia using the controller key.
 * Solana is NOT written on-chain — only the EVM owner is.
 */
export async function mintEnsSubdomain(input: {
  label: string;
  ownerAddress: Address;
}): Promise<MintResult> {
  const parentEns = getParentEnsName();
  const parentLabel = getParentLabel();
  const label = input.label.trim().toLowerCase();
  const ens = `${label}.${parentEns}`;

  if (!isControllerConfigured()) {
    return {
      ens,
      label,
      parentEns,
      ownerAddress: input.ownerAddress,
      txHash: null,
      status: "skipped",
      subregistry: null,
      error: "ENS_CONTROLLER_PRIVATE_KEY not set — saved off-chain only",
    };
  }

  if (process.env.ENS_ONCHAIN_MINT?.trim() === "false") {
    return {
      ens,
      label,
      parentEns,
      ownerAddress: input.ownerAddress,
      txHash: null,
      status: "skipped",
      subregistry: null,
      error: "ENS_ONCHAIN_MINT=false",
    };
  }

  try {
    const { publicClient, wallet, account } = getClients();
    const subregistry = await ensureSubregistry(
      publicClient,
      wallet,
      account,
      parentLabel,
    );

    try {
      const existingOwner = (await publicClient.readContract({
        address: subregistry,
        abi: userRegistryAbi,
        functionName: "findOwner",
        args: [label],
      })) as Address;
      if (existingOwner && existingOwner !== zeroAddress) {
        if (existingOwner.toLowerCase() !== input.ownerAddress.toLowerCase()) {
          throw new Error(`${ens} already exists on-chain for ${existingOwner}`);
        }
        return {
          ens,
          label,
          parentEns,
          ownerAddress: input.ownerAddress,
          txHash: null,
          status: "minted",
          subregistry,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw error;
      }
    }

    const parentTokenId = (await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "findTokenId",
      args: [parentLabel],
    })) as bigint;
    const expiry = (await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "getExpiry",
      args: [parentTokenId],
    })) as bigint;

    const txHash = await wallet.writeContract({
      account,
      chain: sepolia,
      address: subregistry,
      abi: userRegistryAbi,
      functionName: "register",
      args: [label, input.ownerAddress, zeroAddress, zeroAddress, BigInt(0), expiry],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`register reverted (tx ${txHash})`);
    }

    return {
      ens,
      label,
      parentEns,
      ownerAddress: input.ownerAddress,
      txHash,
      status: "minted",
      subregistry,
    };
  } catch (error) {
    return {
      ens,
      label,
      parentEns,
      ownerAddress: input.ownerAddress,
      txHash: null,
      status: "failed",
      subregistry: null,
      error: error instanceof Error ? error.message : "Mint failed",
    };
  }
}
