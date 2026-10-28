-- CreateTable
CREATE TABLE "public"."seo_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT,
    "sanitizedWebsiteUrl" TEXT NOT NULL,
    "requestedTarget" TEXT NOT NULL,
    "finalUrl" TEXT,
    "executionStatus" TEXT NOT NULL,
    "snapshotSchemaVersion" INTEGER,
    "snapshotReceivedAt" TIMESTAMP(3),
    "snapshotFreshness" TEXT NOT NULL,
    "homepageSummary" JSONB NOT NULL DEFAULT '{}',
    "robotsSummary" JSONB NOT NULL DEFAULT '{}',
    "sitemapSummary" JSONB NOT NULL DEFAULT '{}',
    "spamSignals" JSONB NOT NULL DEFAULT '{}',
    "seoPluginSummary" JSONB NOT NULL DEFAULT '{}',
    "advisoryContext" JSONB NOT NULL DEFAULT '{}',
    "searchConsoleStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "summary" JSONB NOT NULL,
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."seo_diagnostic_finding" (
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
    "checkId" TEXT,
    "evidenceCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_diagnostic_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."seo_ai_analysis" (
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

    CONSTRAINT "seo_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seo_diagnostic_userId_createdAt_idx" ON "public"."seo_diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "seo_diagnostic_websiteId_idx" ON "public"."seo_diagnostic"("websiteId");

-- CreateIndex
CREATE INDEX "seo_diagnostic_finding_diagnosticId_idx" ON "public"."seo_diagnostic_finding"("diagnosticId");

-- CreateIndex
CREATE UNIQUE INDEX "seo_ai_analysis_diagnosticId_key" ON "public"."seo_ai_analysis"("diagnosticId");

-- AddForeignKey
ALTER TABLE "public"."seo_diagnostic" ADD CONSTRAINT "seo_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."seo_diagnostic" ADD CONSTRAINT "seo_diagnostic_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."seo_diagnostic_finding" ADD CONSTRAINT "seo_diagnostic_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."seo_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."seo_ai_analysis" ADD CONSTRAINT "seo_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."seo_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

