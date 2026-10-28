<?php
/**
 * Admin settings page. Capability manage_options only, checked
 * server-side on every render and every state-changing POST, plus a
 * WordPress nonce on every form. All output escaped, all input
 * sanitized. The connector credential is never rendered.
 */

if (!defined('ABSPATH')) {
    exit;
}

function wp_doctor_ai_connector_register_menu() {
    add_menu_page(
        'WP Doctor AI Connector',
        'WP Doctor AI',
        'manage_options',
        WP_DOCTOR_AI_CONNECTOR_SLUG,
        'wp_doctor_ai_connector_render_admin_page',
        'dashicons-heart-pulse',
        80
    );
}

function wp_doctor_ai_connector_handle_post() {
    if (!isset($_POST['wp_doctor_ai_action'])) {
        return;
    }
    if (!current_user_can('manage_options')) {
        wp_die('You do not have permission to configure this plugin.');
    }
    $action = sanitize_key($_POST['wp_doctor_ai_action']);
    if ($action === 'pair') {
        check_admin_referer('wp_doctor_ai_pair');
        $code = isset($_POST['wp_doctor_ai_code']) ? strtolower(trim(sanitize_text_field(wp_unslash($_POST['wp_doctor_ai_code'])))) : '';
        $consent = isset($_POST['wp_doctor_ai_consent']) && $_POST['wp_doctor_ai_consent'] === '1';
        if ($code === '' || !$consent) {
            wp_doctor_ai_set_last_error('Enter a pairing code and tick the consent checkbox to pair this site.');
            return;
        }
        $result = wp_doctor_ai_pair_with_code($code);
        if (!$result['ok']) {
            wp_doctor_ai_set_last_error($result['error']);
            return;
        }
        wp_doctor_ai_store_credential($result['credential']);
        wp_doctor_ai_set_status('connected');
        update_option('wp_doctor_ai_paired_at', current_time('mysql'), false);
        wp_doctor_ai_set_last_error('');
    } elseif ($action === 'snapshot') {
        check_admin_referer('wp_doctor_ai_snapshot');
        if (wp_doctor_ai_get_status() !== 'connected') {
            wp_doctor_ai_set_last_error('This site is not paired yet. Pair it first.');
            return;
        }
        $snapshot = wp_doctor_ai_collect_snapshot();
        $result = wp_doctor_ai_send_snapshot($snapshot);
        if (!$result['ok']) {
            if (isset($result['code']) && ($result['code'] === 'CONNECTOR_REVOKED' || $result['code'] === 'CONNECTOR_AUTH_FAILED')) {
                // Server-side revocation: clear local state and force a
                // fresh pairing rather than retrying a dead credential.
                wp_doctor_ai_clear_local_connection();
                wp_doctor_ai_set_status('revoked');
                wp_doctor_ai_set_last_error('The connection was revoked or is no longer valid. Generate a new pairing code in the WP Doctor AI dashboard and pair again.');
            } else {
                wp_doctor_ai_set_last_error($result['error']);
            }
            return;
        }
        update_option('wp_doctor_ai_last_sync', current_time('mysql'), false);
        wp_doctor_ai_set_last_error('');
    } elseif ($action === 'backup') {
        check_admin_referer('wp_doctor_ai_backup');
        if (wp_doctor_ai_get_status() !== 'connected') {
            wp_doctor_ai_set_last_error('This site is not paired yet. Pair it first.');
            return;
        }
        $job_id = isset($_POST['wp_doctor_ai_job_id']) ? sanitize_text_field(wp_unslash($_POST['wp_doctor_ai_job_id'])) : '';
        $mode = isset($_POST['wp_doctor_ai_backup_mode']) ? sanitize_key(wp_unslash($_POST['wp_doctor_ai_backup_mode'])) : '';
        $include_wp_config = isset($_POST['wp_doctor_ai_include_wp_config']) && $_POST['wp_doctor_ai_include_wp_config'] === '1';
        if ($job_id === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $job_id) || !in_array($mode, array('DATABASE_ONLY', 'FILES_ONLY', 'SITE_DATA_BACKUP'), true)) {
            wp_doctor_ai_set_last_error('Enter the backup job ID from the WP Doctor AI dashboard and a valid mode.');
            return;
        }
        $credential = wp_doctor_ai_get_credential();
        if ($credential === '') {
            wp_doctor_ai_set_last_error('This site is not paired yet. Pair it first.');
            return;
        }
        $result = wp_doctor_ai_backup_run($job_id, $mode, $include_wp_config, $credential);
        if (!$result['ok']) {
            wp_doctor_ai_set_last_error($result['error']);
            return;
        }
        wp_doctor_ai_set_last_error('');
    } elseif ($action === 'disconnect') {
        check_admin_referer('wp_doctor_ai_disconnect');
        // Local state is cleared immediately. Remote revocation is
        // owner-driven from the SaaS dashboard: if the SaaS is
        // unreachable, this page must not claim the remote connection
        // was revoked — the dashboard remains the source of truth.
        wp_doctor_ai_clear_local_connection();
        wp_doctor_ai_set_status('disconnected');
    }
}

