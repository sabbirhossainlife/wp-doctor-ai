"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";

const SYMPTOM_OPTIONS = [
  ["NO_PAYMENT_METHODS", "No payment methods shown at checkout"],
  ["CHECKOUT_PAGE_MISSING", "Checkout page missing or not found"],
  ["CHECKOUT_FAILS_TO_LOAD", "Checkout fails to load"],
  ["CHECKOUT_STUCK_LOADING", "Checkout stuck loading"],
  ["PAYMENT_INIT_ERROR", "Payment cannot start (init error)"],
  ["PAYMENT_DECLINED_OR_FAILED", "Payment declined or failed"],
  ["ORDER_PENDING", "Order stays pending after payment"],
  ["ORDER_NOT_CREATED", "Order not created after checkout"],
  ["SHIPPING_OR_TAX", "Shipping or tax problem at checkout"],
  ["BLOCK_COMPAT_SUSPECTED", "Suspected Checkout block incompatibility"],
  ["AFTER_UPDATE", "Problem appeared after an update"],
  ["OTHER", "Other"],
  ["UNKNOWN", "Not sure"],
];

// websites: [{ id, name, normalizedUrl, connectionStatus, snapshotStatus,
// snapshotReceivedAt }] — server-computed, no secrets. The form reviews the
// stored snapshot before running: a stale/missing snapshot blocks the run
// with re-sync instructions instead of running on old data. This tool is
// read-only: it never runs a payment, changes an order, or modifies the site.
export default function WooCommerceCheckerForm({ websites }) {
  const router = useRouter();
  const [websiteId, setWebsiteId] = useState(websites[0]?.id ?? "");
  const [category, setCategory] = useState("UNKNOWN");
  const [description, setDescription] = useState("");
  const [checkoutType, setCheckoutType] = useState("UNKNOWN");
  const [affectedScope, setAffectedScope] = useState("UNKNOWN");
  const [startedAt, setStartedAt] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const selected = websites.find((w) => w.id === websiteId) ?? null;

  async function loadSnapshot(id) {
    setSnapshot(null);
    if (!id) return;
    setSnapshotLoading(true);
    try {
      const res = await fetch(`/api/woocommerce-diagnostics/snapshot?websiteId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSnapshot(data);
    } catch {
      // Snapshot preview is advisory; the run itself re-checks freshness.
    } finally {
      setSnapshotLoading(false);
    }
  }

  function onSelectWebsite(id) {
    setWebsiteId(id);
    setError("");
    loadSnapshot(id);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (running) return; // duplicate-submit prevention
    setError("");
    setFieldErrors({});
    if (!websiteId) {
      setError("Choose a website first.");
      return;
    }
    if (!description.trim()) {
      setFieldErrors({ symptomDescription: "Describe the symptom." });
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/woocommerce-diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteId,
          symptomCategory: category,
          symptomDescription: description,
          checkoutType,
          affectedScope,
          startedAt: startedAt || null,
          errorExcerpt: excerpt || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422) {
        setError(`${data.error || "The snapshot is not usable."} ${data.resyncInstructions || ""}`);
        return;
      }
      if (res.status === 429) {
        setError(data.error || "Too many WooCommerce diagnostics. Please try again later.");
        return;
      }
      if (!res.ok) {
        if (data.errors) setFieldErrors(data.errors);
        else setError(data.error || "Could not complete the WooCommerce diagnostic.");
        return;
      }
      router.push(`/tools/woocommerce-checkout-checker/${data.diagnostic.id}`);
    } catch {
      setError("Could not complete the WooCommerce diagnostic. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  if (websites.length === 0) {
    return (
      <p className="text-slate-700">
        No websites yet. Add a website from the{" "}
        <a className="font-medium text-blue-700 underline" href="/dashboard">dashboard</a>{" "}
        and pair it with the connector plugin first.
      </p>
    );
  }

  const woo = snapshot?.snapshot?.woocommerce ?? null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div>
        <label className="text-sm font-medium" htmlFor="woo-website">Step 1 — Website</label>
        <select
          id="woo-website"
          className={field}
          value={websiteId}
          onChange={(e) => onSelectWebsite(e.target.value)}
        >
          {websites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} — {w.normalizedUrl} ({w.connectionStatus})
            </option>
          ))}
        </select>
        {selected && (
          <p className="mt-2 text-sm text-slate-600">
            Connection: {selected.connectionStatus} · Snapshot: {selected.snapshotStatus}
            {selected.snapshotReceivedAt ? ` · Synced ${new Date(selected.snapshotReceivedAt).toLocaleString()}` : ""}
          </p>
        )}
      </div>

      <div className="mt-5">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
          onClick={() => loadSnapshot(websiteId)}
          disabled={snapshotLoading}
        >
          {snapshotLoading ? "Loading snapshot…" : "Step 2 — Review stored snapshot"}
        </button>
        {snapshot && snapshot.snapshot && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p>Snapshot schema v{snapshot.snapshot.schemaVersion} · WordPress {snapshot.snapshot.wordpressVersion ?? "unknown"} · PHP {snapshot.snapshot.phpVersion ?? "unknown"}</p>
            {woo ? (
              <>
                <p className="mt-1">WooCommerce: {woo.status} {woo.version ? `(version ${woo.version})` : "(version unknown)"}</p>
                {woo.pages && (
                  <p className="mt-1">
                    Pages — Cart: {woo.pages.cart?.pageId ?? "not assigned"} ({woo.pages.cart?.status ?? "unknown"}, {woo.pages.cart?.implementation ?? "unknown"});
                    Checkout: {woo.pages.checkout?.pageId ?? "not assigned"} ({woo.pages.checkout?.status ?? "unknown"}, {woo.pages.checkout?.implementation ?? "unknown"});
                    My Account: {woo.pages.myAccount?.pageId ?? "not assigned"} ({woo.pages.myAccount?.status ?? "unknown"}, {woo.pages.myAccount?.implementation ?? "unknown"})
                  </p>
                )}
                <p className="mt-1">
                  Gateways: {Array.isArray(woo.gateways) && woo.gateways.length > 0
                    ? woo.gateways.map((g) => `${g.title} (${g.enabled ? "enabled" : "disabled"}, block: ${g.blockCompatibility})`).join("; ")
                    : "none registered"}
                </p>
              </>
            ) : (
              <p className="mt-1">WooCommerce data: not present in this snapshot (schema predates Tool 03). Update the connector plugin to 1.2.0+ and re-sync for a full check.</p>
            )}
            <p className="mt-1 text-slate-500">Snapshot status: {snapshot.snapshotStatus}. This preview shows configuration only — no orders, customers, or payment data are ever shown.</p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="woo-category">Step 3 — What is happening?</label>
        <select id="woo-category" className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          {SYMPTOM_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="woo-description">Describe the symptom</label>
        <textarea
          id="woo-description"
          className={field}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happens at checkout, and at which step?"
        />
        {fieldErrors.symptomDescription && <p role="alert" className="mt-1 text-sm text-red-700">{fieldErrors.symptomDescription}</p>}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-3">
        <div>
          <label className="text-sm font-medium" htmlFor="woo-checkout-type">Checkout type (if known)</label>
          <select id="woo-checkout-type" className={field} value={checkoutType} onChange={(e) => setCheckoutType(e.target.value)}>
            <option value="UNKNOWN">Not sure</option>
            <option value="BLOCK">Checkout block</option>
            <option value="CLASSIC">Classic shortcode</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="woo-scope">Gateways affected</label>
          <select id="woo-scope" className={field} value={affectedScope} onChange={(e) => setAffectedScope(e.target.value)}>
            <option value="UNKNOWN">Not sure</option>
            <option value="ONE">One gateway</option>
            <option value="MULTIPLE">Multiple gateways</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="woo-started">When did it start? (optional)</label>
          <input id="woo-started" className={field} type="text" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} placeholder="e.g. after the 12 Oct update" />
        </div>
      </div>

      <div className="mt-5">
        <label className="text-sm font-medium" htmlFor="woo-excerpt">Error message (optional, redacted excerpt)</label>
        <textarea
          id="woo-excerpt"
          className={field}
          rows={3}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Paste only the customer-facing error message."
        />
        <p className="mt-1 text-sm text-amber-800">
          Warning: never paste card numbers, passwords, API keys, secrets, customer
          emails, or full addresses here. The excerpt is treated as untrusted text
          and obvious secret patterns are redacted before storage.
        </p>
        {fieldErrors.errorExcerpt && <p role="alert" className="mt-1 text-sm text-red-700">{fieldErrors.errorExcerpt}</p>}
      </div>

      <p className="mt-5 text-sm text-slate-600">
        The live site is not modified: nothing is enabled, switched, refunded, or
        paid. No live payment test is run. Safe next steps are described for you
        to perform manually.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={running}
        className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Checking…" : "Run WooCommerce checkout check"}
      </button>
    </form>
  );
}
