<?php
/**
 * Standalone PHP tests for the v3 WooCommerce section when WooCommerce is
 * ABSENT or INACTIVE (Milestone 7). No WC() function and no WooCommerce
 * class are defined here, so the collector must record the state explicitly
 * and must not call any WooCommerce-only function. Run:
 * php tests/php-woocommerce-no-wc.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */
define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.2.0');

$GLOBALS['wp_options'] = array(
    'active_plugins' => array(),
    'woocommerce_cart_page_id' => 11,
    'woocommerce_checkout_page_id' => 12,
    'woocommerce_myaccount_page_id' => 0,
);
$GLOBALS['wp_plugins_stub'] = array(
    'woocommerce/woocommerce.php' => array('Name' => 'WooCommerce', 'Version' => '11.2.1', 'RequiresWP' => '7.0', 'RequiresPHP' => '7.4', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_posts_stub'] = array(
    11 => (object) array('post_content' => '[woocommerce_cart]', 'post_status' => 'publish'),
    12 => (object) array('post_content' => '', 'post_status' => 'publish'),
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
function has_block($name, $post = null) { return $post && isset($post->post_content) && strpos($post->post_content, '<!-- wp:' . $name) !== false; }
function has_shortcode($content, $tag) { return strpos($content, '[' . $tag) !== false; }
class WpStubThemeNoWoo { public function get($k) { return $k === 'Name' ? 'Theme' : '1.0'; } public function parent() { return null; } }
function wp_get_theme() { return new WpStubThemeNoWoo(); }

require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php';

$passed = 0; $failed = 0;
function check($name, $cond) { global $passed, $failed; if ($cond) { $passed++; echo "ok - $name\n"; } else { $failed++; echo "FAIL - $name\n"; } }

$snap = wp_doctor_ai_collect_snapshot();
$woo = $snap['woocommerce'];
check('installed but inactive is INACTIVE (not AVAILABLE, no fatal)', $woo['status'] === 'INACTIVE' && $woo['installed'] === true && $woo['active'] === false);
check('inactive: version falls back to plugin header', $woo['version'] === '11.2.1');
check('inactive: no gateways collected', $woo['gateways'] === array());
check('inactive: cart page still classified classic-shortcode', $woo['pages']['cart']['implementation'] === 'classic-shortcode');
check('inactive: empty checkout content is unknown implementation', $woo['pages']['checkout']['implementation'] === 'unknown');
check('inactive: unassigned myAccount pageId is null', $woo['pages']['myAccount']['pageId'] === null && $woo['pages']['myAccount']['exists'] === false);

// Now remove WooCommerce from the inventory entirely -> NOT_INSTALLED.
$GLOBALS['wp_plugins_stub'] = array();
$GLOBALS['wp_options']['active_plugins'] = array();
$snap2 = wp_doctor_ai_collect_snapshot();
$woo2 = $snap2['woocommerce'];
check('not installed is NOT_INSTALLED', $woo2['status'] === 'NOT_INSTALLED' && $woo2['installed'] === false && $woo2['active'] === false);
check('not installed: version is null, never invented', $woo2['version'] === null);

// Missing page id -> not-found entry, never a crash.
$GLOBALS['wp_options']['woocommerce_checkout_page_id'] = 99;
$snap3 = wp_doctor_ai_collect_snapshot();
check('assigned page with no post is exists=false', $snap3['woocommerce']['pages']['checkout']['pageId'] === 99 && $snap3['woocommerce']['pages']['checkout']['exists'] === false);

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
