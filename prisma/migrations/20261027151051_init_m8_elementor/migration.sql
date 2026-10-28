-- CreateTable
CREATE TABLE "public"."elementor_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "snapshotPayload" JSONB NOT NULL,
    "snapshotSchemaVersion" INTEGER NOT NULL,
    "snapshotReceivedAt" TIMESTAMP(3) NOT NULL,
    "symptomCategory" TEXT NOT NULL,
    "symptomDescription" TEXT NOT NULL,
    "affectedScope" TEXT NOT NULL DEFAULT 'unknown',
    "affectedPages" TEXT NOT NULL DEFAULT 'unknown',
    "deviceScope" TEXT NOT NULL DEFAULT 'unknown',
    "updatePreceded" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "startedAt" TEXT,
    "errorExcerpt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "elementor_diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."elementor_diagnostic_finding" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "referencedItems" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "requiredAdditionalEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "elementor_diagnostic_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."elementor_ai_analysis" (
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

    CONSTRAINT "elementor_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "elementor_diagnostic_userId_createdAt_idx" ON "public"."elementor_diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "elementor_diagnostic_websiteId_idx" ON "public"."elementor_diagnostic"("websiteId");

-- CreateIndex
CREATE INDEX "elementor_diagnostic_finding_diagnosticId_idx" ON "public"."elementor_diagnostic_finding"("diagnosticId");

-- CreateIndex
CREATE UNIQUE INDEX "elementor_ai_analysis_diagnosticId_key" ON "public"."elementor_ai_analysis"("diagnosticId");

-- AddForeignKey
ALTER TABLE "public"."elementor_diagnostic" ADD CONSTRAINT "elementor_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."elementor_diagnostic" ADD CONSTRAINT "elementor_diagnostic_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."elementor_diagnostic_finding" ADD CONSTRAINT "elementor_diagnostic_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."elementor_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."elementor_ai_analysis" ADD CONSTRAINT "elementor_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."elementor_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
