// Tool 12 email-alert status (Milestone 16). There is NO email-delivery
// adapter in this codebase: SMTP variables exist in .env.example only as
// NOT CONFIGURED placeholders and lib/auth.js confirms no SMTP provider
// is configured. This module therefore always reports EMAIL_NOT_CONFIGURED
// and never claims an email was sent, never calls wp_mail(), and never
// uses a monitored site's mail configuration. In-app notifications and
// history remain fully functional without email. If a real provider
// adapter is added later, it must replace this module and be tested
// against a real provider before any "sent" claim is made.
export function getEmailStatus() {
  return { configured: false, status: "EMAIL_NOT_CONFIGURED", reason: "No email-delivery provider adapter is implemented or configured." };
}

export function recordEmailAttempt() {
  return getEmailStatus();
}
