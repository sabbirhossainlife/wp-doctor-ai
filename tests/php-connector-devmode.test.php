<?php
// Dev-mode branch of API-base validation, in its own process because
// PHP constants cannot be redefined. Run: php tests/php-connector-devmode.test.php
define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_DEV_MODE', true);
require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-api-base.php';

$passed = 0;
$failed = 0;
function check($name, $cond) {
    global $passed, $failed;
    if ($cond) { $passed++; echo "ok - $name\n"; }
    else { $failed++; echo "FAIL - $name\n"; }
}

$r = wp_doctor_ai_validate_api_base('http://127.0.0.1:3000');
check('dev: loopback http allowed', $r['valid'] === true && $r['base'] === 'http://127.0.0.1:3000');
$r = wp_doctor_ai_validate_api_base('http://localhost:8080');
check('dev: localhost http allowed', $r['valid'] === true);
$r = wp_doctor_ai_validate_api_base('http://192.168.1.10:3000');
check('dev: non-loopback http still refused', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('https://saas.example.com');
check('dev: https still valid', $r['valid'] === true);
$r = wp_doctor_ai_validate_api_base('http://example.com');
check('dev: public http still refused', $r['valid'] === false);

echo "\n$passed passed, $failed failed\n";
exit($failed > 0 ? 1 : 0);
