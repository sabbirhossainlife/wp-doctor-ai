<?php
/**
 * Standalone PHP tests for the v2 diagnostic snapshot collector (Milestone 6).
 * No WordPress install, no phpunit required: WordPress functions are stubbed
 * in-memory. Run: php tests/php-conflict.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */

define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.1.0');

$GLOBALS['wp_options'] = array();
$GLOBALS['wp_plugins_stub'] = array();
$GLOBALS['wp_mu_plugins_stub'] = array();
$GLOBALS['wp_theme_stub'] = null;
$GLOBALS['wp_theme_parent_stub'] = null;
$GLOBALS['wp_multisite_stub'] = false;
$GLOBALS['wp_sitewide_stub'] = array();
$GLOBALS['wp_update_transient'] = null;

function get_option($k, $default = false) {
    return array_key_exists($k, $GLOBALS['wp_options']) ? $GLOBALS['wp_options'][$k] : $default;
}
function get_site_option($k, $default = false) {
    if ($k === 'active_sitewide_plugins') { return $GLOBALS['wp_sitewide_stub']; }
    return $default;
}
function get_site_transient($k) {
    if ($k === 'update_plugins') { return $GLOBALS['wp_update_transient']; }
    return false;
}
function get_plugins() { return $GLOBALS['wp_plugins_stub']; }
function get_mu_plugins() { return $GLOBALS['wp_mu_plugins_stub']; }
function is_multisite() { return $GLOBALS['wp_multisite_stub']; }
function get_bloginfo($what) { return $what === 'version' ? '6.8' : ''; }
function home_url() { return 'https://example.com'; }
function site_url() { return 'https://example.com'; }
function get_locale() { return 'en_US'; }
class WpStubTheme2 {
    private $data; private $parent;
    public function __construct($data, $parent = null) { $this->data = $data; $this->parent = $parent; }
    public function get($k) { return isset($this->data[$k]) ? $this->data[$k] : ''; }
    public function parent() { return $this->parent; }
}
function wp_get_theme() {
    $parent = null;
    if ($GLOBALS['wp_theme_parent_stub']) {
        $parent = new WpStubTheme2($GLOBALS['wp_theme_parent_stub']);
    }
    return new WpStubTheme2($GLOBALS['wp_theme_stub'] ?: array('Name' => '', 'Version' => ''), $parent);
}

require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php';
require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-malware.php';

$passed = 0;
$failed = 0;
function check($name, $cond) {
    global $passed, $failed;
    if ($cond) { $passed++; echo "ok - $name\n"; }
    else { $failed++; echo "FAIL - $name\n"; }
}

