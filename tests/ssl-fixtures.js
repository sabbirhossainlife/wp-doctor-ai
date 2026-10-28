// Tool 06 test fixtures (tests only, never production config).
// Generates a test CA + server certificates with openssl (available in
// this VM, OpenSSL 3.0.13) in a temp dir, and serves them from local
// TLS/HTTP servers. Expired and not-yet-valid certificates are made
// with `openssl ca -startdate/-enddate` (openssl x509 -req has no
// date override in this build). The test CA is passed to the code under
// test ONLY as an in-process parameter; nothing here touches production
// trust settings, and the temp dir is removed after the run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import net from "node:net";

function run(dir, args) {
  execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
}

export function generateSslFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), "wpdoctor-ssl-"));
  // Test CA.
  run(dir, ["req", "-x509", "-newkey", "rsa:2048", "-keyout", "ca.key", "-out", "ca.crt", "-days", "3650", "-nodes", "-subj", "/CN=WP Doctor Test CA"]);
  const caCert = readFileSync(path.join(dir, "ca.crt"), "utf8");

  function caConfig(san) {
    return [
      "[ ca ]", "default_ca = myca",
      "[ myca ]", "dir = .", "database = $dir/index.txt", "unique_subject = no",
      "new_certs_dir = $dir", "serial = $dir/serial", "private_key = $dir/ca.key",
      "certificate = $dir/ca.crt", "default_md = sha256", "default_days = 365",
      "policy = pol", "copy_extensions = copy",
      "[ pol ]", "commonName = supplied",
      "[ req_ext ]", `subjectAltName = ${san}`,
      "",
    ].join("\n");
  }
  writeFileSync(path.join(dir, "index.txt"), "");
  writeFileSync(path.join(dir, "serial"), "1000\n");

  // sign(name, cn, san, {startdate, enddate}) via openssl ca.
  function sign(name, cn, san, dates = {}) {
    run(dir, ["req", "-newkey", "rsa:2048", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-nodes", "-subj", `/CN=${cn}`]);
    writeFileSync(path.join(dir, "ca.cnf"), caConfig(san));
    const args = ["ca", "-batch", "-config", "ca.cnf", "-in", `${name}.csr`, "-out", `${name}.crt`, "-extensions", "req_ext"];
    if (dates.startdate) args.push("-startdate", dates.startdate);
    if (dates.enddate) args.push("-enddate", dates.enddate);
    run(dir, args);
    return {
      key: readFileSync(path.join(dir, `${name}.key`), "utf8"),
      cert: readFileSync(path.join(dir, `${name}.crt`), "utf8"),
    };
  }

  const valid = sign("valid", "valid.example.test", "DNS:valid.example.test");
  const expired = sign("expired", "valid.example.test", "DNS:valid.example.test", {
    startdate: "20200101000000Z", enddate: "20210101000000Z",
  });
  const notYetValid = sign("future", "future.example.test", "DNS:future.example.test", {
    startdate: "20300101000000Z", enddate: "20310101000000Z",
  });
  const mismatch = sign("mismatch", "other.example.test", "DNS:other.example.test");
  // Self-signed (no CA chain at all).
  run(dir, ["req", "-x509", "-newkey", "rsa:2048", "-keyout", "self.key", "-out", "self.crt", "-days", "365", "-nodes", "-subj", "/CN=valid.example.test", "-addext", "subjectAltName=DNS:valid.example.test"]);
  const selfSigned = {
    key: readFileSync(path.join(dir, "self.key"), "utf8"),
    cert: readFileSync(path.join(dir, "self.crt"), "utf8"),
  };
  return {
    dir,
    caCert,
    valid,
    expired,
    notYetValid,
    mismatch,
    selfSigned,
    cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

export function listenAsync(server, port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

// Track accepted sockets so teardown can destroy them explicitly: a
// silent peer's accepted socket otherwise keeps server.close() waiting
// forever while the event loop has already emptied (Node then reports
// the awaiting test as cancelled). The fallback timer guarantees
// teardown never hangs a test run.
function trackServer(server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.__destroyTracked = () => {
    for (const socket of sockets) {
      try { socket.destroy(); } catch { /* ignore */ }
    }
    sockets.clear();
  };
  return server;
}

export function closeAsync(server) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const fallback = setTimeout(finish, 2000);
    try {
      if (typeof server.__destroyTracked === "function") server.__destroyTracked();
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close(() => { clearTimeout(fallback); finish(); });
    } catch { clearTimeout(fallback); finish(); }
  });
}

export function startHttps(port, { key, cert }, handler) {
  const server = trackServer(https.createServer({ key, cert }, handler));
  return listenAsync(server, port).then(() => server);
}

export function startHttp(port, handler) {
  const server = trackServer(http.createServer(handler));
  return listenAsync(server, port).then(() => server);
}

// Accepts connections but never responds (for timeout fixtures).
export function startSilent(port) {
  const server = trackServer(net.createServer(() => {}));
  return listenAsync(server, port).then(() => server);
}
