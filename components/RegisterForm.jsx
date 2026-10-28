"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "../lib/auth-client";
import { normalizeEmail, validatePassword } from "../lib/websites";

export default function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = "Enter your name.";
    const cleanEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      nextErrors.email = "Enter a valid email address.";
    const pwError = validatePassword(password);
    if (pwError) nextErrors.password = pwError;
    if (password !== confirm)
      nextErrors.confirm = "Passwords do not match.";
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    try {
      // NOTE: no role is sent. The server assigns USER by default and the
      // auth config rejects client-supplied role values.
      const { error } = await signUp.email({
        name: name.trim(),
        email: cleanEmail,
        password,
      });
      if (error) {
        setFormError(
          /already|exists/i.test(error.message || "")
            ? "An account with this email already exists. Try signing in instead."
            : "Registration failed. Check your details and try again."
        );
        setSubmitting(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setFormError("Registration failed. Try again.");
      setSubmitting(false);
    }
  }

  const field =
    "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200";
  return (
    <form onSubmit={onSubmit} noValidate aria-describedby="register-error">
      <div>
        <label className="text-sm font-medium" htmlFor="reg-name">Name</label>
        <input id="reg-name" className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        {errors.name && <p className="mt-1 text-sm text-red-700" role="alert">{errors.name}</p>}
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="reg-email">Email</label>
        <input id="reg-email" className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        {errors.email && <p className="mt-1 text-sm text-red-700" role="alert">{errors.email}</p>}
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="reg-password">Password</label>
        <input id="reg-password" className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        <p className="mt-1 text-sm text-slate-500">At least 8 characters.</p>
        {errors.password && <p className="mt-1 text-sm text-red-700" role="alert">{errors.password}</p>}
      </div>
      <div className="mt-4">
        <label className="text-sm font-medium" htmlFor="reg-confirm">Confirm password</label>
        <input id="reg-confirm" className={field} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        {errors.confirm && <p className="mt-1 text-sm text-red-700" role="alert">{errors.confirm}</p>}
      </div>
      {formError && <p id="register-error" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{formError}</p>}
      <button type="submit" disabled={submitting} className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50">
        {submitting ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
