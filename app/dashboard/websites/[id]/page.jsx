import { redirect, notFound } from "next/navigation";
import Container from "../../../../components/Container";
import WebsiteForm from "../../../../components/WebsiteForm";
import DeleteWebsiteButton from "../../../../components/DeleteWebsiteButton";
import ConnectorPairing from "../../../../components/ConnectorPairing";
import { getCurrentUser } from "../../../../lib/session";
import { prisma } from "../../../../lib/prisma";

export default async function WebsiteDetailPage({ params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = (await params).id;
  const website = await prisma.website.findFirst({
    where: { id, userId: user.id },
    include: {
      connection: true,
      snapshots: { orderBy: { receivedAt: "desc" }, take: 1 },
    },
  });
  if (!website) notFound();
  const snapshot = website.snapshots[0] || null;

  return (
    <Container>
      <main className="py-12">
        <p>
          <a className="font-medium text-blue-700 underline" href="/dashboard">← Back to dashboard</a>
        </p>
        <h1 className="mt-4 text-3xl font-bold">{website.name}</h1>
        <p className="mt-2 text-slate-600">{website.normalizedUrl}</p>
        <p className="mt-1 text-slate-600">
          Connection: {website.connectionStatus === "CONNECTED" && website.connection?.status === "ACTIVE"
            ? "Connected — the WordPress connector plugin is paired."
            : "Not connected — the WordPress connector has not paired this site yet."}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Added {website.createdAt.toLocaleString()} · Last updated {website.updatedAt.toLocaleString()}
        </p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">Edit website</h2>
          <div className="mt-4">
            <WebsiteForm initial={website} websiteId={website.id} onDone={undefined} />
          </div>
        </div>
        <ConnectorPairing
          websiteId={website.id}
          connectionId={website.connection?.id || null}
          connectionStatus={website.connection?.status === "ACTIVE" ? "CONNECTED" : website.connectionStatus}
        />
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">Latest diagnostic snapshot</h2>
          {website.connection?.lastSyncAt ? (
            <p className="mt-2 text-sm text-slate-500">
              Last synchronized {website.connection.lastSyncAt.toLocaleString()}
              {website.connection.pluginVersion ? ` · Plugin ${website.connection.pluginVersion}` : ""}
            </p>
          ) : null}
          {!snapshot ? (
            <p className="mt-2 text-slate-600">
              No diagnostic snapshot has been received yet. Pair the connector plugin
              and send a snapshot from its settings page; it will appear here.
            </p>
          ) : (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="font-medium">WordPress</dt>
                <dd className="text-slate-600">{snapshot.payload.wordpressVersion}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">PHP</dt>
                <dd className="text-slate-600">{snapshot.payload.phpVersion}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Active theme</dt>
                <dd className="text-slate-600">
                  {snapshot.payload.activeTheme
                    ? `${snapshot.payload.activeTheme.name} ${snapshot.payload.activeTheme.version || ""}`.trim()
                    : "Unavailable"}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Active plugins</dt>
                <dd className="text-slate-600">
                  {snapshot.payload.activePlugins.length === 0
                    ? "None reported"
                    : snapshot.payload.activePlugins.map((p) => `${p.name} ${p.version || ""}`.trim()).join(", ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Received</dt>
                <dd className="text-slate-600">{snapshot.receivedAt.toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </div>
        <div className="mt-6">
          <DeleteWebsiteButton websiteId={website.id} />
        </div>
      </main>
    </Container>
  );
}
