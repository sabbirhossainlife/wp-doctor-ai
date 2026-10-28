<?php
/**
 * Standalone PHP tests for the v3 WooCommerce snapshot section (Milestone 7).
 * WooCommerce PRESENT case. No WordPress install, no phpunit: WordPress and
 * WooCommerce functions are stubbed in-memory. Run: php tests/php-woocommerce.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */
define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.2.0');

$GLOBALS['wp_options'] = array(
    'active_plugins' => array('woocommerce/woocommerce.php'),
    'woocommerce_cart_page_id' => 11,
    'woocommerce_checkout_page_id' => 12,
    'woocommerce_myaccount_page_id' => 13,
);
$GLOBALS['wp_plugins_stub'] = array(
    'woocommerce/woocommerce.php' => array('Name' => 'WooCommerce', 'Version' => '11.2.1', 'RequiresWP' => '7.0', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
    'sample/sample.php' => array('Name' => 'Sample', 'Version' => '1.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_posts_stub'] = array(
    11 => (object) array('post_content' => '<!-- wp:woocommerce/cart -->', 'post_status' => 'publish'),
    12 => (object) array('post_content' => '[woocommerce_checkout]', 'post_status' => 'publish'),
    13 => (object) array('post_content' => '[woocommerce_my_account]', 'post_status' => 'draft'),
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
function get_post($id) { return isset($GLOBALS['wp_posts_stub'][$id]) ? $GLOBALS['wp_posts_stub'][$id] : null; }
function get_post_status($post) { return $post->post_status; }
function has_block($name, $post = null) {
    if (!$post || !isset($post->post_content)) { return false; }
    return strpos($post->post_content, '<!-- wp:' . $name) !== false;
}
function has_shortcode($content, $tag) { return strpos($content, '[' . $tag) !== false; }
class WpStubThemeWoo { public function get($k) { return $k === 'Name' ? 'Theme' : '1.0'; } public function parent() { return null; } }
function wp_get_theme() { return new WpStubThemeWoo(); }

class WcGatewayStub {
    public $id; public $title; public $enabled; public $settings;
    public function __construct($id, $title, $enabled) { $this->id = $id; $this->title = $title; $this->enabled = $enabled; $this->settings = array('secret_key' => 'must-never-appear'); }
    public function get_title() { return $this->title; }
}
class WcRegistryStub {
    public function payment_gateways() {
        return array(new WcGatewayStub('cod', 'Cash on delivery', 'yes'), new WcGatewayStub('bacs', 'Direct bank transfer', 'no'));
    }
}
class WcStub { public $version = '11.2.1'; public function payment_gateways() { return new WcRegistryStub(); } }
function WC() { return new WcStub(); }

require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php';
require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-malware.php';

$passed = 0; $failed = 0;
function check($name, $cond) { global $passed, $failed; if ($cond) { $passed++; echo "ok - $name\n"; } else { $failed++; echo "FAIL - $name\n"; } }

$snap = wp_doctor_ai_collect_snapshot();
check('schema is v7 (v6 fields still present)', $snap['schemaVersion'] === 7 && isset($snap['woocommerce']) && isset($snap['contactForms']) && isset($snap['securityIndicators']) && isset($snap['malwareScan']));
check('v2 fields still present', isset($snap['plugins']) && isset($snap['theme']));
$woo = $snap['woocommerce'];
check('WooCommerce AVAILABLE', $woo['status'] === 'AVAILABLE' && $woo['installed'] === true && $woo['active'] === true);
check('WooCommerce version from WC()', $woo['version'] === '11.2.1');
check('cart page is block + publish', $woo['pages']['cart']['pageId'] === 11 && $woo['pages']['cart']['implementation'] === 'block' && $woo['pages']['cart']['status'] === 'publish');
check('checkout page is classic-shortcode + publish', $woo['pages']['checkout']['pageId'] === 12 && $woo['pages']['checkout']['implementation'] === 'classic-shortcode' && $woo['pages']['checkout']['status'] === 'publish');
check('myAccount page is classic-shortcode + draft (never block)', $woo['pages']['myAccount']['implementation'] === 'classic-shortcode' && $woo['pages']['myAccount']['status'] === 'draft');
check('gateways listed with enabled flags', count($woo['gateways']) === 2 && $woo['gateways'][0]['id'] === 'cod' && $woo['gateways'][0]['enabled'] === true && $woo['gateways'][1]['enabled'] === false);
check('gateway titles from get_title()', $woo['gateways'][0]['title'] === 'Cash on delivery');
check('gateway availability is null (not guessed from enabled)', $woo['gateways'][0]['available'] === null);
check('gateway block compatibility is UNKNOWN, never invented', $woo['gateways'][0]['blockCompatibility'] === 'UNKNOWN' && $woo['gateways'][0]['blockCompatibilitySource'] === 'not-determined');
$json = json_encode($snap);
check('no gateway settings in snapshot', strpos($json, 'must-never-appear') === false && strpos($json, 'secret_key') === false);
check('no page bodies in snapshot', strpos($json, 'wp:woocommerce/cart') === false && strpos($json, 'woocommerce_checkout]') === false);

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
