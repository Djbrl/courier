import fs from "node:fs";
import path from "node:path";
import { config } from "@courier/shared";
import { type CryptoKey, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";

/**
 * Courier's token-signing key (Ed25519). Generated on first run and stored in DATA_DIR,
 * or provided via COURIER_SIGNING_KEY (a private JWK as JSON) in production.
 */

const KEY_FILE = path.join(config.dataDir, "courier-signing-key.json");

interface KeyMaterial {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

let material: Promise<KeyMaterial> | null = null;

async function load(): Promise<KeyMaterial> {
  let privateJwk: JWK | null = null;
  if (process.env.COURIER_SIGNING_KEY) {
    privateJwk = JSON.parse(process.env.COURIER_SIGNING_KEY) as JWK;
  } else if (fs.existsSync(KEY_FILE)) {
    privateJwk = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as JWK;
  }
  if (!privateJwk) {
    const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    privateJwk = await exportJWK(privateKey);
    privateJwk.kid = `courier-${Date.now().toString(36)}`;
    fs.writeFileSync(KEY_FILE, JSON.stringify(privateJwk), { mode: 0o600 });
  }
  const kid = privateJwk.kid ?? "courier-default";
  const privateKey = (await importJWK({ ...privateJwk, alg: "EdDSA" }, "EdDSA")) as CryptoKey;
  const { d: _d, ...publicJwk } = privateJwk;
  return { kid, privateKey, publicJwk: { ...publicJwk, kid, alg: "EdDSA", use: "sig" } };
}

export function signingKey(): Promise<KeyMaterial> {
  material ??= load();
  return material;
}

export async function jwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await signingKey();
  return { keys: [publicJwk] };
}