function wp_doctor_ai_connector_render_admin_page() {
    if (!current_user_can('manage_options')) {
        wp_die('You do not have permission to configure this plugin.');
    }
    if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') {
        wp_doctor_ai_connector_handle_post();
    }
    $base = wp_doctor_ai_get_api_base();
    $status = wp_doctor_ai_get_status();
    $paired_at = wp_doctor_ai_get_paired_at();
    $last_sync = wp_doctor_ai_get_last_sync();
    $last_error = wp_doctor_ai_get_last_error();
    ?>
    <div class="wrap">
        <h1>WP Doctor AI Connector</h1>
        <p>Connects this site to WP Doctor AI for <strong>read-only</strong> diagnostics. This plugin never edits files, deactivates plugins, changes themes, or modifies settings.</p>
        <h2>Connection status</h2>
        <p>
            <strong>Status:</strong> <?php echo esc_html($status); ?><br />
            <strong>SaaS endpoint:</strong> <?php echo $base['valid'] ? esc_html($base['base']) : esc_html($base['error']); ?><br />
            <?php if ($paired_at !== '') : ?>
                <strong>Paired:</strong> <?php echo esc_html($paired_at); ?><br />
            <?php endif; ?>
            <?php if ($last_sync !== '') : ?>
                <strong>Last snapshot sent:</strong> <?php echo esc_html($last_sync); ?><br />
            <?php endif; ?>
        </p>
        <?php if ($last_error !== '') : ?>
            <div class="notice notice-error"><p><?php echo esc_html($last_error); ?></p></div>
        <?php endif; ?>
        <h2>What is shared</h2>
        <p>Only when you explicitly pair and then explicitly send a snapshot: WordPress version, PHP version, site and home URLs, plugin version, active plugin names and versions, active theme name and version, multisite status, and locale. Never usernames, emails, passwords, API keys, post content, order data, logs, or configuration secrets. See readme.txt for the full privacy statement.</p>
        <?php if ($status !== 'connected') : ?>
            <h2>Pair this site</h2>
            <p>Generate a one-time pairing code in the WP Doctor AI dashboard (website detail page) and paste it below. The code expires after 10 minutes and can be used once.</p>
            <form method="post">
                <?php wp_nonce_field('wp_doctor_ai_pair'); ?>
                <input type="hidden" name="wp_doctor_ai_action" value="pair" />
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="wp_doctor_ai_code">Pairing code</label></th>
                        <td><input type="text" id="wp_doctor_ai_code" name="wp_doctor_ai_code" class="regular-text" autocomplete="off" /></td>
                    </tr>
                    <tr>
                        <th scope="row">Consent</th>
                        <td><label><input type="checkbox" name="wp_doctor_ai_consent" value="1" /> I understand what diagnostic information will be shared (listed above) and I authorize this connection.</label></td>
                    </tr>
                </table>
                <?php submit_button('Pair this site'); ?>
            </form>
        <?php else : ?>
            <h2>Send diagnostic snapshot</h2>
            <p>Sends the current read-only snapshot listed above to WP Doctor AI. No automatic background sync happens.</p>
            <form method="post" style="display:inline;">
                <?php wp_nonce_field('wp_doctor_ai_snapshot'); ?>
                <input type="hidden" name="wp_doctor_ai_action" value="snapshot" />
                <?php submit_button('Send diagnostic snapshot', 'primary', 'submit', false); ?>
            </form>
            <form method="post" style="display:inline; margin-left: 8px;">
                <?php wp_nonce_field('wp_doctor_ai_disconnect'); ?>
                <input type="hidden" name="wp_doctor_ai_action" value="disconnect" />
                <?php submit_button('Disconnect', 'delete', 'submit', false); ?>
            </form>
            <p class="description">Disconnecting clears the local credential immediately, so this site stops sending snapshots. For full server-side invalidation, also use the Revoke button in your WP Doctor AI dashboard.</p>
            <h2>Create backup export</h2>
            <p>Create a backup job first in the WP Doctor AI dashboard (Backup, Restore &amp; Migration), then paste its job ID here. The package is built on this site only, uploaded in bounded chunks, integrity-checked, encrypted, and stored by the service. Multisite sites are refused. wp-config.php is excluded unless you explicitly tick the same-site recovery opt-in below — its contents are never shown here.</p>
            <form method="post">
                <?php wp_nonce_field('wp_doctor_ai_backup'); ?>
                <input type="hidden" name="wp_doctor_ai_action" value="backup" />
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="wp_doctor_ai_job_id">Backup job ID</label></th>
                        <td><input type="text" id="wp_doctor_ai_job_id" name="wp_doctor_ai_job_id" class="regular-text" autocomplete="off" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="wp_doctor_ai_backup_mode">Mode</label></th>
                        <td><select id="wp_doctor_ai_backup_mode" name="wp_doctor_ai_backup_mode"><option value="SITE_DATA_BACKUP">Site data (database + supported files)</option><option value="DATABASE_ONLY">Database only</option><option value="FILES_ONLY">Files only</option></select></td>
                    </tr>
                    <tr>
                        <th scope="row">Same-site recovery opt-in</th>
                        <td><label><input type="checkbox" name="wp_doctor_ai_include_wp_config" value="1" /> Include wp-config.php in this archive (same-site recovery only). WARNING: this file contains database credentials and secret keys — only use it for recovery on this same site, never for migration to another destination.</label></td>
                    </tr>
                </table>
                <?php submit_button('Create backup export', 'primary'); ?>
            </form>
            <?php $last_backup = get_option('wp_doctor_ai_last_backup', ''); if ($last_backup !== '') : ?>
                <p><strong>Last backup export:</strong> <?php echo esc_html($last_backup); ?></p>
            <?php endif; ?>
        <?php endif; ?>
    </div>
    <?php
}
