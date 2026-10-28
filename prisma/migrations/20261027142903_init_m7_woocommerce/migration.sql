-- CreateTable
CREATE TABLE "public"."woocommerce_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "snapshotPayload" JSONB NOT NULL,
    "snapshotSchemaVersion" INTEGER NOT NULL,
    "snapshotReceivedAt" TIMESTAMP(3) NOT NULL,
    "symptomCategory" TEXT NOT NULL,
    "symptomDescription" TEXT NOT NULL,
    "checkoutType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "affectedScope" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "startedAt" TEXT,
    "errorExcerpt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "woocommerce_diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."woocommerce_diagnostic_finding" (
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

    CONSTRAINT "woocommerce_diagnostic_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."woocommerce_ai_analysis" (
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

    CONSTRAINT "woocommerce_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "woocommerce_diagnostic_userId_createdAt_idx" ON "public"."woocommerce_diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "woocommerce_diagnostic_websiteId_idx" ON "public"."woocommerce_diagnostic"("websiteId");

-- CreateIndex
CREATE INDEX "woocommerce_diagnostic_finding_diagnosticId_idx" ON "public"."woocommerce_diagnostic_finding"("diagnosticId");

-- CreateIndex
CREATE UNIQUE INDEX "woocommerce_ai_analysis_diagnosticId_key" ON "public"."woocommerce_ai_analysis"("diagnosticId");

-- AddForeignKey
ALTER TABLE "public"."woocommerce_diagnostic" ADD CONSTRAINT "woocommerce_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."woocommerce_diagnostic" ADD CONSTRAINT "woocommerce_diagnostic_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."woocommerce_diagnostic_finding" ADD CONSTRAINT "woocommerce_diagnostic_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."woocommerce_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."woocommerce_ai_analysis" ADD CONSTRAINT "woocommerce_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."woocommerce_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
