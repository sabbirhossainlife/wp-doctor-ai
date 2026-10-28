-- CreateTable
CREATE TABLE "public"."scan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL,
    "diagnosticOutcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "redirectCount" INTEGER,
    "finalUrl" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scan_finding" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_finding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_userId_createdAt_idx" ON "public"."scan"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "scan_finding_scanId_idx" ON "public"."scan_finding"("scanId");

-- AddForeignKey
ALTER TABLE "public"."scan" ADD CONSTRAINT "scan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scan_finding" ADD CONSTRAINT "scan_finding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "public"."scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
