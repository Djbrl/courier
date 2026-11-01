/**
 * Prints a fresh private Ed25519 JWK for COURIER_SIGNING_KEY (for hosts that lose their files on restart).
 * Paste the output into the host's secret settings; never commit it.
 *   npx tsx scripts/gen-signing-key.ts
 */
import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const jwk = await exportJWK(privateKey);
jwk.kid = `courier-${Date.now().toString(36)}`;
console.log(JSON.stringify(jwk));
