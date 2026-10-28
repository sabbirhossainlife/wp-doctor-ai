import { notFound, redirect } from "next/navigation";
import PageContainer from "../../../../components/PageContainer";
import WooCommerceAiSection from "../../../../components/WooCommerceAiSection";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";
import { getAiConfig, isAiConfigured } from "../../../../lib/ai/analyze";
import { publicWooAnalysis } from "../../../../lib/woocommerce/ai";

const SEVERITY_STYLE = {
  LOW: "bg-slate-100 text-slate-800 border-slate-200",
  MEDIUM: "bg-amber-50 text-amber-800 border-amber-200",
  HIGH: "bg-red-50 text-red-800 border-red-200",
};

function categoryLabel(value) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export default async function WooCommerceReportPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  // Ownership enforced in the query: another user's report simply does not match.
  const diagnostic = await prisma.wooCommerceDiagnostic.findFirst({
    where: { id, userId: user.id },
    include: { website: true, findings: { orderBy: { createdAt: "asc" } } },
  });
  if (!diagnostic) notFound();
  const aiRow = await prisma.wooCommerceAiAnalysis.findUnique({ where: { diagnosticId: diagnostic.id } });
  const aiAnalysis = publicWooAnalysis(aiRow);
  const aiConfigured = isAiConfigured(getAiConfig());
  const payload = diagnostic.snapshotPayload && typeof diagnostic.snapshotPayload === "object" ? diagnostic.snapshotPayload : {};
  const woo = payload.woocommerce && typeof payload.woocommerce === "object" ? payload.woocommerce : null;

  return (
    <PageContainer>
      <main className="py-12">
        <h1 className="text-3xl font-bold">WooCommerce checkout report</h1>
        <dl className="mt-6 space-y-2 text-sm text-slate-700">
          <div className="flex gap-2"><dt className="font-semibold">Website:</dt><dd>{diagnostic.website?.name} — {diagnostic.website?.normalizedUrl}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Symptom:</dt><dd>{categoryLabel(diagnostic.symptomCategory)}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Description:</dt><dd>{diagnostic.symptomDescription}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Checkout type (reported):</dt><dd>{diagnostic.checkoutType}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Gateways affected (reported):</dt><dd>{diagnostic.affectedScope}</dd></div>
          {diagnostic.startedAt && (<div className="flex gap-2"><dt className="font-semibold">Started:</dt><dd>{diagnostic.startedAt}</dd></div>)}
          {diagnostic.errorExcerpt && (<div className="flex gap-2"><dt className="font-semibold">Error excerpt (user-supplied, untrusted):</dt><dd>{diagnostic.errorExcerpt}</dd></div>)}
          <div className="flex gap-2"><dt className="font-semibold">WordPress:</dt><dd>{payload.wordpressVersion ?? "unknown"}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">PHP:</dt><dd>{payload.phpVersion ?? "unknown"}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">WooCommerce:</dt><dd>{woo ? `${woo.status}${woo.version ? `, version ${woo.version}` : ", version unknown"}` : "not present in this snapshot (legacy)"}</dd></div>
          {woo?.pages && (
            <div className="flex gap-2"><dt className="font-semibold">Pages:</dt><dd>
              Cart {woo.pages.cart?.pageId ?? "not assigned"} ({woo.pages.cart?.status ?? "unknown"}, {woo.pages.cart?.implementation ?? "unknown"}) ·{" "}
              Checkout {woo.pages.checkout?.pageId ?? "not assigned"} ({woo.pages.checkout?.status ?? "unknown"}, {woo.pages.checkout?.implementation ?? "unknown"}) ·{" "}
              My Account {woo.pages.myAccount?.pageId ?? "not assigned"} ({woo.pages.myAccount?.status ?? "unknown"}, {woo.pages.myAccount?.implementation ?? "unknown"})
            </dd></div>
          )}
          {Array.isArray(woo?.gateways) && (
            <div className="flex gap-2"><dt className="font-semibold">Gateways:</dt><dd>
              {woo.gateways.length === 0 ? "none registered" : woo.gateways.map((g) => `${g.title} (${g.enabled ? "enabled" : "disabled"}, block: ${g.blockCompatibility})`).join("; ")}
            </dd></div>
          )}
          <div className="flex gap-2"><dt className="font-semibold">Snapshot:</dt><dd>v{diagnostic.snapshotSchemaVersion}, received {new Date(diagnostic.snapshotReceivedAt).toLocaleString()}</dd></div>
          <div className="flex gap-2"><dt className="font-semibold">Checked:</dt><dd>{new Date(diagnostic.createdAt).toLocaleString()}</dd></div>
        </dl>

        <section className="mt-10" aria-labelledby="woo-findings-heading">
          <h2 id="woo-findings-heading" className="text-2xl font-semibold">Deterministic findings</h2>
          <p className="mt-2 text-sm text-slate-600">
            These findings come only from the snapshot and the rules. An enabled
            gateway does not prove a payment will succeed, and a configured
            checkout page does not prove a real checkout works. No finding is
            based on orders, transactions, credentials, or logs, which are not
            collected — so no payment outcome is claimed anywhere in this report.
          </p>
          {diagnostic.findings.length === 0 ? (
            <p className="mt-4 text-slate-600">No findings were recorded for this check. That means the checked configuration items matched — it is not a guarantee that a real checkout will succeed.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {diagnostic.findings.map((f) => (
                <li key={f.id} className={`rounded-xl border p-5 ${SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.LOW}`}>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm">Rule {f.ruleId} · {f.category} · Severity: {f.severity} · Status: {f.status} · Confidence: {f.confidence}</p>
                  <p className="mt-2 text-sm">{f.description}</p>
                  {f.referencedItems && Array.isArray(f.referencedItems) && f.referencedItems.length > 0 && (
                    <p className="mt-2 text-sm">
                      <strong>Items:</strong>{" "}
                      {f.referencedItems.map((it) => `${it.kind}: ${it.name ?? it.slug ?? "unknown"}`).join("; ")}
                    </p>
                  )}
                  {f.requiredAdditionalEvidence && (
                    <p className="mt-2 text-sm"><strong>Still needed:</strong> {f.requiredAdditionalEvidence}</p>
                  )}
                  {f.recommendation && (
                    <p className="mt-2 text-sm"><strong>Recommended next step:</strong> {f.recommendation}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <WooCommerceAiSection diagnosticId={diagnostic.id} initialAnalysis={aiAnalysis} aiConfigured={aiConfigured} />

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="safe-steps-heading">
          <h2 id="safe-steps-heading" className="text-lg font-semibold">Safe next steps (manual only — nothing here is executed by this app)</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Back up the site (files + database) before changing anything.</li>
            <li>Review page assignments in WooCommerce settings: each of Cart, Checkout, and My Account should be a different published page.</li>
            <li>Check the gateway provider&apos;s documentation for Checkout block support before changing the checkout implementation; never switch checkout types on the live site without a staging test.</li>
            <li>Test checkout on a staging copy first, not on the live site — this app never runs a live payment test.</li>
            <li>For pending or failed payments, authorized manual investigation only: with merchant access, check the transaction status in the payment provider&apos;s dashboard and the order record in WooCommerce. This app does not inspect orders or change them.</li>
            <li>Note the exact checkout step and the exact customer-facing message for an expert, if the issue persists.</li>
          </ul>
          <p className="mt-3 text-sm font-medium text-amber-800">
            Risk notice: changing page assignments, gateway settings, or the
            checkout implementation on a live site can break checkout further.
            Do these steps on staging, with a backup, or with expert help.
          </p>
        </section>
      </main>
    </PageContainer>
  );
}
