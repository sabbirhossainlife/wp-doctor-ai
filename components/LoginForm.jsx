"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "../lib/auth-client";
import { normalizeEmail } from "../lib/websites";

function safeNext(value) {
  // Open-redirect guard: only same-site relative paths, never //host or scheme.
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/dashboard";
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setFormError("");
    setSubmitting(true);
    try {
      const { error } = await signIn.email({
        email: normalizeEmail(email),
        password,
      });
      if (error) {
        // Deliberately generic: do not reveal whether the email exists.
        setFormError("Email or password is incorrect.");
        setSubmitting(false);
        return;
      }
      router.push(safeNext(searchParams.get("next")));
      router.refresh();
    } catch {
      setFormError("Sign-in failed. Try again.");
      setSubmitting(false);
    }
  }

  const field =
    "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";
  return (
    <form onSubmit={onSubmit} noValidate aria-describedby="login-error">
      <div>
        <label className="text-sm font-medium" htmlFor="login-email">Email</label>
        <input id="login-email" className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="login-password">Password</label>
        <input id="login-password" className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>
      {formError && <p id="login-error" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{formError}</p>}
      <button type="submit" disabled={submitting} className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50">
        {submitting ? "Signing you in…" : "Sign in"}
      </button>
      <p className="mt-4 text-sm text-slate-600">
        Password reset by email is not available yet — no email provider is
        configured. See the README for the plan.
      </p>
    </form>
  );
}
