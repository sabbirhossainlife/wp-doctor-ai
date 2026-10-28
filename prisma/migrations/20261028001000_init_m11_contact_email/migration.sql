-- CreateTable
CREATE TABLE "public"."contact_email_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT,
    "sanitizedTargetUrl" TEXT NOT NULL,
    "sanitizedEmailDomain" TEXT,
    "dkimSelector" TEXT,
    "executionStatus" TEXT NOT NULL,
    "snapshotSchemaVersion" INTEGER,
    "snapshotReceivedAt" TIMESTAMP(3),
    "snapshotFreshness" TEXT NOT NULL,
    "snapshotCopy" JSONB NOT NULL DEFAULT '{}',
    "spfObservation" JSONB NOT NULL DEFAULT '{}',
    "dmarcObservation" JSONB NOT NULL DEFAULT '{}',
    "dkimObservation" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_email_diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contact_email_finding" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidenceStatus" TEXT,
    "limitations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_email_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contact_email_ai_analysis" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "analysis" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "contact_email_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_email_diagnostic_userId_createdAt_idx" ON "public"."contact_email_diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "contact_email_diagnostic_websiteId_idx" ON "public"."contact_email_diagnostic"("websiteId");

-- CreateIndex
CREATE INDEX "contact_email_finding_diagnosticId_idx" ON "public"."contact_email_finding"("diagnosticId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_email_ai_analysis_diagnosticId_key" ON "public"."contact_email_ai_analysis"("diagnosticId");

-- AddForeignKey
ALTER TABLE "public"."contact_email_diagnostic" ADD CONSTRAINT "contact_email_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_email_diagnostic" ADD CONSTRAINT "contact_email_diagnostic_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_email_finding" ADD CONSTRAINT "contact_email_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."contact_email_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contact_email_ai_analysis" ADD CONSTRAINT "contact_email_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."contact_email_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
