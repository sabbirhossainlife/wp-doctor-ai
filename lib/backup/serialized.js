// Tool 10 serialization-aware URL rewriting (Buffer-based: PHP
// serialized string lengths are BYTE counts, so JS character indexing
// would corrupt multibyte content). NEVER a naive global text
// replacement: inside PHP serialized data only string values
// (s:N:"...";" ) are rewritten, with every length recomputed in bytes,
// and arrays/ints/bools/nulls preserved structurally. Object payloads
// (O:...), references (R/r:...), and malformed segments are NOT
// rewritten: they are reported as unsupported and copied verbatim,
// never corrupted. Plain-text occurrences of the source URL outside
// serialized segments ARE rewritten (no length prefix to corrupt);
// serialized string contents are consumed wholesale by the parser, so
// a plain-text replacement can never land inside a serialized string.
function parseValue(buf, i, fromUrl, toUrl, state) {
  const type = String.fromCharCode(buf[i]);
  if (type === "s") {
    const head = buf.subarray(i, Math.min(buf.length, i + 64)).toString("ascii");
    const m = /^s:(\d+):"/.exec(head);
    if (!m) { state.unsupported.push("MALFORMED_STRING"); return { text: buf.subarray(i).toString("utf8"), next: buf.length }; }
    const len = Number(m[1]);
    const start = i + m[0].length;
    if (start + len + 2 > buf.length || buf[start + len] !== 0x22 || buf[start + len + 1] !== 0x3b) {
      state.unsupported.push("MALFORMED_STRING"); return { text: buf.subarray(i).toString("utf8"), next: buf.length };
    }
    const raw = buf.subarray(start, start + len).toString("utf8");
    let value = raw;
    if (raw.includes(fromUrl)) { value = raw.split(fromUrl).join(toUrl); state.replaced += 1; }
    const bytes = Buffer.byteLength(value, "utf8");
    return { text: `s:${bytes}:"${value}";`, next: start + len + 2 };
  }
  if (type === "a") {
    const head = buf.subarray(i, Math.min(buf.length, i + 64)).toString("ascii");
    const m = /^a:(\d+):\{/.exec(head);
    if (!m) { state.unsupported.push("MALFORMED_ARRAY"); return { text: buf.subarray(i).toString("utf8"), next: buf.length }; }
    let pos = i + m[0].length;
    let out = `a:${m[1]}:{`;
    for (let k = 0; k < Number(m[1]); k += 1) { // one iteration parses a key AND its value
      const key = parseValue(buf, pos, fromUrl, toUrl, state); out += key.text; pos = key.next;
      const val = parseValue(buf, pos, fromUrl, toUrl, state); out += val.text; pos = val.next;
    }
    if (buf[pos] !== 0x7d) { state.unsupported.push("MALFORMED_ARRAY"); return { text: buf.subarray(i).toString("utf8"), next: buf.length }; }
    return { text: out + "}", next: pos + 1 };
  }
  if (type === "i" || type === "b" || type === "d") {
    const head = buf.subarray(i, Math.min(buf.length, i + 128)).toString("ascii");
    const m = /^[ibd]:[^;]*;/.exec(head);
    if (!m) { state.unsupported.push("MALFORMED_SCALAR"); return { text: buf.subarray(i).toString("utf8"), next: buf.length }; }
    return { text: m[0], next: i + m[0].length };
  }
  if (type === "N" && buf[i + 1] === 0x3b) return { text: "N;", next: i + 2 };
  if (type === "O") {
    // Object payload: consume the whole balanced block (header + count
    // key/value pairs, parsed with a shadow state so nested rewrites are
    // discarded) and copy it VERBATIM. Never rewrite inside an object.
    state.unsupported.push("UNSUPPORTED_SERIALIZED_TYPE_O");
    const head = buf.subarray(i, Math.min(buf.length, i + 128)).toString("ascii");
    const m = /^O:\d+:"[^"]*":(\d+):\{/.exec(head);
    if (!m) return { text: buf.subarray(i).toString("utf8"), next: buf.length };
    let pos = i + m[0].length;
    const shadow = { replaced: 0, unsupported: [] };
    for (let k = 0; k < Number(m[1]); k += 1) {
      const key = parseValue(buf, pos, fromUrl, toUrl, shadow); pos = key.next;
      const val = parseValue(buf, pos, fromUrl, toUrl, shadow); pos = val.next;
    }
    if (buf[pos] !== 0x7d) return { text: buf.subarray(i).toString("utf8"), next: buf.length };
    return { text: buf.subarray(i, pos + 1).toString("utf8"), next: pos + 1 };
  }
  if (type === "R" || type === "r" || type === "C") {
    state.unsupported.push(`UNSUPPORTED_SERIALIZED_TYPE_${type}`);
    // Opaque reference/custom-serialized data: copy the rest of this
    // document verbatim rather than risk corrupting it.
    return { text: buf.subarray(i).toString("utf8"), next: buf.length };
  }
  return { text: buf.subarray(i, i + 1).toString("utf8"), next: i + 1 };
}
const SERIAL_START = /^(?:s:\d+:"|a:\d+:\{|i:[^;]*;|b:[01];|d:[^;]*;|N;|O:\d+:"|C:\d+:"|R:\d+;|r:\d+;)/;
export function rewriteSerializedText(input, fromUrl, toUrl) {
  if (typeof input !== "string" || !fromUrl || !toUrl || fromUrl === toUrl) {
    return { text: input, replaced: 0, unsupported: fromUrl === toUrl ? ["SOURCE_EQUALS_DESTINATION"] : [] };
  }
  const buf = Buffer.from(input, "utf8");
  const state = { replaced: 0, unsupported: [] };
  let out = "";
  let i = 0;
  while (i < buf.length) {
    const rest = buf.subarray(i).toString("utf8");
    if (SERIAL_START.test(rest)) {
      const parsed = parseValue(buf, i, fromUrl, toUrl, state);
      out += parsed.text; i = parsed.next;
    } else if (rest.startsWith(fromUrl)) {
      out += toUrl; i += Buffer.byteLength(fromUrl, "utf8"); state.replaced += 1;
    } else {
      // Copy one Unicode code point (not one byte) to stay aligned.
      const ch = String.fromCodePoint(rest.codePointAt(0));
      out += ch; i += Buffer.byteLength(ch, "utf8");
    }
  }
  return { text: out, replaced: state.replaced, unsupported: [...new Set(state.unsupported)] };
}
