"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "../lib/auth-client";

export default function LogoutButton({ className }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (busy) return;
    setBusy(true);
    await signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className ?? "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"}>
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
