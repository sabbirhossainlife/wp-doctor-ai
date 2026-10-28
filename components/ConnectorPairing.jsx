"use client";

import { useState } from "react";

// Pairing UI for one website. The pairing code is shown ONCE after
// generation and is never fetched again; the connector credential is
// never shown anywhere in the dashboard.
export default function ConnectorPairing({ websiteId, connectionId, connectionStatus }) {
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);

  async function generate() {
    setGenerating(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/connector/pairing-intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ websiteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create a pairing code. Try again.");
        return;
      }
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch {
      setError("Could not create a pairing code. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function revoke() {
    if (!connectionId) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(`/api/connector/connections/${connectionId}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Could not revoke the connection. Try again.");
        return;
      }
      setRevoked(true);
      window.location.reload();
    } catch {
      setError("Could not revoke the connection. Try again.");
    } finally {
      setRevoking(false);
    }
  }

  const connected = connectionStatus === "CONNECTED" && !revoked;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold">WordPress connector</h2>
      <p className="mt-2 text-slate-600">
        {connected
          ? "This website is connected to the WP Doctor AI Connector plugin."
          : "This website is not connected yet. Install the WP Doctor AI Connector plugin on your WordPress site, then pair it with a one-time code below."}
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {!connected ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate pairing code"}
          </button>
          {code ? (
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                Enter this code in the plugin&apos;s settings page. It expires{" "}
                {expiresAt ? new Date(expiresAt).toLocaleString() : "in 10 minutes"} and
                can be used only once. It will not be shown again.
              </p>
              <p className="mt-2 font-mono text-lg font-semibold tracking-wide">{code}</p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium"
              >
                {copied ? "Copied" : "Copy code"}
              </button>
              <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>Install and activate the WP Doctor AI Connector plugin on your WordPress site.</li>
                <li>Open the plugin&apos;s settings page (administrators only).</li>
                <li>Tick the consent checkbox, paste the code above, and submit.</li>
              </ol>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={revoke}
            disabled={revoking}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
          >
            {revoking ? "Revoking…" : "Revoke connection"}
          </button>
          <p className="mt-2 text-sm text-slate-500">
            Revoking immediately invalidates the plugin&apos;s credential. Re-pairing will
            generate a new credential.
          </p>
        </div>
      )}
    </div>
  );
}
