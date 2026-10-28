// Tool 10 minimal ZIP central-directory reader (no dependency, no
// extraction). Used only to validate an uploaded archive's entry list
// (paths, sizes, symlink flags) BEFORE it is trusted as a backup.
// Extraction itself is never performed by this milestone.
export function parseZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return { ok: false, error: "NOT_A_ZIP" };
  // Find End Of Central Directory (search last 64 KiB + 22 bytes).
  const searchStart = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return { ok: false, error: "NOT_A_ZIP" };
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return { ok: false, error: "ZIP_DIRECTORY_CORRUPT" };
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const externalAttrs = buffer.readUInt32LE(offset + 38);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    const unixMode = externalAttrs >>> 16;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    const isDirectory = name.endsWith("/");
    entries.push({ path: name, size, compressedSize, method, symlink: isSymlink, special: isSymlink, directory: isDirectory });
    offset += 46 + nameLen + extraLen + commentLen;
    if (entries.length > 100000) return { ok: false, error: "ZIP_TOO_MANY_ENTRIES" };
  }
  return { ok: true, entries: entries.filter((e) => !e.directory) };
}
