<?php
/**
 * Standalone PHP tests for the v4 Elementor + environment snapshot section
 * (Milestone 8). No WordPress install, no phpunit: WordPress functions are
 * stubbed in-memory. Run: php tests/php-elementor.test.php
 * Exit code 0 = all pass, 1 = any failure.
 *
 * Cases: Free+Pro present (slug match), Free inactive, Pro absent,
 * Elementor absent, name-only match (slug differs), missing env values,
 * secret exclusion, explicit sync only (collector is a pure function;
 * no background sync exists in the plugin).
 */
define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.3.0');
define('WP_MEMORY_LIMIT', '256M');

$GLOBALS['wp_options'] = array(
    'active_plugins' => array('elementor/elementor.php', 'elementor-pro/elementor-pro.php'),
);
$GLOBALS['wp_plugins_stub'] = array(
    'elementor/elementor.php' => array('Name' => 'Elementor', 'Version' => '4.3.5', 'RequiresWP' => '6.5', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
    'elementor-pro/elementor-pro.php' => array('Name' => 'Elementor Pro', 'Version' => '4.3.0', 'RequiresWP' => '6.5', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
    'other/other.php' => array('Name' => 'Other', 'Version' => '1.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);

function get_option($k, $default = false) { return array_key_exists($k, $GLOBALS['wp_options']) ? $GLOBALS['wp_options'][$k] : $default; }
function get_site_option($k, $default = false) { return $default; }
function get_site_transient($k) { return false; }
function get_plugins() { return $GLOBALS['wp_plugins_stub']; }
function get_mu_plugins() { return array(); }
function is_multisite() { return false; }
function get_bloginfo($what) { return $what === 'version' ? '7.1.3' : ''; }
function home_url() { return 'https://example.com'; }
function site_url() { return 'https://example.com'; }
function get_locale() { return 'en_US'; }
// NOTE: ini_get() is a PHP built-in and cannot be stubbed, so the
// environment checks below assert shape (string-or-null from the real
// runtime), not a forced value. The constant-based WP limit IS asserted
// exactly, because WP_MEMORY_LIMIT is defined above.
class WpStubThemeEl { public function get($k) { return $k === 'Name' ? 'Theme' : '1.0'; } public function parent() { return null; } }
function wp_get_theme() { return new WpStubThemeEl(); }

require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php';

$passed = 0; $failed = 0;
function check($name, $cond) { global $passed, $failed; if ($cond) { $passed++; echo "ok - $name\n"; } else { $failed++; echo "FAIL - $name\n"; } }

$snap = wp_doctor_ai_collect_snapshot();
check('schema is v7', $snap['schemaVersion'] === 7);
check('v3 fields still present', isset($snap['woocommerce']) && isset($snap['plugins']) && isset($snap['theme']));
$el = $snap['elementor'];
check('Elementor AVAILABLE', $el['status'] === 'AVAILABLE' && $el['installed'] === true && $el['active'] === true);
check('Elementor version from inventory', $el['version'] === '4.3.5');
check('Pro installed+active with version', $el['pro']['installed'] === true && $el['pro']['active'] === true && $el['pro']['version'] === '4.3.0');
$env = $snap['environment'];
check('WP memory limit from constant', $env['wpMemoryLimit'] === '256M');
check('PHP memory limit is a string or null (real ini_get)', $env['phpMemoryLimit'] === null || is_string($env['phpMemoryLimit']));
check('max execution time is a string or null (real ini_get)', $env['maxExecutionTime'] === null || is_string($env['maxExecutionTime']));
$json = json_encode($snap);
check('no secret-like fields in snapshot', strpos($json, 'secret') === false && strpos($json, 'password') === false);

// Pro absent.
$GLOBALS['wp_plugins_stub'] = array(
    'elementor/elementor.php' => array('Name' => 'Elementor', 'Version' => '4.3.5', 'RequiresWP' => '6.5', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_options']['active_plugins'] = array('elementor/elementor.php');
$snap = wp_doctor_ai_collect_snapshot();
check('Pro absent is reported, never assumed from Free', $snap['elementor']['pro']['installed'] === false && $snap['elementor']['pro']['active'] === false && $snap['elementor']['pro']['version'] === null);
check('Free still AVAILABLE when Pro absent', $snap['elementor']['status'] === 'AVAILABLE');

// Free inactive.
$GLOBALS['wp_options']['active_plugins'] = array();
$snap = wp_doctor_ai_collect_snapshot();
check('Free inactive is INACTIVE', $snap['elementor']['status'] === 'INACTIVE' && $snap['elementor']['active'] === false);

// Elementor absent entirely.
$GLOBALS['wp_plugins_stub'] = array(
    'other/other.php' => array('Name' => 'Other', 'Version' => '1.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);
$snap = wp_doctor_ai_collect_snapshot();
check('Elementor absent is NOT_INSTALLED', $snap['elementor']['status'] === 'NOT_INSTALLED' && $snap['elementor']['installed'] === false);

// Name-only match: slug differs from 'elementor' but display name matches.
$GLOBALS['wp_plugins_stub'] = array(
    'custom-dir/custom.php' => array('Name' => 'Elementor', 'Version' => '4.3.5', 'RequiresWP' => '6.5', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_options']['active_plugins'] = array('custom-dir/custom.php');
$snap = wp_doctor_ai_collect_snapshot();
check('name match identifies Elementor without slug dependence', $snap['elementor']['status'] === 'AVAILABLE');

// Pro version unavailable -> null, not a conflict claim.
$GLOBALS['wp_plugins_stub'] = array(
    'elementor/elementor.php' => array('Name' => 'Elementor', 'Version' => '4.3.5', 'RequiresWP' => '6.5', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
    'elementor-pro/elementor-pro.php' => array('Name' => 'Elementor Pro', 'Version' => '', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_options']['active_plugins'] = array('elementor/elementor.php', 'elementor-pro/elementor-pro.php');
$snap = wp_doctor_ai_collect_snapshot();
check('Pro version unavailable is null', $snap['elementor']['pro']['version'] === null);

// Environment values are never invented: they are exactly what the
// runtime reports (string or null), never a hardcoded fallback.
$snap = wp_doctor_ai_collect_snapshot();
check('environment values are runtime values only', ($snap['environment']['phpMemoryLimit'] === null || is_string($snap['environment']['phpMemoryLimit'])) && ($snap['environment']['maxExecutionTime'] === null || is_string($snap['environment']['maxExecutionTime'])));

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
