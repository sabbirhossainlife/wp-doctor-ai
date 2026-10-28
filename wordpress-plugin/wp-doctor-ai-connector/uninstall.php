<?php
/**
 * Uninstall: remove plugin-owned local options only.
 * Unrelated WordPress data is never touched. Remote revocation is a
 * separate, owner-driven step in the WP Doctor AI dashboard: if the
 * SaaS is unreachable at uninstall time, the remote connection is NOT
 * claimed revoked here — revoke it in the dashboard afterwards.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('wp_doctor_ai_credential');
delete_option('wp_doctor_ai_status');
delete_option('wp_doctor_ai_paired_at');
delete_option('wp_doctor_ai_last_sync');
delete_option('wp_doctor_ai_last_error');
delete_option('wp_doctor_ai_last_backup');
