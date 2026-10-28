-- Milestone 16: Tool 12 Uptime & Maintenance Monitor. Additive only; no
-- earlier migration is edited and no data is reset.
CREATE TABLE "website_monitor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "websiteId" TEXT NOT NULL,
  "targetHost" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "targetFingerprint" TEXT NOT NULL,
  "targetConfirmed" BOOLEAN NOT NULL DEFAULT true,
  "targetConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'ENABLED',
  "checkIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
  "warningLatencyMs" INTEGER NOT NULL DEFAULT 1000,
  "highLatencyMs" INTEGER NOT NULL DEFAULT 3000,
  "failureThreshold" INTEGER NOT NULL DEFAULT 2,
  "recoveryThreshold" INTEGER NOT NULL DEFAULT 2,
  "maintenanceDetectionEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notifyInApp" BOOLEAN NOT NULL DEFAULT true,
  "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
  "currentState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
  "firstFailureAt" TIMESTAMP(3),
  "lastCheckAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "website_monitor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "monitor_check" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "outcome" TEXT NOT NULL,
  "failureReason" TEXT,
  "httpStatus" INTEGER,
  "latencyMs" INTEGER,
  "latencyWarning" BOOLEAN NOT NULL DEFAULT false,
  "finalUrl" TEXT,
  "redirectCount" INTEGER NOT NULL DEFAULT 0,
  "crossHostRedirectBlocked" BOOLEAN NOT NULL DEFAULT false,
  "maintenanceIndicator" TEXT NOT NULL DEFAULT 'NOT_OBSERVED',
  "monitoringGap" BOOLEAN NOT NULL DEFAULT false,
  "triggeredBy" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "workerId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitor_check_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "monitor_incident" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'DOWN',
  "severity" TEXT NOT NULL DEFAULT 'HIGH',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "firstFailureAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "recoveredAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3) NOT NULL,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "escalationSent" BOOLEAN NOT NULL DEFAULT false,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monitor_incident_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "maintenance_window" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "suppressAlerts" BOOLEAN NOT NULL DEFAULT true,
  "pauseChecks" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "maintenance_window_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "monitor_notification" (
  "id" TEXT NOT NULL,
  "monitorId" TEXT NOT NULL,
  "incidentId" TEXT,
  "windowId" TEXT,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "dedupKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "emailStatus" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monitor_notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monitor_notification_dedupKey_key" UNIQUE ("dedupKey")
);
CREATE TABLE "monitoring_scheduler_state" (
  "id" TEXT NOT NULL,
  "lastTickAt" TIMESTAMP(3),
  "lastTickSummary" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monitoring_scheduler_state_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "website_monitor" ADD CONSTRAINT "website_monitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_monitor" ADD CONSTRAINT "website_monitor_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitor_check" ADD CONSTRAINT "monitor_check_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "website_monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitor_incident" ADD CONSTRAINT "monitor_incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "website_monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_window" ADD CONSTRAINT "maintenance_window_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "website_monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_window" ADD CONSTRAINT "maintenance_window_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitor_notification" ADD CONSTRAINT "monitor_notification_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "website_monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "monitor_notification" ADD CONSTRAINT "monitor_notification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "monitor_incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "website_monitor_userId_createdAt_idx" ON "website_monitor"("userId", "createdAt");
CREATE INDEX "website_monitor_status_nextCheckAt_idx" ON "website_monitor"("status", "nextCheckAt");
CREATE INDEX "monitor_check_monitorId_createdAt_idx" ON "monitor_check"("monitorId", "createdAt");
CREATE INDEX "monitor_incident_monitorId_status_createdAt_idx" ON "monitor_incident"("monitorId", "status", "createdAt");
CREATE INDEX "maintenance_window_monitorId_startAt_idx" ON "maintenance_window"("monitorId", "startAt");
CREATE INDEX "maintenance_window_userId_startAt_idx" ON "maintenance_window"("userId", "startAt");
CREATE INDEX "monitor_notification_monitorId_createdAt_idx" ON "monitor_notification"("monitorId", "createdAt");
