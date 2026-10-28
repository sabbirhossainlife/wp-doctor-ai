"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteWebsiteButton({ websiteId }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/websites/${websiteId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Could not delete this website. Try again.");
      setArmed(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={onDelete} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50">
        {busy ? "Deleting…" : armed ? "Click again to confirm deletion" : "Delete website"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
