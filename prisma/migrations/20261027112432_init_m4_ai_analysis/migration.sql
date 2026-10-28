-- CreateTable
CREATE TABLE "public"."ai_analysis" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "analysis" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_analysis_scanId_key" ON "public"."ai_analysis"("scanId");

-- AddForeignKey
ALTER TABLE "public"."ai_analysis" ADD CONSTRAINT "ai_analysis_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "public"."scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
