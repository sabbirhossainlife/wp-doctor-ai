=== WP Doctor AI Connector ===
Contributors: wpdoctorai
Tags: diagnostics, troubleshooting, wordpress health
Requires at least: 5.8
Tested up to: 7.1.3
Requires PHP: 7.4
Stable tag: 1.7.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Securely connects a WordPress site to the WP Doctor AI SaaS for read-only diagnostics. No remote control, no automatic changes.

== Description ==

WP Doctor AI Connector pairs a WordPress site with the WP Doctor AI SaaS so the site owner can voluntarily share a limited, read-only diagnostic snapshot. The plugin:

* Pairs with a short-lived, one-time code generated in the WP Doctor AI dashboard.
* Sends a diagnostic snapshot only when an administrator explicitly clicks "Send diagnostic snapshot".
* Never edits files, deactivates plugins, changes themes, modifies settings, or runs remote commands.
* Never collects usernames, emails, passwords, API keys, post content, order data, logs, or configuration secrets.

Tested on a local WordPress 7.1.3 + PHP 8.3 install. "Tested up to: 7.1.3" reflects that local verification only; it is not a claim about other versions.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/` or install the ZIP via Plugins > Add New > Upload Plugin.
2. Activate the plugin.
3. In `wp-config.php`, define the SaaS endpoint (production SaaS domain is supplied by your deployment; there is no invented default):
   `define('WP_DOCTOR_AI_API_BASE_URL', 'https://your-saas-domain.example');`
   For local development only, also define `WP_DOCTOR_AI_DEV_MODE` as true to allow http to a loopback host. Never enable dev mode in production.
4. In the WP Doctor AI dashboard, open the website and generate a pairing code.
5. In WordPress, open WP Doctor AI > Pair this site, tick the consent checkbox, paste the code, and submit.

== Frequently Asked Questions ==

= What data is shared? =
WordPress version, PHP version, home/site URLs, plugin version, active plugin names and versions, active theme name and version, multisite status, and locale. Nothing else.

= Does the plugin run in the background? =
No. Snapshots are sent only on an explicit administrator action. There is no telemetry or scheduled sync.

= How do I disconnect? =
Use Disconnect on the plugin page (clears local credentials) and Revoke in the WP Doctor AI dashboard (invalidates the credential server-side).

= What happens on uninstall? =
Plugin-owned local options are removed. Unrelated WordPress data is untouched. If the SaaS was unreachable, revoke the connection in the dashboard afterwards; uninstall alone does not claim remote revocation.

== Changelog ==

= 1.7.0 =
* Tool 10 backup export (admin-triggered only, manage_options + nonce): bounded package builder (fixed WP file scope, symlinks skipped, caches/upgrade dirs excluded, wp-config.php excluded by default with an explicit same-site-recovery opt-in) + bounded database export via $wpdb in batches + chunked upload to the SaaS backup-transfer endpoints. Multisite is blocked, never partially backed up. There is NO restore-apply endpoint in this version: restore/migration execution is reported BLOCKED by the SaaS rather than faked. Diagnostic snapshot schema stays v7.


= 1.6.0 =
* Schema v7: bounded sanitized malware-scan summary (local read-only file inspection at sync time: core/plugin checksum comparison against official WordPress.org references, conservative static-signature rules, unexpected core files, PHP files in uploads). No file contents, source snippets, secrets, or absolute paths are ever sent. Theme slug added (stylesheet directory name from the theme API only). v1-v6 payloads still validate server-side. No cleanup, quarantine, restore, delete, or other site modification is performed.

= 1.5.0 =
* Schema v6: read-only security indicators (WP_DEBUG, WP_DEBUG_DISPLAY, WP_DEBUG_LOG, DISALLOW_FILE_EDIT as yes/no/unknown from runtime constants only; never wp-config.php contents, options, users, or secrets). v1-v5 payloads still validate server-side.

= 1.4.0 =
* Schema v5: read-only contact-form + mail-transport section (Contact Form 7 adapter: form count capped at 200, sender/recipient presence, literal-sender domain only; WP Mail SMTP adapter, fixture-verified: mailer identifier, from-email domain, presence booleans only; other recognised form/mail plugins reported as UNSUPPORTED with no counts or config claims). No recipients, subjects, bodies, submissions, entries, hosts, usernames, or secrets of any kind are collected; sender-domain comparison data is domain-only. v1-v4 payloads still validate server-side.

= 1.3.0 =
* Schema v3: read-only WooCommerce section (presence/version, cart/checkout/my-account page assignment + status + block/classic classification, registered gateway ids/titles/enabled flags with block compatibility reported as unknown unless trustworthily declared). No gateway settings, orders, customers, or secrets are collected.

= 1.1.0 =
* Schema v2: full installed-plugin inventory, theme parent/requirements, cached update info only.

= 1.0.0 =
* Initial release: one-time pairing, read-only diagnostic snapshot, disconnect, uninstall cleanup.
