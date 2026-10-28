-- CreateTable
CREATE TABLE "public"."backup_artifact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceWebsiteId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "manifest" JSONB NOT NULL,
    "storageId" TEXT NOT NULL,
    "storageDriver" TEXT NOT NULL DEFAULT 'local',
    "encryptionScheme" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "encryptionKeyId" TEXT,
    "archiveBytes" INTEGER,
    "archiveSha256" TEXT,
    "tableCount" INTEGER NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "backup_artifact_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "public"."backup_operation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT,
    "sourceWebsiteId" TEXT,
    "destinationWebsiteId" TEXT,
    "backupArtifactId" TEXT,
    "rollbackBackupId" TEXT,
    "plan" JSONB NOT NULL DEFAULT '{}',
    "planHash" TEXT,
    "confirmationTokenHash" TEXT,
    "confirmationExpiresAt" TIMESTAMP(3),
    "confirmationUsedAt" TIMESTAMP(3),
    "preflight" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "verification" JSONB NOT NULL DEFAULT '{}',
    "fileCount" INTEGER,
    "tableCount" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "backup_operation_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "public"."backup_operation_event" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_operation_event_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "public"."backup_download_token" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_download_token_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "backup_artifact_userId_createdAt_idx" ON "public"."backup_artifact"("userId", "createdAt");
-- CreateIndex
CREATE INDEX "backup_operation_userId_createdAt_idx" ON "public"."backup_operation"("userId", "createdAt");
-- CreateIndex
CREATE INDEX "backup_operation_destinationWebsiteId_state_idx" ON "public"."backup_operation"("destinationWebsiteId", "state");
-- CreateIndex
CREATE INDEX "backup_operation_event_operationId_createdAt_idx" ON "public"."backup_operation_event"("operationId", "createdAt");
-- CreateIndex
CREATE INDEX "backup_download_token_artifactId_idx" ON "public"."backup_download_token"("artifactId");
-- AddForeignKey
ALTER TABLE "public"."backup_artifact" ADD CONSTRAINT "backup_artifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_artifact" ADD CONSTRAINT "backup_artifact_sourceWebsiteId_fkey" FOREIGN KEY ("sourceWebsiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_operation" ADD CONSTRAINT "backup_operation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_operation" ADD CONSTRAINT "backup_operation_sourceWebsiteId_fkey" FOREIGN KEY ("sourceWebsiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_operation" ADD CONSTRAINT "backup_operation_destinationWebsiteId_fkey" FOREIGN KEY ("destinationWebsiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_operation" ADD CONSTRAINT "backup_operation_backupArtifactId_fkey" FOREIGN KEY ("backupArtifactId") REFERENCES "public"."backup_artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_operation_event" ADD CONSTRAINT "backup_operation_event_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "public"."backup_operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_download_token" ADD CONSTRAINT "backup_download_token_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "public"."backup_artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "public"."backup_download_token" ADD CONSTRAINT "backup_download_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
