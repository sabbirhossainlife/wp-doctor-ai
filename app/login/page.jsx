import { Suspense } from "react";
import PageContainer from "../../components/PageContainer";
import LoginForm from "../../components/LoginForm";
import { getCurrentUser } from "../../lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">Sign in</h1>
        <p className="mt-2 text-slate-600">
          No account yet?{" "}
          <a className="font-medium text-blue-700 underline" href="/register">Create one</a>.
        </p>
        <div className="mt-8 max-w-md rounded-xl border border-slate-200 bg-white p-6">
          <Suspense fallback={<p>Loading…</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </PageContainer>
  );
}
