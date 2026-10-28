<?php
/**
 * Standalone PHP tests for the Milestone 14 backup exporter.
 * No WordPress install, no phpunit: the exporter is exercised against
 * isolated temp-directory fixtures. Fixture files are NEVER executed —
 * they are only zipped by ZipArchive. Run: php tests/php-backup.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */
$root = sys_get_temp_dir() . '/wp-doctor-backup-fixture';
define('ABSPATH', $root . '/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.7.0');
define('ARRAY_N', 'ARRAY_N');

function wp_normalize_path($p) { return str_replace('\\', '/', $p); }
function get_bloginfo($k) { return $k === 'version' ? '7.1.3' : ''; }
function home_url() { return 'https://fixture.example'; }
function site_url() { return 'https://fixture.example'; }
function get_temp_dir() { return sys_get_temp_dir() . '/'; }
function sanitize_file_name($n) { return preg_replace('/[^A-Za-z0-9_.-]/', '_', $n); }
function wp_generate_password($l, $s, $e) { return substr(str_repeat('aB3', 10), 0, $l); }
function wp_json_encode($v) { return json_encode($v); }
function is_multisite() { return false; }
function esc_sql($v) { return addslashes($v); }

class StubWpdb {
    public $prefix = 'wp_';
    public function get_col($q) { return array('wp_posts', 'wp_options'); }
    public function get_var($q) { return 2; }
    public function get_row($q, $o) {
        if (strpos($q, 'wp_posts') !== false) return array('wp_posts', 'CREATE TABLE wp_posts (id INT)');
        return array('wp_options', 'CREATE TABLE wp_options (id INT)');
    }
    public function get_results($q, $o) {
        if (strpos($q, 'LIMIT 0,') !== false) return array(array(1, 'hello'));
        return array();
    }
    public function _escape($v) { return addslashes($v); }
}
$GLOBALS['wpdb'] = new StubWpdb();

require __DIR__ . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-backup.php';

$failures = array();
function check($name, $cond) {
    global $failures;
    if (!$cond) { $failures[] = $name; echo "FAIL: $name\n"; } else { echo "ok: $name\n"; }
}
function rm_tree($dir) {
    if (!is_dir($dir)) { return; }
    foreach (scandir($dir) as $e) {
        if ($e === '.' || $e === '..') { continue; }
        $p = $dir . '/' . $e;
        if (is_link($p) || is_file($p)) { unlink($p); } else { rm_tree($p); }
    }
    rmdir($dir);
}
rm_tree($root);
mkdir($root . '/wp-admin', 0777, true);
mkdir($root . '/wp-content/plugins/akismet', 0777, true);
mkdir($root . '/wp-content/uploads/2026', 0777, true);
mkdir($root . '/wp-content/cache', 0777, true);
file_put_contents($root . '/index.php', "<?php // index\n");
file_put_contents($root . '/wp-config.php', "<?php define('DB_PASSWORD', 'secret-never-shown');\n");
file_put_contents($root . '/wp-admin/admin.php', "<?php // admin\n");
file_put_contents($root . '/wp-content/plugins/akismet/akismet.php', "<?php // plugin\n");
file_put_contents($root . '/wp-content/uploads/2026/photo.jpg', "fake-jpeg");
file_put_contents($root . '/wp-content/cache/cached.php', "<?php // cache, excluded\n");
symlink($root . '/wp-content/plugins/akismet/akismet.php', $root . '/wp-content/plugins/akismet/link.php');

// FILES_ONLY, wp-config excluded by default.
$built = wp_doctor_ai_backup_build_package('job-test-1', 'FILES_ONLY', false);
check('files-only package builds', $built['ok'] === true);
$zip = new ZipArchive();
check('zip opens', $zip->open($built['package']) === true);
$names = array();
for ($i = 0; $i < $zip->numFiles; $i++) { $names[] = $zip->getNameIndex($i); }
sort($names);
check('manifest present', in_array('manifest.json', $names, true));
check('wp-config excluded by default', !in_array('wp-config.php', $names, true));
check('cache excluded', !in_array('wp-content/cache/cached.php', $names, true));
check('symlink skipped', !in_array('wp-content/plugins/akismet/link.php', $names, true));
check('plugin file included', in_array('wp-content/plugins/akismet/akismet.php', $names, true));
check('upload included', in_array('wp-content/uploads/2026/photo.jpg', $names, true));
check('no database.sql in files-only', !in_array('database.sql', $names, true));
check('no traversal entries', !in_array('../evil.php', $names, true));
$manifest = json_decode($zip->getFromName('manifest.json'), true);
check('manifest mode', $manifest['mode'] === 'FILES_ONLY');
check('manifest excludes wp-config category', in_array('wp-config.php', $manifest['excludedCategories'], true));
check('manifest never contains config secret', strpos($zip->getFromName('manifest.json'), 'secret-never-shown') === false);
$zip->close();
unlink($built['package']);

// Opt-in includes wp-config (same-site recovery only).
$built2 = wp_doctor_ai_backup_build_package('job-test-2', 'FILES_ONLY', true);
$zip2 = new ZipArchive(); $zip2->open($built2['package']);
$names2 = array();
for ($i = 0; $i < $zip2->numFiles; $i++) { $names2[] = $zip2->getNameIndex($i); }
check('wp-config included only with explicit opt-in', in_array('wp-config.php', $names2, true));
$zip2->close(); unlink($built2['package']);

// SITE_DATA_BACKUP includes database.sql + core dirs.
$built3 = wp_doctor_ai_backup_build_package('job-test-3', 'SITE_DATA_BACKUP', false);
$zip3 = new ZipArchive(); $zip3->open($built3['package']);
$names3 = array();
for ($i = 0; $i < $zip3->numFiles; $i++) { $names3[] = $zip3->getNameIndex($i); }
check('site-data includes database.sql', in_array('database.sql', $names3, true));
check('site-data includes wp-admin', in_array('wp-admin/admin.php', $names3, true));
check('db sql has create + insert', strpos($zip3->getFromName('database.sql'), 'CREATE TABLE wp_posts') !== false && strpos($zip3->getFromName('database.sql'), 'INSERT INTO') !== false);
$zip3->close(); unlink($built3['package']);

// Invalid mode + static safety: collected files are never executed.
$bad = wp_doctor_ai_backup_build_package('job-test-4', 'EVERYTHING', false);
check('invalid mode rejected', $bad['ok'] === false);
$src = file_get_contents(__DIR__ . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-backup.php');
check('no eval of collected files', strpos($src, 'eval(') === false);
check('no shell execution', strpos($src, 'shell_exec') === false && strpos($src, 'passthru') === false);
check('no include of collected files', strpos($src, 'include $file') === false && strpos($src, 'require $file') === false);
rm_tree($root);

if (!empty($failures)) { echo count($failures) . " failures\n"; exit(1); }
echo "all php-backup tests passed\n";
