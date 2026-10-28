-- AlterTable
ALTER TABLE "public"."speed_ai_analysis" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."ssl_redirect_diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT,
    "sanitizedTargetUrl" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "tlsOutcome" JSONB,
    "redirectChain" JSONB NOT NULL,
    "limitations" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ssl_redirect_diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ssl_redirect_finding" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "limitations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssl_redirect_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ssl_redirect_ai_analysis" (
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

    CONSTRAINT "ssl_redirect_ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ssl_redirect_diagnostic_userId_createdAt_idx" ON "public"."ssl_redirect_diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ssl_redirect_diagnostic_websiteId_idx" ON "public"."ssl_redirect_diagnostic"("websiteId");

-- CreateIndex
CREATE INDEX "ssl_redirect_finding_diagnosticId_idx" ON "public"."ssl_redirect_finding"("diagnosticId");

-- CreateIndex
CREATE UNIQUE INDEX "ssl_redirect_ai_analysis_diagnosticId_key" ON "public"."ssl_redirect_ai_analysis"("diagnosticId");

-- AddForeignKey
ALTER TABLE "public"."ssl_redirect_diagnostic" ADD CONSTRAINT "ssl_redirect_diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ssl_redirect_diagnostic" ADD CONSTRAINT "ssl_redirect_diagnostic_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."website"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ssl_redirect_finding" ADD CONSTRAINT "ssl_redirect_finding_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."ssl_redirect_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ssl_redirect_ai_analysis" ADD CONSTRAINT "ssl_redirect_ai_analysis_diagnosticId_fkey" FOREIGN KEY ("diagnosticId") REFERENCES "public"."ssl_redirect_diagnostic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
