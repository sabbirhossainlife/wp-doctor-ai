// Shared valid AI analysis fixture for Milestone 4 tests.
export function validAnalysis(findingId = "f1") {
  return {
    schemaVersion: "1",
    summary: "The scan observed an HTTP 500 response from the site.",
    explanation:
      "The server returned HTTP 500, which is an observed server-side error response. The evidence does not identify the exact root cause.",
    diagnosticConfidence: "MEDIUM",
    confirmedObservations: [
      { findingId, observation: "The server returned HTTP 500." },
    ],
    causeHypotheses: [
      {
        title: "Server-side application error",
        explanation: "An HTTP 500 response suggests a fault in the server application that needs log evidence to confirm.",
        confidence: "LOW",
        supportingFindingIds: [findingId],
        additionalEvidenceRequired: "Server error logs via an authorized connector.",
      },
    ],
    recommendedActions: [
      {
        title: "Check the server error log",
        explanation: "Review the error log around the time of the scan for the failing request.",
        priority: "HIGH",
        riskLevel: "LOW",
        skillLevel: "INTERMEDIATE",
        steps: ["Open the hosting error log for the time of the scan."],
        referencedFindingIds: [findingId],
        humanReviewRecommended: true,
      },
    ],
    missingEvidence: ["Server error logs"],
    limitations: ["A public scan cannot see server internals."],
    humanReviewRecommended: true,
  };
}
