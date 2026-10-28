// Tool 10 chunked transfer validation (pure). Chunks are staged on disk
// by the service (never held only in memory as the job system), but
// sequence/completeness/integrity rules live here so tests exercise them
// without a database. Chunk bodies are never logged by any caller.
import { sha256Hex } from "./crypto.js";
import { BACKUP_LIMITS } from "./limits.js";
export class TransferValidator {
  constructor({ totalChunks, totalBytes, totalSha256, maxChunkBytes = BACKUP_LIMITS.maxChunkBytes } = {}) {
    this.totalChunks = totalChunks;
    this.totalBytes = totalBytes;
    this.totalSha256 = totalSha256;
    this.maxChunkBytes = maxChunkBytes;
    this.seen = new Map(); // sequence -> {bytes, sha256}
    this.errors = [];
  }
  addChunk(sequence, bytes, chunkSha256) {
    if (!Number.isInteger(sequence) || sequence < 0 || sequence >= this.totalChunks) return { ok: false, error: "INVALID_CHUNK_SEQUENCE" };
    if (this.seen.has(sequence)) return { ok: false, error: "DUPLICATE_CHUNK" };
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > this.maxChunkBytes) return { ok: false, error: "INVALID_CHUNK_SIZE" };
    if (sha256Hex(bytes) !== chunkSha256) return { ok: false, error: "CHUNK_CHECKSUM_MISMATCH" };
    this.seen.set(sequence, { bytes: bytes.length, sha256: chunkSha256 });
    return { ok: true };
  }
  get complete() {
    if (this.seen.size !== this.totalChunks) return { ok: false, error: "MISSING_CHUNKS", received: this.seen.size, expected: this.totalChunks };
    const receivedBytes = [...this.seen.values()].reduce((n, c) => n + c.bytes, 0);
    if (receivedBytes !== this.totalBytes) return { ok: false, error: "TOTAL_SIZE_MISMATCH", received: receivedBytes, expected: this.totalBytes };
    return { ok: true };
  }
  verifyTotal(concatenated) {
    if (sha256Hex(concatenated) !== this.totalSha256) return { ok: false, error: "ARCHIVE_CHECKSUM_MISMATCH" };
    return { ok: true };
  }
}
