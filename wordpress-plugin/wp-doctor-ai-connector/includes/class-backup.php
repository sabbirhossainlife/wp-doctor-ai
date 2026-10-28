<?php
/**
 * Tool 10 backup exporter (connector 1.7.0). Admin-triggered ONLY
 * (manage_options + WP nonce, from the plugin admin page). It builds a
 * bounded backup package on this site and uploads it in chunks to the
 * SaaS backup-transfer endpoints using the existing paired credential.
 *
 * Hard boundaries, all enforced here:
 * - Multisite is BLOCKED (never a silent single-site backup).
 * - Root comes only from ABSPATH (trusted runtime), never from input.
 * - File scope is fixed: core + required install files, wp-content/
 *   plugins, themes, mu-plugins, uploads, languages. Caches and upgrade
 *   temp dirs are excluded. Symlinks are skipped, never followed.
 * - wp-config.php is EXCLUDED by default. It is included only when the
 *   administrator explicitly ticks the same-site-recovery opt-in, and
 *   its contents are never displayed, logged, or sent anywhere except
 *   inside the encrypted SaaS transfer package.
 * - No arbitrary server directories, no other installs, no SSH keys,
 *   no .env files, no hosting credentials are ever read.
 * - Limits: 50,000 files, 256 MiB per file, 512 MiB package, ~25 s
 *   build budget (a hit yields a partial manifest flag, never a claim
 *   of completeness). Database rows are exported in bounded batches
 *   through $wpdb only — never by reading DB credentials or files.
 * - This exporter does NOT restore anything. There is no restore-apply
 *   endpoint in this milestone; the SaaS reports restore/migration
 *   execution as BLOCKED rather than faking success.
 * - The SaaS database is never involved: the package goes to the SaaS
 *   backup-transfer API, and a restore target is always a registered
 *   WordPress site, never the SaaS database.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('WP_DOCTOR_AI_BACKUP_MAX_FILES', 50000);
define('WP_DOCTOR_AI_BACKUP_MAX_FILE_BYTES', 256 * 1024 * 1024);
define('WP_DOCTOR_AI_BACKUP_MAX_PACKAGE_BYTES', 512 * 1024 * 1024);
define('WP_DOCTOR_AI_BACKUP_TIME_BUDGET_SECONDS', 25);

function wp_doctor_ai_backup_is_multisite() {
    return function_exists('is_multisite') && is_multisite();
}

function wp_doctor_ai_backup_scope_roots() {
    $root = wp_normalize_path(ABSPATH);
    return array(
        'root' => $root,
        'plugins' => $root . 'wp-content/plugins',
        'themes' => $root . 'wp-content/themes',
        'mu-plugins' => $root . 'wp-content/mu-plugins',
        'uploads' => $root . 'wp-content/uploads',
        'languages' => $root . 'wp-content/languages',
    );
}

function wp_doctor_ai_backup_is_excluded_dir($relative) {
    return strpos($relative, 'wp-content/cache/') === 0
        || strpos($relative, 'wp-content/upgrade/') === 0
        || strpos($relative, 'wp-content/uploads/cache/') === 0;
}

function wp_doctor_ai_backup_collect_files($mode, $include_wp_config, &$skipped, &$limit_reached) {
    $roots = wp_doctor_ai_backup_scope_roots();
    $files = array();
    $started = microtime(true);
    $skipped = array();
    $limit_reached = false;
    $total = 0;
    $stack = array();
    if ($mode === 'FILES_ONLY' || $mode === 'SITE_DATA_BACKUP') {
        // Root install files (depth 1 only), plus the fixed subtrees.
        foreach (glob($roots['root'] . '*') as $entry) {
            if (is_file($entry) && !is_link($entry)) {
                $base = basename($entry);
                if ($base === 'wp-config.php' && !$include_wp_config) {
                    $skipped[] = array('path' => 'wp-config.php', 'reason' => 'excluded-by-default');
                    continue;
                }
                $stack[] = $entry;
            }
        }
        foreach (array('plugins', 'themes', 'mu-plugins', 'uploads', 'languages') as $key) {
            if (is_dir($roots[$key])) {
                $stack[] = $roots[$key];
            }
        }
        // wp-admin + wp-includes are collected only for SITE_DATA_BACKUP
        // (FILES_ONLY focuses on wp-content + root install files).
        if ($mode === 'SITE_DATA_BACKUP') {
            foreach (array('wp-admin', 'wp-includes') as $dir) {
                if (is_dir($roots['root'] . $dir)) {
                    $stack[] = $roots['root'] . $dir;
                }
            }
        }
    }
    while (!empty($stack)) {
        if (count($files) >= WP_DOCTOR_AI_BACKUP_MAX_FILES || $total > WP_DOCTOR_AI_BACKUP_MAX_PACKAGE_BYTES
            || (microtime(true) - $started) > WP_DOCTOR_AI_BACKUP_TIME_BUDGET_SECONDS) {
            $limit_reached = true;
            break;
        }
        $path = array_pop($stack);
        if (is_link($path)) {
            $skipped[] = array('path' => 'symlink-skipped', 'reason' => 'symlink');
            continue;
        }
        if (is_dir($path)) {
            $children = glob(rtrim($path, '/') . '/*');
            if (is_array($children)) {
                foreach ($children as $child) {
                    $stack[] = $child;
                }
            }
            continue;
        }
        if (!is_file($path) || !is_readable($path)) {
            continue;
        }
        $relative = ltrim(str_replace($roots['root'], '', wp_normalize_path($path)), '/');
        if (wp_doctor_ai_backup_is_excluded_dir($relative)) {
            continue;
        }
        $size = filesize($path);
        if ($size === false || $size > WP_DOCTOR_AI_BACKUP_MAX_FILE_BYTES) {
            $skipped[] = array('path' => $relative, 'reason' => 'too-large');
            continue;
        }
        $files[] = array('absolute' => $path, 'relative' => $relative, 'size' => $size);
        $total += $size;
    }
    return $files;
}

function wp_doctor_ai_backup_collect_tables() {
    global $wpdb;
    $tables = $wpdb->get_col("SHOW TABLES LIKE '" . esc_sql($wpdb->prefix) . "%'");
    if (!is_array($tables)) {
        return array();
    }
    $out = array();
    foreach ($tables as $table) {
        $count = $wpdb->get_var("SELECT COUNT(*) FROM `" . esc_sql($table) . "`");
        $out[] = array('name' => $table, 'rows' => $count === null ? null : (int) $count);
    }
    return $out;
}

function wp_doctor_ai_backup_export_db($tables, &$limit_reached) {
    global $wpdb;
    $sql = "-- WP Doctor AI backup export (connector 1.7.0). Generated on this site only.\n";
    $sql .= "-- Tables are restored only through a reviewed restore workflow; never apply blindly.\n\n";
    $started = microtime(true);
    $limit_reached = false;
    foreach ($tables as $table_info) {
        $table = $table_info['name'];
        $create = $wpdb->get_row("SHOW CREATE TABLE `" . esc_sql($table) . "`", ARRAY_N);
        if ($create && isset($create[1])) {
            $sql .= $create[1] . ";\n\n";
        }
        $offset = 0;
        $batch = 500;
        while (true) {
            if ((microtime(true) - $started) > WP_DOCTOR_AI_BACKUP_TIME_BUDGET_SECONDS) {
                $limit_reached = true;
                break 2;
            }
            $rows = $wpdb->get_results("SELECT * FROM `" . esc_sql($table) . "` LIMIT " . (int) $offset . ", " . (int) $batch, ARRAY_N);
            if (empty($rows)) {
                break;
            }
            foreach ($rows as $row) {
                $values = array();
                foreach ($row as $value) {
                    if ($value === null) {
                        $values[] = 'NULL';
                    } else {
                        $values[] = "'" . $wpdb->_escape($value) . "'";
                    }
                }
                $sql .= "INSERT INTO `" . esc_sql($table) . "` VALUES (" . implode(', ', $values) . ");\n";
            }
            $offset += $batch;
            if (count($rows) < $batch) {
                break;
            }
        }
    }
    return $sql;
}

function wp_doctor_ai_backup_build_package($job_id, $mode, $include_wp_config) {
    if (wp_doctor_ai_backup_is_multisite()) {
        return array('ok' => false, 'error' => 'Multisite backup is not supported in this version. The operation was blocked, not partially run.', 'code' => 'MULTISITE_UNSUPPORTED');
    }
    if (!in_array($mode, array('DATABASE_ONLY', 'FILES_ONLY', 'SITE_DATA_BACKUP'), true)) {
        return array('ok' => false, 'error' => 'Invalid backup mode.', 'code' => 'INVALID_MODE');
    }
    if (!class_exists('ZipArchive')) {
        return array('ok' => false, 'error' => 'ZipArchive is not available on this server.', 'code' => 'ZIP_UNAVAILABLE');
    }
    $skipped = array();
    $file_limit = false;
    $files = wp_doctor_ai_backup_collect_files($mode, $include_wp_config, $skipped, $file_limit);
    $tables = array();
    $db_sql = '';
    $db_limit = false;
    if ($mode === 'DATABASE_ONLY' || $mode === 'SITE_DATA_BACKUP') {
        $tables = wp_doctor_ai_backup_collect_tables();
        $db_sql = wp_doctor_ai_backup_export_db($tables, $db_limit);
    }
    $manifest = array(
        'format' => 'wp-doctor-ai-backup-zip-v1',
        'formatVersion' => 1,
        'connectorVersion' => WP_DOCTOR_AI_CONNECTOR_VERSION,
        'wordpressVersion' => get_bloginfo('version'),
        'phpVersion' => phpversion(),
        'homeUrl' => home_url(),
        'siteUrl' => site_url(),
        'multisite' => false,
        'tablePrefix' => isset($GLOBALS['wpdb']->prefix) ? $GLOBALS['wpdb']->prefix : null,
        'mode' => $mode,
        'includedCategories' => $mode === 'DATABASE_ONLY' ? array('database') : ($mode === 'FILES_ONLY' ? array('files') : array('database', 'files')),
        'excludedCategories' => $include_wp_config ? array('caches', 'upgrade-temp-dirs') : array('wp-config.php', 'caches', 'upgrade-temp-dirs'),
        'skippedFiles' => array_slice($skipped, 0, 100),
        'tableCount' => count($tables),
        'fileCount' => count($files),
        'includesWpConfig' => (bool) $include_wp_config,
        'limitReached' => $file_limit || $db_limit,
        'tables' => $tables,
    );
    $tmp = get_temp_dir() . 'wp-doctor-ai-backup-' . sanitize_file_name($job_id) . '-' . wp_generate_password(12, false, false) . '.zip';
    $zip = new ZipArchive();
    if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        return array('ok' => false, 'error' => 'Could not create the backup package.', 'code' => 'PACKAGE_FAILED');
    }
    $zip->addFromString('manifest.json', wp_json_encode($manifest));
    if ($db_sql !== '') {
        $zip->addFromString('database.sql', $db_sql);
    }
    foreach ($files as $file) {
        // addFile with an explicit local name keeps archive paths relative
        // and inside the package; symlinks were already skipped above.
        $zip->addFile($file['absolute'], $file['relative']);
    }
    $zip->close();
    return array('ok' => true, 'package' => $tmp, 'manifest' => $manifest, 'fileCount' => count($files), 'tableCount' => count($tables));
}

function wp_doctor_ai_backup_upload_package($job_id, $package_path, $manifest, $credential) {
    $data = file_get_contents($package_path);
    if ($data === false) {
        return array('ok' => false, 'error' => 'Could not read the backup package.', 'code' => 'PACKAGE_FAILED');
    }
    $total_bytes = strlen($data);
    $chunk_size = 1024 * 1024;
    $total_chunks = (int) ceil($total_bytes / $chunk_size);
    if ($total_chunks < 1 || $total_chunks > 512 || $total_bytes > WP_DOCTOR_AI_BACKUP_MAX_PACKAGE_BYTES) {
        return array('ok' => false, 'error' => 'Backup package exceeds transfer limits.', 'code' => 'PACKAGE_TOO_LARGE');
    }
    $init = wp_doctor_ai_remote_post('/api/connector/backup-transfer/' . rawurlencode($job_id) . '/init', array(
        'totalChunks' => $total_chunks,
        'totalBytes' => $total_bytes,
        'totalSha256' => hash('sha256', $data),
    ), $credential);
    if (!$init['ok']) {
        return $init;
    }
    for ($i = 0; $i < $total_chunks; $i++) {
        $chunk = substr($data, $i * $chunk_size, $chunk_size);
        $sent = wp_doctor_ai_remote_post('/api/connector/backup-transfer/' . rawurlencode($job_id) . '/chunk', array(
            'sequence' => $i,
            'chunkBase64' => base64_encode($chunk),
            'chunkSha256' => hash('sha256', $chunk),
        ), $credential);
        if (!$sent['ok']) {
            return $sent;
        }
    }
    $draft = array(
        'wordpressVersion' => $manifest['wordpressVersion'],
        'phpVersion' => $manifest['phpVersion'],
        'tablePrefix' => $manifest['tablePrefix'],
        'includedCategories' => $manifest['includedCategories'],
        'excludedCategories' => $manifest['excludedCategories'],
        'skippedFiles' => $manifest['skippedFiles'],
        'tableCount' => $manifest['tableCount'],
        'includesWpConfig' => $manifest['includesWpConfig'],
    );
    return wp_doctor_ai_remote_post('/api/connector/backup-transfer/' . rawurlencode($job_id) . '/complete', array(
        'manifest' => $draft,
        'connectorVersion' => WP_DOCTOR_AI_CONNECTOR_VERSION,
    ), $credential);
}

function wp_doctor_ai_backup_run($job_id, $mode, $include_wp_config, $credential) {
    $built = wp_doctor_ai_backup_build_package($job_id, $mode, $include_wp_config);
    if (!$built['ok']) {
        return $built;
    }
    $result = wp_doctor_ai_backup_upload_package($job_id, $built['package'], $built['manifest'], $credential);
    // Temp package is deleted whether the upload succeeded or not: it
    // must never linger in a web-accessible or guessable location.
    if (file_exists($built['package'])) {
        unlink($built['package']);
    }
    if (!$result['ok']) {
        return $result;
    }
    update_option('wp_doctor_ai_last_backup', current_time('mysql') . ' job ' . $job_id . ' mode ' . $mode, false);
    return array('ok' => true, 'data' => $result['data']);
}
