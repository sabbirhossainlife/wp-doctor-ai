-- CreateTable
CREATE TABLE "public"."security_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT,
    "sanitizedWebsiteUrl" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL,
    "snapshotSchemaVersion" INTEGER,
    "snapshotReceivedAt" TIMESTAMP(3),
    "snapshotFreshness" TEXT NOT NULL,
    "componentInventorySummary" JSONB NOT NULL DEFAULT '{}',
    "advisoryMatchSummary" JSONB NOT NULL DEFAULT '{}',
    "providerStatuses" JSONB NOT NULL DEFAULT '[]',
    "httpObservations" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL,
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."security_diagnostic_finding" (
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
    "advisoryId" TEXT,
    "cveId" TEXT,
    "sourceUrl" TEXT,
    "fixedVersion" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_diagnostic_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."security_ai_analysis" (
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

    CONSTRAINT "security_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_diagnostic_userId_createdAt_idx" ON "public"."security_diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "security_diagnostic_websiteId_idx" ON "public"."security_diagnostic"("websiteId");

-- CreateIndex
CREATE INDEX "security_diagnostic_finding_diagnosticId_idx" ON "public"."security_diagnostic_finding"("diagnosticId");

-- CreateIndex
CREATE UNIQUE INDEX "security_ai_analysis_diagnosticId_key" ON "public"."security_ai_analysis"("diagnosticId");

-- AddForeignKey
ALTER TABLE "public"."security_diagnostic" ADD CONSTRAINT "security_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_diagnostic" ADD CONSTRAINT "security_diagnostic_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_diagnostic_finding" ADD CONSTRAINT "security_diagnostic_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."security_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_ai_analysis" ADD CONSTRAINT "security_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."security_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
