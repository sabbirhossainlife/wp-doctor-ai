<?php
/**
 * Standalone PHP tests for the v6 security-indicators snapshot section
 * (Milestone 12). No WordPress install, no phpunit: only the collector
 * function is exercised, with constants defined/undefined per case.
 * Run: php tests/php-security.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */
define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.5.0');
define('WP_DEBUG', true);
define('WP_DEBUG_DISPLAY', false);
define('DISALLOW_FILE_EDIT', true);
// WP_DEBUG_LOG deliberately NOT defined -> unknown.

require __DIR__ . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php';

$failures = array();
function check($name, $cond) {
    global $failures;
    if (!$cond) { $failures[] = $name; echo "FAIL: $name\n"; }
    else { echo "ok: $name\n"; }
}

$ind = wp_doctor_ai_collect_security_indicators();
check('wpDebug yes when WP_DEBUG true', $ind['wpDebug'] === 'yes');
check('wpDebugDisplay no when WP_DEBUG_DISPLAY false', $ind['wpDebugDisplay'] === 'no');
check('wpDebugLog unknown when undefined', $ind['wpDebugLog'] === 'unknown');
check('disallowFileEdit yes when true', $ind['disallowFileEdit'] === 'yes');
check('exactly four keys, no extras', count($ind) === 4 && isset($ind['wpDebug'], $ind['wpDebugDisplay'], $ind['wpDebugLog'], $ind['disallowFileEdit']));
check('all values are yes/no/unknown', in_array($ind['wpDebug'], array('yes', 'no', 'unknown'), true)
    && in_array($ind['wpDebugDisplay'], array('yes', 'no', 'unknown'), true)
    && in_array($ind['wpDebugLog'], array('yes', 'no', 'unknown'), true)
    && in_array($ind['disallowFileEdit'], array('yes', 'no', 'unknown'), true));

// Static guard: the collector must never read wp-config.php contents,
// options, users, or secrets. (Behavioural proof would need a WP install;
// this source-level assertion is the honest form of the check here.)
$src = file_get_contents(__DIR__ . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php');
$fnStart = strpos($src, 'function wp_doctor_ai_collect_security_indicators');
$fnEnd = strpos($src, 'function wp_doctor_ai_collect_snapshot');
$fnSrc = substr($src, $fnStart, $fnEnd - $fnStart);
check('collector source contains no wp-config read', strpos($fnSrc, 'wp-config') === false);
check('collector source contains no get_option', strpos($fnSrc, 'get_option') === false);
check('collector source contains no user lookup', strpos($fnSrc, 'get_users') === false && strpos($fnSrc, 'wp_get_current_user') === false);
check('snapshot schema is v7', strpos($src, "'schemaVersion' => 7") !== false);

if ($failures) { echo count($failures) . " failure(s)\n"; exit(1); }
echo "all php-security tests passed\n";
