<?php
/**
 * Plugin Name:       WP Doctor AI Connector
 * Plugin URI:        https://example.invalid/wp-doctor-ai-connector
 * Description:       Securely connects a WordPress site to the WP Doctor AI SaaS for read-only diagnostics. No remote control, no automatic changes.
 * Version:           1.7.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            WP Doctor AI
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-doctor-ai-connector
 *
 * This plugin is intentionally small and read-only. It never executes
 * remote commands, edits files, deactivates plugins, changes themes,
 * or modifies production settings. It only sends an administrator-
 * triggered diagnostic snapshot to the configured SaaS endpoint.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.7.0');
define('WP_DOCTOR_AI_CONNECTOR_SLUG', 'wp-doctor-ai-connector');
define('WP_DOCTOR_AI_CONNECTOR_DIR', plugin_dir_path(__FILE__));

require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-connection.php';
require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-api-base.php';
require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-api-client.php';
require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-diagnostics.php';
require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-malware.php';
require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-admin.php';
require_once WP_DOCTOR_AI_CONNECTOR_DIR . 'includes/class-backup.php';

add_action('admin_menu', 'wp_doctor_ai_connector_register_menu');
