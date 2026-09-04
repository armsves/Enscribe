/**
 * Register a new .eth second-level name on ENSv2 Sepolia (commit-reveal).
 *
 * Usage:
 *   npx tsx scripts/register-parent-ens.ts commons3nse
 *   npx tsx scripts/register-parent-ens.ts commons3nse --years 1 --token usdc
 *   npx tsx scripts/register-parent-ens.ts commons3nse --dry
 *
 * Env (from .env.local):
 *   ENS_CONTROLLER_PRIVATE_KEY  required (becomes owner)
 *   ETH_RPC_URL                 optional
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

/** Matches ensjs Sepolia v2 deployment used by Enscribe. */
const ENS_V2_SEPOLIA = {
  ethRegistrar: "0xa88553F454b77203B0D036A05c894d555EAAa2Cc" as Address,
  ethRegistry: "0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2" as Address,
  permissionedResolver: "0x542F6c04D90AFa3a1059e0d2aB4356A8fa2aFFf0" as Address,
  usdc: "0x768F42455A2D082E23ceeF7d51e5787C82d67a39" as Address,
  dai: "0x5472C5725A00B7bA11F0794A79D08ade6F4683bD" as Address,
} as const;

const registrarAbi = parseAbi([
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function MAX_COMMITMENT_AGE() view returns (uint64)",
  "function MIN_REGISTER_DURATION() view returns (uint64)",
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);

const ethRegistryAbi = parseAbi([
  "function findTokenId(string label) view returns (uint256)",
  "function getOwner(uint256 anyId) view returns (address)",
  "function getExpiry(uint256 anyId) view returns (uint64)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

async function main() {
  loadEnvLocal();

  const label = (process.argv[2] || "").trim().toLowerCase().replace(/\.eth$/, "");
  if (!label || label.startsWith("--")) {
    console.error("Usage: npx tsx scripts/register-parent-ens.ts <label> [--years 1] [--token usdc|dai] [--dry]");
    process.exit(1);
  }

  const years = Number(arg("years") ?? "1");
  if (!Number.isFinite(years) || years < 1) {
    throw new Error("--years must be >= 1");
  }
  const duration = BigInt(Math.floor(years * 365 * 24 * 60 * 60));

  const tokenKey = (arg("token") ?? "usdc").toLowerCase();
  const paymentToken =
    tokenKey === "dai" ? ENS_V2_SEPOLIA.dai : ENS_V2_SEPOLIA.usdc;

  const rawKey = process.env.ENS_CONTROLLER_PRIVATE_KEY?.trim();
  if (!rawKey) {
    throw new Error("ENS_CONTROLLER_PRIVATE_KEY is not set");
  }
  const account = privateKeyToAccount(
    (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex,
  );

  const rpc =
    process.env.ETH_RPC_URL?.trim() ||
    "https://ethereum-sepolia-rpc.publicnode.com";
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });

  const ens = `${label}.eth`;
  console.log(`Registering ${ens} on Sepolia ENSv2`);
  console.log(`Owner: ${account.address}`);
  console.log(`Duration: ${years} year(s) (${duration}s)`);

  const available = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "isAvailable",
    args: [label],
  });
  if (!available) {
    const tokenId = await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "findTokenId",
      args: [label],
    });
    const owner = await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "getOwner",
      args: [tokenId],
    });
    const expiry = await publicClient.readContract({
      address: ENS_V2_SEPOLIA.ethRegistry,
      abi: ethRegistryAbi,
      functionName: "getExpiry",
      args: [tokenId],
    });
    console.log(`Already registered. owner=${owner} expiry=${new Date(Number(expiry) * 1000).toISOString()}`);
    process.exit(owner.toLowerCase() === account.address.toLowerCase() ? 0 : 1);
  }

  const minDuration = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "MIN_REGISTER_DURATION",
  });
  if (duration < minDuration) {
    throw new Error(`Duration ${duration} < MIN_REGISTER_DURATION ${minDuration}`);
  }

  const [base, premium] = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [label, duration, paymentToken],
  });
  const total = base + premium;
  const decimals = await publicClient.readContract({
    address: paymentToken,
    abi: erc20Abi,
    functionName: "decimals",
  });
  const symbol = await publicClient.readContract({
    address: paymentToken,
    abi: erc20Abi,
    functionName: "symbol",
  });
  console.log(`Price: ${formatUnits(total, decimals)} ${symbol} (base=${base} premium=${premium})`);

  const balance = await publicClient.readContract({
    address: paymentToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < total) {
    throw new Error(
      `Insufficient ${symbol}: have ${formatUnits(balance, decimals)}, need ${formatUnits(total, decimals)}`,
    );
  }

  const secret = randomSecret();
  const subregistry = zeroAddress;
  const resolver = ENS_V2_SEPOLIA.permissionedResolver;
  const referrer = zeroHash;

  const commitment = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "makeCommitment",
    args: [
      label,
      account.address,
      secret,
      subregistry,
      resolver,
      duration,
      referrer,
    ],
  });
  console.log(`Commitment: ${commitment}`);

  if (hasFlag("dry")) {
    console.log("Dry run — skipping commit/register");
    return;
  }

  const minAge = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "MIN_COMMITMENT_AGE",
  });

  const commitHash = await wallet.writeContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "commit",
    args: [commitment],
  });
  console.log(`commit tx: ${commitHash}`);
  await publicClient.waitForTransactionReceipt({ hash: commitHash });

  const waitMs = Number(minAge) * 1000 + 5000;
  console.log(`Waiting ${Math.ceil(waitMs / 1000)}s for commitment age…`);
  await sleep(waitMs);

  const allowance = await publicClient.readContract({
    address: paymentToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, ENS_V2_SEPOLIA.ethRegistrar],
  });
  if (allowance < total) {
    const approveHash = await wallet.writeContract({
      address: paymentToken,
      abi: erc20Abi,
      functionName: "approve",
      args: [ENS_V2_SEPOLIA.ethRegistrar, total],
    });
    console.log(`approve tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const registerHash = await wallet.writeContract({
    address: ENS_V2_SEPOLIA.ethRegistrar,
    abi: registrarAbi,
    functionName: "register",
    args: [
      label,
      account.address,
      secret,
      subregistry,
      resolver,
      duration,
      paymentToken,
      referrer,
    ],
  });
  console.log(`register tx: ${registerHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: registerHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`register reverted (tx ${registerHash})`);
  }

  const tokenId = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "findTokenId",
    args: [label],
  });
  const owner = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getOwner",
    args: [tokenId],
  });
  const expiry = await publicClient.readContract({
    address: ENS_V2_SEPOLIA.ethRegistry,
    abi: ethRegistryAbi,
    functionName: "getExpiry",
    args: [tokenId],
  });

  console.log(`Registered ${ens}`);
  console.log(`  owner:  ${owner}`);
  console.log(`  expiry: ${new Date(Number(expiry) * 1000).toISOString()}`);
  console.log(`  tx:     https://sepolia.etherscan.io/tx/${registerHash}`);
  console.log(`  app:    https://sepolia.app.ens.domains/${ens}`);
  console.log(`\nSet ENS_PARENT_NAME=${ens} in .env.local to use it as the invoice parent.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
