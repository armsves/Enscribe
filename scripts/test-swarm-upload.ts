/**
 * Test a small encrypted upload to EthSwarm via bee-js.
 *
 * Usage:
 *   npx tsx scripts/test-swarm-upload.ts
 *   npx tsx scripts/test-swarm-upload.ts --dry
 *   npx tsx scripts/test-swarm-upload.ts --message "hello from enscribe"
 *
 * Env (from .env.local):
 *   BEE_URL           Bee / gateway API (default http://localhost:1633)
 *   BEE_BATCH_ID      postage stamp batch ID (required unless --dry)
 *   BEE_API_PASSWORD  optional Bee API password
 *   SWARM_ENCRYPT     default true
 *
 * Docs: https://docs.ethswarm.org/docs/develop/upload-and-download/
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Bee } from "@ethersphere/bee-js";

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

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function makeBee(url: string, password?: string): Bee {
  if (!password) return new Bee(url);
  const token = Buffer.from(`:${password}`, "utf8").toString("base64");
  return new Bee(url, {
    headers: { Authorization: `Basic ${token}` },
  });
}

async function main() {
  loadEnvLocal();

  const beeUrl = (process.env.BEE_URL ?? "http://localhost:1633").replace(
    /\/$/,
    "",
  );
  const batchId = process.env.BEE_BATCH_ID?.trim() ?? "";
  const password = process.env.BEE_API_PASSWORD?.trim();
  const encrypt = envBool("SWARM_ENCRYPT", true);
  const dry = hasFlag("dry");

  const message =
    arg("message") ??
    `Enscribe Swarm smoke test @ ${new Date().toISOString()}\n`;

  console.log(`Bee URL:   ${beeUrl}`);
  console.log(`Batch ID:  ${batchId ? `${batchId.slice(0, 12)}…` : "(missing)"}`);
  console.log(`Encrypt:   ${encrypt}`);
  console.log(`Payload:   ${JSON.stringify(message.slice(0, 80))}${message.length > 80 ? "…" : ""}`);

  if (dry) {
    console.log("Dry run — skipping upload");
    return;
  }

  if (!batchId) {
    throw new Error("BEE_BATCH_ID is not set in .env.local");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(batchId)) {
    throw new Error("BEE_BATCH_ID must be a 64-char hex string");
  }

  const bee = makeBee(beeUrl, password);

  try {
    const health = await bee.status.getHealth();
    console.log(`Node:      ${health.status} (version ${health.version})`);
  } catch (err) {
    console.warn(
      `Health check failed (gateway may not expose /health): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  const filename = "enscribe-smoke.txt";
  const data = new TextEncoder().encode(message);

  console.log("Uploading encrypted file…");
  let uploaded;
  try {
    uploaded = await bee.file.upload(batchId, data, filename, {
      contentType: "text/plain",
      encrypt,
      deferred: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Upload failed: ${msg}\n` +
        `Hint: public gateways (e.g. api.gateway.ethswarm.org) are usually download-only.\n` +
        `Point BEE_URL at your own Bee node (funded with xBZZ/xDAI) that owns BEE_BATCH_ID.\n` +
        `Docs: https://docs.ethswarm.org/docs/develop/upload-and-download/`,
    );
  }

  const reference = uploaded.reference.toHex();
  console.log(`Reference: ${reference}`);
  console.log(`Length:    ${reference.length} hex chars${encrypt ? " (includes decryption key)" : ""}`);

  console.log("Downloading / decrypting…");
  const downloaded = await bee.file.download(reference);
  const body = downloaded.data.toUtf8();

  if (body !== message) {
    throw new Error(
      `Round-trip mismatch.\n expected: ${JSON.stringify(message)}\n got:      ${JSON.stringify(body)}`,
    );
  }

  console.log("OK — uploaded, downloaded, and content matches.");
  console.log(`Gateway:   ${beeUrl}/bzz/${reference}/`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
