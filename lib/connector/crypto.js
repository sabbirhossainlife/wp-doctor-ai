import { randomBytes, createHash } from "node:crypto";

// Pairing code: 20 random bytes = 160 bits of entropy, rendered as
// exactly 32 base32 characters (RFC 4648 alphabet, lowercase).
// 160 bits >> 128-bit minimum: guessing is infeasible within the
// 10-minute expiry, and the code is hashed at rest anyway.
const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function generatePairingCode() {
  const bytes = randomBytes(20);
  const bits = [...bytes].map((b) => b.toString(2).padStart(8, "0")).join("");
  let code = "";
  for (let i = 0; i < 32; i++) {
    code += CODE_ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  }
  return code;
}

// Connector credential: 32 random bytes = 256 bits, base64url.
// Stored only as a SHA-256 hash: with 160+/256-bit entropy, a hash
// is a suitable one-way representation (no salt needed for
// unguessable random tokens; the hash is not a password hash).
export function generateConnectorCredential() {
  return randomBytes(32)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function hashSecret(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
