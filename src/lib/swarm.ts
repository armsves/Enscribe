import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { Bee, PrivateKey, Topic } from "@ethersphere/bee-js";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import type { FreelancerProfile, LocalInvoice } from "./invoice-store";

export type SwarmUserRecord = {
  version: 1;
  wallet: string;
  updatedAt: string;
  profile: FreelancerProfile;
  invoices: LocalInvoice[];
};

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function requiredBatchId(): string {
  const batchId = process.env.BEE_BATCH_ID?.trim();
  if (!batchId) throw new Error("BEE_BATCH_ID is not set");
  return batchId;
}

function dataSecret(): string {
  const secret = process.env.SWARM_DATA_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "SWARM_DATA_SECRET is not set — required to encrypt per-wallet Swarm records",
    );
  }
  return secret;
}

function feedPrivateKeyHex(): Hex {
  const raw =
    process.env.SWARM_FEED_PRIVATE_KEY?.trim() ||
    process.env.ENS_CONTROLLER_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SWARM_FEED_PRIVATE_KEY or ENS_CONTROLLER_PRIVATE_KEY is required for Swarm user feeds",
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

export function isSwarmConfigured(): boolean {
  return Boolean(
    process.env.BEE_URL?.trim() && process.env.BEE_BATCH_ID?.trim(),
  );
}

export function isUserStoreConfigured(): boolean {
  return (
    isSwarmConfigured() && Boolean(process.env.SWARM_DATA_SECRET?.trim())
  );
}

export function makeBee(signer?: Hex): Bee {
  const url = (process.env.BEE_URL ?? "http://localhost:1633").replace(
    /\/$/,
    "",
  );
  const password = process.env.BEE_API_PASSWORD?.trim();
  const headers = password
    ? {
        Authorization: `Basic ${Buffer.from(`:${password}`, "utf8").toString("base64")}`,
      }
    : undefined;

  if (signer) {
    return new Bee(url, {
      headers,
      signer: new PrivateKey(signer),
    });
  }
  return new Bee(url, { headers });
}

function deriveUserKey(wallet: string): Buffer {
  return createHmac("sha256", dataSecret())
    .update(getAddress(wallet).toLowerCase())
    .digest();
}

function encryptForWallet(wallet: string, plaintext: string): Uint8Array {
  const key = deriveUserKey(wallet);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptForWallet(wallet: string, blob: Uint8Array): string {
  const buf = Buffer.from(blob);
  if (buf.length < 28) throw new Error("Corrupt Swarm user ciphertext");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = deriveUserKey(wallet);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function topicForWallet(wallet: string): Topic {
  return Topic.fromString(`enscribe:user:v1:${getAddress(wallet).toLowerCase()}`);
}

export type SwarmUploadResult = {
  reference: string;
  encrypted: boolean;
};

/**
 * Upload bytes. Prefer app-level encryption for user records so Swarm refs stay
 * 64 hex chars (safe to point from feeds without leaking decryption keys).
 * Invoice PDFs may still use Bee encrypt:true when SWARM_ENCRYPT=true.
 */
export async function uploadBytes(input: {
  data: Uint8Array;
  filename?: string;
  contentType?: string;
  /** Bee client-side encryption (embeds key in reference). Default false. */
  beeEncrypt?: boolean;
}): Promise<SwarmUploadResult> {
  const batchId = requiredBatchId();
  const bee = makeBee();
  const beeEncrypt = input.beeEncrypt ?? envBool("SWARM_ENCRYPT", false);

  if (input.filename) {
    const uploaded = await bee.file.upload(
      batchId,
      input.data,
      input.filename,
      {
        contentType: input.contentType ?? "application/octet-stream",
        encrypt: beeEncrypt,
        deferred: false,
      },
    );
    return { reference: uploaded.reference.toHex(), encrypted: beeEncrypt };
  }

  const uploaded = await bee.data.upload(batchId, input.data, {
    encrypt: beeEncrypt,
    deferred: false,
  });
  return { reference: uploaded.reference.toHex(), encrypted: beeEncrypt };
}

/** @deprecated use uploadBytes — kept for invoice PDF path */
export async function uploadEncryptedFile(input: {
  data: Uint8Array;
  filename: string;
  contentType: string;
}): Promise<SwarmUploadResult & { gatewayUrl: string }> {
  const beeUrl = (process.env.BEE_URL ?? "http://localhost:1633").replace(
    /\/$/,
    "",
  );
  const result = await uploadBytes({
    ...input,
    beeEncrypt: envBool("SWARM_ENCRYPT", true),
  });
  return {
    ...result,
    gatewayUrl: `${beeUrl}/bzz/${result.reference}/`,
  };
}

export async function downloadBytes(reference: string): Promise<Uint8Array> {
  const bee = makeBee();
  const data = await bee.data.download(reference);
  return data.toUint8Array();
}

export const USER_AUTH_PREFIX = "Enscribe user store";

export function buildUserAuthMessage(address: string, timestamp: number): string {
  return `${USER_AUTH_PREFIX}\nAddress: ${getAddress(address)}\nTimestamp: ${timestamp}`;
}

export async function verifyUserAuth(input: {
  address: string;
  timestamp: number;
  signature: Hex;
}): Promise<string> {
  if (!isAddress(input.address)) throw new Error("Invalid wallet address");
  const address = getAddress(input.address);
  const ageMs = Math.abs(Date.now() - input.timestamp);
  if (ageMs > 15 * 60 * 1000) {
    throw new Error("Auth timestamp expired — sign again");
  }
  const message = buildUserAuthMessage(address, input.timestamp);
  const ok = await verifyMessage({
    address,
    message,
    signature: input.signature,
  });
  if (!ok) throw new Error("Invalid wallet signature");
  return address;
}

export async function loadUserRecord(
  wallet: string,
): Promise<SwarmUserRecord | null> {
  if (!isUserStoreConfigured()) return null;

  const feedKey = feedPrivateKeyHex();
  const bee = makeBee(feedKey);
  const owner = new PrivateKey(feedKey).publicKey().address();
  const topic = topicForWallet(wallet);
  const reader = bee.feed.makeReader(topic, owner);

  let reference: string;
  try {
    const latest = await reader.downloadReference();
    reference = latest.reference.toHex();
  } catch {
    return null;
  }

  const cipher = await downloadBytes(reference);
  const json = decryptForWallet(wallet, cipher);
  const parsed = JSON.parse(json) as SwarmUserRecord;
  if (parsed.version !== 1 || !parsed.wallet) {
    throw new Error("Unsupported Swarm user record");
  }
  return parsed;
}

export async function saveUserRecord(input: {
  wallet: string;
  profile: FreelancerProfile;
  invoices: LocalInvoice[];
}): Promise<{ updatedAt: string }> {
  if (!isUserStoreConfigured()) {
    throw new Error("Swarm user store is not configured");
  }

  const wallet = getAddress(input.wallet);
  const updatedAt = new Date().toISOString();
  const record: SwarmUserRecord = {
    version: 1,
    wallet,
    updatedAt,
    profile: {
      displayName: input.profile.displayName ?? "",
      solanaAddress: input.profile.solanaAddress ?? "",
      defaultRefundTo: input.profile.defaultRefundTo ?? "",
    },
    // Never persist Bee encrypt refs that embed keys; strip pdf blobs too (large).
    invoices: input.invoices.map((inv) => ({
      ...inv,
      pdfBase64: null,
      swarmReference: null,
      swarmGatewayUrl: null,
    })),
  };

  const plaintext = JSON.stringify(record);
  const cipher = encryptForWallet(wallet, plaintext);
  const uploaded = await uploadBytes({
    data: cipher,
    beeEncrypt: false,
  });

  const feedKey = feedPrivateKeyHex();
  const bee = makeBee(feedKey);
  const topic = topicForWallet(wallet);
  const writer = bee.feed.makeWriter(topic, feedKey);
  await writer.uploadReference(requiredBatchId(), uploaded.reference, {
    deferred: false,
  });

  return { updatedAt };
}
