-- Milestone 9 — Tool 05 Website Speed Analyzer.
CREATE TABLE "speed_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedTarget" TEXT NOT NULL,
    "providerTarget" TEXT,
    "queryStripped" BOOLEAN NOT NULL DEFAULT true,
    "strategy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpSummary" JSONB NOT NULL,
    "lighthouseSummary" JSONB,
    "cruxSummary" JSONB,
    "providerStatuses" JSONB NOT NULL,
    "notices" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "speed_diagnostic_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "speed_diagnostic_userId_createdAt_idx" ON "speed_diagnostic"("userId", "createdAt");
CREATE TABLE "speed_diagnostic_finding" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceAuditId" TEXT,
    "sourceMetric" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "relatedMetric" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "speed_diagnostic_finding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "speed_diagnostic_finding_diagnosticId_idx" ON "speed_diagnostic_finding"("diagnosticId");
CREATE TABLE "speed_ai_analysis" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "analysis" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "speed_ai_analysis_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "speed_ai_analysis_diagnosticId_key" UNIQUE ("diagnosticId")
);
ALTER TABLE "speed_diagnostic" ADD CONSTRAINT "speed_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speed_diagnostic_finding" ADD CONSTRAINT "speed_diagnostic_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "speed_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "speed_ai_analysis" ADD CONSTRAINT "speed_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "speed_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
