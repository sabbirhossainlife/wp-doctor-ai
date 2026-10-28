-- CreateTable
CREATE TABLE "public"."connector_pairing_intent" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_pairing_intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."website_connection" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "credentialHash" TEXT NOT NULL,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "pluginVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connector_request_nonce" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_request_nonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connector_diagnostic_snapshot" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_diagnostic_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connector_pairing_intent_websiteId_idx" ON "public"."connector_pairing_intent"("websiteId");

-- CreateIndex
CREATE INDEX "connector_pairing_intent_codeHash_idx" ON "public"."connector_pairing_intent"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "website_connection_websiteId_key" ON "public"."website_connection"("websiteId");

-- CreateIndex
CREATE INDEX "connector_request_nonce_connectionId_createdAt_idx" ON "public"."connector_request_nonce"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "connector_request_nonce_connectionId_nonce_key" ON "public"."connector_request_nonce"("connectionId", "nonce");

-- CreateIndex
CREATE INDEX "connector_diagnostic_snapshot_connectionId_receivedAt_idx" ON "public"."connector_diagnostic_snapshot"("connectionId", "receivedAt");

-- AddForeignKey
ALTER TABLE "public"."connector_pairing_intent" ADD CONSTRAINT "connector_pairing_intent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_pairing_intent" ADD CONSTRAINT "connector_pairing_intent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."website_connection" ADD CONSTRAINT "website_connection_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_request_nonce" ADD CONSTRAINT "connector_request_nonce_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."website_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_diagnostic_snapshot" ADD CONSTRAINT "connector_diagnostic_snapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."website_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connector_diagnostic_snapshot" ADD CONSTRAINT "connector_diagnostic_snapshot_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
