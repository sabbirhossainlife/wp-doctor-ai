<?php
/**
 * Standalone PHP tests for the WP Doctor AI Connector plugin.
 * No WordPress install, no phpunit required: WordPress functions are
 * stubbed in-memory. Run: php tests/php-connector.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */

// ---- Minimal WordPress stubs ----
define('ABSPATH', '/tmp/wp-stub/');

$GLOBALS['wp_options'] = array();
$GLOBALS['wp_can_manage'] = true;
$GLOBALS['wp_nonce_ok'] = true;
$GLOBALS['wp_remote_response'] = null;
$GLOBALS['wp_remote_last_args'] = null;
$GLOBALS['wp_plugins_stub'] = array();
$GLOBALS['wp_active_plugins_stub'] = array();
$GLOBALS['wp_theme_stub'] = null;
$GLOBALS['wp_multisite_stub'] = false;

function plugin_dir_path($file) { return dirname($file) . '/'; }
function add_action($hook, $cb) {}
function add_menu_page($a, $b, $c, $d, $e, $f = '', $g = null) {}
function get_option($k, $default = false) {
    return array_key_exists($k, $GLOBALS['wp_options']) ? $GLOBALS['wp_options'][$k] : $default;
}
function update_option($k, $v, $autoload = null) {
    $GLOBALS['wp_options'][$k] = $v;
    $GLOBALS['wp_options_autoload'][$k] = $autoload;
    return true;
}
function delete_option($k) { unset($GLOBALS['wp_options'][$k]); return true; }
function current_user_can($cap) { return $GLOBALS['wp_can_manage']; }
function check_admin_referer($action) {
    if (!$GLOBALS['wp_nonce_ok']) { throw new Exception('bad nonce'); }
    return true;
}
function wp_die($msg) { throw new Exception('wp_die: ' . $msg); }
function sanitize_text_field($s) { return trim(strip_tags((string) $s)); }
function sanitize_key($s) { return strtolower(preg_replace('/[^a-zA-Z0-9_\-]/', '', (string) $s)); }
function wp_unslash($v) { return is_string($v) ? stripslashes($v) : $v; }
function esc_html($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
function esc_attr($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
function esc_url($s) { return (string) $s; }
function wp_nonce_field($action) { return '<input type="hidden" name="_wpnonce" value="stub" />'; }
function submit_button($text = '', $type = 'primary', $name = 'submit', $wrap = true) { return '<button>' . $text . '</button>'; }
function current_time($type) { return '2026-10-27 12:00:00'; }
function home_url() { return 'https://example.com'; }
function site_url() { return 'https://example.com'; }
function get_bloginfo($what) { return $what === 'version' ? '6.8' : ''; }
function get_locale() { return 'en_US'; }
function is_multisite() { return $GLOBALS['wp_multisite_stub']; }
function get_plugins() { return $GLOBALS['wp_plugins_stub']; }
function get_site_option($k, $default = false) { return $default; }
class WpStubTheme {
    private $data;
    public function __construct($data) { $this->data = $data; }
    public function get($k) { return isset($this->data[$k]) ? $this->data[$k] : ''; }
    public function get_stylesheet() { return isset($this->data['Stylesheet']) ? $this->data['Stylesheet'] : ''; }
}
function wp_get_theme() { return new WpStubTheme($GLOBALS['wp_theme_stub'] ?: array('Name' => '', 'Version' => '')); }
function wp_generate_password($len, $special = true, $extra = false) { return str_repeat('x', $len); }
function wp_json_encode($v) { return json_encode($v); }
function is_wp_error($t) { return $t instanceof WP_ErrorStub; }
class WP_ErrorStub {}
function wp_remote_post($url, $args) {
    $GLOBALS['wp_remote_last_args'] = array('url' => $url, 'args' => $args);
    if ($GLOBALS['wp_remote_response'] instanceof WP_ErrorStub) { return $GLOBALS['wp_remote_response']; }
    return $GLOBALS['wp_remote_response'];
}
function wp_remote_retrieve_body($r) { return isset($r['body']) ? $r['body'] : ''; }
function wp_remote_retrieve_response_code($r) { return isset($r['response']['code']) ? $r['response']['code'] : 0; }

// Endpoint constant for these tests (production https).
define('WP_DOCTOR_AI_API_BASE_URL', 'https://saas.example.com');

require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/wp-doctor-ai-connector.php';

// ---- Tiny test harness ----
$passed = 0;
$failed = 0;
function check($name, $cond) {
    global $passed, $failed;
    if ($cond) { $passed++; echo "ok - $name\n"; }
    else { $failed++; echo "FAIL - $name\n"; }
}
function reset_options() {
    $GLOBALS['wp_options'] = array();
    $GLOBALS['wp_options_autoload'] = array();
}

// 1. API base URL validation.
$r = wp_doctor_ai_validate_api_base('https://saas.example.com');
check('api base: https valid', $r['valid'] === true && $r['base'] === 'https://saas.example.com');
$r = wp_doctor_ai_validate_api_base('https://saas.example.com:8443');
check('api base: unexpected port rejected', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('http://saas.example.com');
check('api base: http rejected in production mode', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('https://user:pass@saas.example.com');
check('api base: credentials rejected', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('https://saas.example.com/?x=1');
check('api base: query rejected', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('https://saas.example.com/#frag');
check('api base: fragment rejected', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('');
check('api base: missing rejected', $r['valid'] === false);
$r = wp_doctor_ai_validate_api_base('ftp://saas.example.com');
check('api base: ftp rejected', $r['valid'] === false);
// Dev exception is a separate function path: validate with dev mode via
// a direct call using a locally-defined constant is impossible after
// load (constants are immutable), so the dev branch is covered by
// inspecting the function: loopback http must fail without dev mode.
$r = wp_doctor_ai_validate_api_base('http://127.0.0.1:3000');
check('api base: loopback http refused without dev mode', $r['valid'] === false);

// 2. Snapshot collector: allowlist only, unavailable reported, no secrets.
$GLOBALS['wp_plugins_stub'] = array(
    'akismet/akismet.php' => array('Name' => 'Akismet', 'Version' => '5.3'),
    'hello.php' => array('Name' => 'Hello Dolly', 'Version' => '1.7'),
);
$GLOBALS['wp_active_plugins_stub'] = array('akismet/akismet.php');
// Collector reads get_option('active_plugins'); seed it.
update_option('active_plugins', array('akismet/akismet.php'));
$GLOBALS['wp_theme_stub'] = array('Name' => 'Twenty Twenty-Five', 'Version' => '1.0', 'Stylesheet' => 'twentytwentyfive');
// Milestone 13: collector emits schema v7 (v6 fields + malwareScan) while
// keeping all v1-v6 fields, so the exact-allowlist assertion tracks v7.
// In this stub environment wp_remote_get is absent, so the malware scan
// cannot fetch checksums and the stub root does not exist: malwareScan
// is present with status FAILED (honest "not performed", never clean).
$snap = wp_doctor_ai_collect_snapshot();
check('snapshot: exact allowlist keys (v7)', array_keys($snap) === array('schemaVersion', 'wordpressVersion', 'phpVersion', 'homeUrl', 'siteUrl', 'pluginVersion', 'activePlugins', 'activeTheme', 'multisite', 'locale', 'plugins', 'theme', 'woocommerce', 'elementor', 'environment', 'contactForms', 'mailTransport', 'senderDomain', 'securityIndicators', 'malwareScan'));
check('snapshot: schema v7 (v6 fields still present)', $snap['schemaVersion'] === 7 && isset($snap['woocommerce']) && isset($snap['elementor']) && isset($snap['environment']) && isset($snap['contactForms']) && isset($snap['mailTransport']) && isset($snap['senderDomain']) && isset($snap['securityIndicators']) && isset($snap['malwareScan']));
check('snapshot: theme slug from stylesheet (v7)', $snap['theme']['slug'] === 'twentytwentyfive');
check('snapshot: malware scan present but honestly failed in stub env', is_array($snap['malwareScan']) && $snap['malwareScan']['status'] === 'FAILED' && $snap['malwareScan']['coverage']['filesInspected'] === 0);
check('snapshot: no email/username/password keys', strpos(json_encode($snap), 'email') === false && strpos(json_encode($snap), 'password') === false);
check('snapshot: active plugin mapped', count($snap['activePlugins']) === 1 && $snap['activePlugins'][0]['name'] === 'Akismet' && $snap['activePlugins'][0]['version'] === '5.3');
check('snapshot: theme mapped', $snap['activeTheme']['name'] === 'Twenty Twenty-Five');
check('snapshot: wp version from bloginfo', $snap['wordpressVersion'] === '6.8');
check('snapshot: multisite false by default', $snap['multisite'] === false);

// 3. Credential storage with autoload disabled.
reset_options();
wp_doctor_ai_store_credential('secret-credential-value');
check('credential: stored and retrievable', wp_doctor_ai_get_credential() === 'secret-credential-value');
check('credential: autoload disabled', $GLOBALS['wp_options_autoload']['wp_doctor_ai_credential'] === false);

// 4. Admin page: capability gating + credential never rendered.
reset_options();
wp_doctor_ai_store_credential('top-secret-credential');
$GLOBALS['wp_can_manage'] = false;
$_SERVER['REQUEST_METHOD'] = 'GET';
$thrown = false;
try { wp_doctor_ai_connector_render_admin_page(); } catch (Exception $e) { $thrown = true; }
check('admin: insufficient capability blocked', $thrown === true);
$GLOBALS['wp_can_manage'] = true;
ob_start();
wp_doctor_ai_connector_render_admin_page();
$html = ob_get_clean();
check('admin: renders status page', strpos($html, 'WP Doctor AI Connector') !== false);
check('admin: credential never in HTML', strpos($html, 'top-secret-credential') === false);
check('admin: endpoint shown read-only', strpos($html, 'https://saas.example.com') !== false);

// 5. Pair handler: success stores credential, failure does not; body allowlist.
reset_options();
$GLOBALS['wp_remote_response'] = array('body' => json_encode(array('credential' => 'new-cred-123', 'websiteId' => 'w1')), 'response' => array('code' => 200));
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = array('wp_doctor_ai_action' => 'pair', 'wp_doctor_ai_code' => '  ABCDEF123456  ', 'wp_doctor_ai_consent' => '1');
wp_doctor_ai_connector_handle_post();
check('pair: credential stored on success', wp_doctor_ai_get_credential() === 'new-cred-123');
check('pair: status connected', wp_doctor_ai_get_status() === 'connected');
$sent = json_decode($GLOBALS['wp_remote_last_args']['args']['body'], true);
check('pair: request body allowlist only', array_keys($sent) === array('code', 'homeUrl', 'siteUrl', 'pluginVersion'));
check('pair: code lowercased+trimmed', $sent['code'] === 'abcdef123456');
check('pair: redirects disabled', $GLOBALS['wp_remote_last_args']['args']['redirection'] === 0);
check('pair: TLS verification on', $GLOBALS['wp_remote_last_args']['args']['sslverify'] === true);
check('pair: no Authorization header on pair request', !isset($GLOBALS['wp_remote_last_args']['args']['headers']['Authorization']));
check('pair: target is configured base only', strpos($GLOBALS['wp_remote_last_args']['url'], 'https://saas.example.com/api/connector/pair') === 0);

// Pair without consent is refused and does not call the API.
reset_options();
$GLOBALS['wp_remote_last_args'] = null;
$_POST = array('wp_doctor_ai_action' => 'pair', 'wp_doctor_ai_code' => 'somecode');
wp_doctor_ai_connector_handle_post();
check('pair: consent required', wp_doctor_ai_get_credential() === '' && $GLOBALS['wp_remote_last_args'] === null);

// Pair failure: safe error stored, no credential.
reset_options();
$GLOBALS['wp_remote_response'] = array('body' => json_encode(array('error' => 'The pairing code is invalid.', 'code' => 'PAIRING_CODE_INVALID')), 'response' => array('code' => 400));
$_POST = array('wp_doctor_ai_action' => 'pair', 'wp_doctor_ai_code' => 'badcode', 'wp_doctor_ai_consent' => '1');
wp_doctor_ai_connector_handle_post();
check('pair: failure stores no credential', wp_doctor_ai_get_credential() === '');
check('pair: failure error message stored', wp_doctor_ai_get_last_error() === 'The pairing code is invalid.');

// 6. Snapshot send: Bearer + timestamp + nonce headers; revoked clears state.
reset_options();
wp_doctor_ai_store_credential('live-cred');
wp_doctor_ai_set_status('connected');
$GLOBALS['wp_remote_response'] = array('body' => json_encode(array('ok' => true)), 'response' => array('code' => 200));
$_POST = array('wp_doctor_ai_action' => 'snapshot');
wp_doctor_ai_connector_handle_post();
$headers = $GLOBALS['wp_remote_last_args']['args']['headers'];
check('snapshot: Bearer header sent', $headers['Authorization'] === 'Bearer live-cred');
check('snapshot: timestamp + nonce headers sent', isset($headers['X-WPDoctor-Timestamp']) && isset($headers['X-WPDoctor-Nonce']) && strlen($headers['X-WPDoctor-Nonce']) >= 16);
check('snapshot: last sync recorded', wp_doctor_ai_get_last_sync() !== '');

$GLOBALS['wp_remote_response'] = array('body' => json_encode(array('error' => 'This connection has been revoked.', 'code' => 'CONNECTOR_REVOKED')), 'response' => array('code' => 403));
$_POST = array('wp_doctor_ai_action' => 'snapshot');
wp_doctor_ai_connector_handle_post();
check('snapshot: revoked clears credential', wp_doctor_ai_get_credential() === '');
check('snapshot: revoked status set', wp_doctor_ai_get_status() === 'revoked');

// 7. Disconnect clears local state.
reset_options();
wp_doctor_ai_store_credential('cred-to-clear');
wp_doctor_ai_set_status('connected');
$_POST = array('wp_doctor_ai_action' => 'disconnect');
wp_doctor_ai_connector_handle_post();
check('disconnect: credential cleared', wp_doctor_ai_get_credential() === '');
check('disconnect: status disconnected', wp_doctor_ai_get_status() === 'disconnected');

echo "\n$passed passed, $failed failed\n";
exit($failed > 0 ? 1 : 0);
