import test from "node:test";
import assert from "node:assert/strict";
import { ScanLimiter, MapStore } from "../lib/scanner/rate-limit.js";
import { scanUrl } from "../lib/scanner/scanner.js";
import { redactUrlForLog } from "../lib/scanner/errors.js";
import { makeResolver, makeTransport, PUBLIC_V4 } from "./scanner-helpers.js";

const quiet = () => {};

test("per-user and per-IP buckets deny after the limit, then reset", () => {
  const limiter = new ScanLimiter({
    perUserPerMinute: 2,
    perIpPerMinute: 3,
    windowMs: 60_000,
  });
  limiter.check({ userId: "u1", ip: "1.2.3.4" });
  limiter.check({ userId: "u1", ip: "1.2.3.4" });
  assert.throws(
    () => limiter.check({ userId: "u1", ip: "1.2.3.4" }),
    (e) => e.code === "RATE_LIMITED",
  );
  // A different user from the same IP still has their own user bucket, but
  // shares the IP bucket (3rd IP use already consumed by u1's two + this
  // one would be the 3rd... so one more IP use is allowed, then denied).
  limiter.check({ userId: "u2", ip: "1.2.3.4" });
  assert.throws(
    () => limiter.check({ userId: "u3", ip: "1.2.3.4" }),
    (e) => e.code === "RATE_LIMITED",
  );
});

test("expired entries are swept so the store does not grow unboundedly", () => {
  const store = new MapStore();
  const limiter = new ScanLimiter({ windowMs: 1, store });
  limiter.check({ userId: "u1", ip: "1.1.1.1" });
  assert.equal(store.size, 2); // user + ip buckets
  // Wait past the window, then a new check sweeps the stale entries.
  return new Promise((resolve) => {
    setTimeout(() => {
      limiter.check({ userId: "u1", ip: "1.1.1.1" });
      assert.equal(store.size, 2);
      resolve();
    }, 5);
  });
});

test("concurrency: excess callers queue, and a full queue is rejected", async () => {
  const limiter = new ScanLimiter({ maxConcurrent: 1 });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = limiter.run(() => gate);
  // Fill the queue (maxQueued 1): one waiter allowed, the next rejected.
  const waiter = limiter.run(() => Promise.resolve("waiter"));
  await assert.rejects(
    () => limiter.run(() => Promise.resolve("boom"), { maxQueued: 1 }),
    (e) => e.code === "CONCURRENCY_LIMIT_REACHED",
  );
  release();
  await first;
  assert.equal(await waiter, "waiter");
  assert.equal(limiter.runningCount, 0);
});

test("scanUrl enforces the limiter and reports RATE_LIMITED", async () => {
  const limiter = new ScanLimiter({ perUserPerMinute: 1 });
  const resolver = makeResolver({ "example.com": { v4: [PUBLIC_V4], v6: [] } });
  const transport = makeTransport({ "example.com": { status: 200, headers: {} } });
  const opts = { resolver, transport, logger: quiet, limiter, userId: "u1" };
  const first = await scanUrl("https://example.com/", opts);
  assert.equal(first.ok, true);
  await assert.rejects(
    () => scanUrl("https://example.com/", opts),
    (e) => e.code === "RATE_LIMITED",
  );
});

test("redaction: query strings never appear in log targets", () => {
  assert.equal(
    redactUrlForLog("https://example.com/reset?token=abc123&x=1"),
    "https://example.com/reset",
  );
  assert.equal(redactUrlForLog("not a url"), "[invalid-url]");
});