// Fixture: active plugin with full headers, inactive plugin, network plugin,
// mu plugin, dependency header, update transient.
$GLOBALS['wp_plugins_stub'] = array(
    'akismet/akismet.php' => array('Name' => 'Akismet', 'Version' => '5.3', 'RequiresWP' => '6.0', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
    'main/main.php' => array('Name' => 'Main', 'Version' => '1.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => 'helper, other-plugin'),
    'helper/helper.php' => array('Name' => 'Helper', 'Version' => '2.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
    'off/off.php' => array('Name' => 'Off', 'Version' => '0.9', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_options']['active_plugins'] = array('akismet/akismet.php', 'main/main.php', 'helper/helper.php');
$GLOBALS['wp_multisite_stub'] = true;
$GLOBALS['wp_sitewide_stub'] = array('akismet/akismet.php' => time());
$GLOBALS['wp_mu_plugins_stub'] = array(
    'dropin.php' => array('Name' => 'Dropin', 'Version' => '1.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_theme_stub'] = array('Name' => 'Child Theme', 'Version' => '1.2', 'RequiresWP' => '6.2', 'RequiresPHP' => '8.0');
$GLOBALS['wp_theme_parent_stub'] = array('Name' => 'Parent Theme', 'Version' => '3.0');
$upd = new stdClass();
$upd->last_checked = 1700000000;
$entry = new stdClass();
$entry->new_version = '5.4';
$upd->response = array('akismet/akismet.php' => $entry);
$GLOBALS['wp_update_transient'] = $upd;

$snap = wp_doctor_ai_collect_snapshot();
// Milestone 7: collector emits schema v3 (v2 fields + woocommerce) while
// keeping all v1/v2 fields, so the exact-allowlist assertion tracks v3.
check('v7: schemaVersion is 7 (v2/v3/v4/v5/v6 fields still present)', $snap['schemaVersion'] === 7 && isset($snap['plugins']) && isset($snap['woocommerce']) && isset($snap['contactForms']) && isset($snap['securityIndicators']) && isset($snap['malwareScan']));
check('v7: exact allowlist keys', array_keys($snap) === array('schemaVersion', 'wordpressVersion', 'phpVersion', 'homeUrl', 'siteUrl', 'pluginVersion', 'activePlugins', 'activeTheme', 'multisite', 'locale', 'plugins', 'theme', 'woocommerce', 'elementor', 'environment', 'contactForms', 'mailTransport', 'senderDomain', 'securityIndicators', 'malwareScan'));
check('v3: WooCommerce absent from stubs is NOT_INSTALLED, never a fatal', $snap['woocommerce']['status'] === 'NOT_INSTALLED');
check('v2: pairing compatibility — v1 fields still present', isset($snap['activePlugins']) && isset($snap['activeTheme']) && $snap['activeTheme']['name'] === 'Child Theme');
check('v2: all installed plugins listed incl inactive', count($snap['plugins']) === 5);
$by_slug = array();
foreach ($snap['plugins'] as $p) { $by_slug[$p['slug']] = $p; }
check('v2: active flag', $by_slug['akismet']['active'] === true && $by_slug['off']['active'] === false);
check('v2: networkActive flag', $by_slug['akismet']['networkActive'] === true && $by_slug['main']['networkActive'] === false);
check('v2: muPlugin flag', $by_slug['dropin']['muPlugin'] === true && $by_slug['dropin']['active'] === true);
check('v2: requires headers', $by_slug['akismet']['requiresWP'] === '6.0' && $by_slug['akismet']['requiresPHP'] === '7.4');
check('v2: missing requires header is null, not invented', $by_slug['main']['requiresWP'] === null && $by_slug['main']['requiresPHP'] === null);
check('v2: dependencies parsed from Requires Plugins', $by_slug['main']['dependencies'] === array('helper', 'other-plugin'));
check('v2: empty dependency header is []', $by_slug['akismet']['dependencies'] === array());
check('v2: update from cached transient only', $by_slug['akismet']['updateAvailable'] === true && $by_slug['akismet']['newVersion'] === '5.4' && $by_slug['akismet']['updateCheckedAt'] === 1700000000);
check('v2: no update entry means no update', $by_slug['main']['updateAvailable'] === false && $by_slug['main']['newVersion'] === null);
check('v2: theme parent distinguished', $snap['theme']['parentName'] === 'Parent Theme' && $snap['theme']['parentVersion'] === '3.0' && $snap['theme']['requiresWP'] === '6.2' && $snap['theme']['requiresPHP'] === '8.0');
check('v2: no secrets in payload', strpos(json_encode($snap), 'password') === false && strpos(json_encode($snap), 'email') === false);

// Unparseable dependency header -> [] (never invented).
$GLOBALS['wp_plugins_stub']['main/main.php']['RequiresPlugins'] = 'bad slug!!, helper';
$snap2 = wp_doctor_ai_collect_snapshot();
$main2 = null;
foreach ($snap2['plugins'] as $p) { if ($p['slug'] === 'main') { $main2 = $p; } }
check('v2: unparseable dependency header degrades to []', $main2['dependencies'] === array());

// No update transient -> unavailable, never refreshed by the collector.
$GLOBALS['wp_update_transient'] = false;
$snap3 = wp_doctor_ai_collect_snapshot();
$ak3 = null;
foreach ($snap3['plugins'] as $p) { if ($p['slug'] === 'akismet') { $ak3 = $p; } }
check('v2: missing update transient means unavailable', $ak3['updateAvailable'] === false && $ak3['updateCheckedAt'] === null);

// Static source guarantees: no auto update-check, no log collection,
// no site modification, manual-sync permission unchanged (admin file).
$diag_src = file_get_contents(dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php');
// Comment lines mention the forbidden function by name in prose; strip
// them so the check asserts there is no actual CALL in code.
$code_lines = array();
foreach (explode("\n", $diag_src) as $line) {
    $trim = ltrim($line);
    if (strpos($trim, '*') === 0 || strpos($trim, '//') === 0) { continue; }
    $code_lines[] = $line;
}
check('v2: no auto update-check call', strpos(implode("\n", $code_lines), 'wp_update_plugins') === false);
// Milestone 12 refinement: the v6 collector reads the WP_DEBUG_LOG *constant*
// (a yes/no/unknown flag) — that is not log-file collection. The guard
// therefore bans actual log-file reading (a debug.log path or error_log
// call), not the constant name itself.
check('v2: no log collection', strpos($diag_src, 'debug.log') === false && strpos($diag_src, 'error_log(') === false);
check('v2: no site modification calls', strpos($diag_src, 'deactivate_plugins') === false && strpos($diag_src, 'switch_theme') === false && strpos($diag_src, 'update_option') === false);
$admin_src = file_get_contents(dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-admin.php');
check('v2: manual-sync permission unchanged (manage_options)', strpos($admin_src, 'manage_options') !== false);

echo "\n$passed passed, $failed failed\n";
exit($failed > 0 ? 1 : 0);
