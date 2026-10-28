<?php
/**
 * Standalone PHP tests for the v5 contact-form / mail-transport snapshot
 * section (Milestone 11). No WordPress install, no phpunit: WordPress and
 * Contact Form 7 functions are stubbed in-memory.
 * Run: php tests/php-contact-email.test.php
 * Exit code 0 = all pass, 1 = any failure.
 */
define('ABSPATH', '/tmp/wp-stub/');
define('WP_DOCTOR_AI_CONNECTOR_VERSION', '1.4.0');

$GLOBALS['wp_options'] = array(
    'active_plugins' => array('contact-form-7/wp-contact-form-7.php', 'wp-mail-smtp/wp_mail_smtp.php'),
    // WP Mail SMTP option: mailer + from_email + smtp host present, plus
    // SENTINEL secrets that must NEVER appear in collector output.
    'wp_mail_smtp' => array(
        'mail' => array('from_email' => 'hello@example.com', 'mailer' => 'smtp'),
        'smtp' => array(
            'host' => 'smtp.example.com',
            'user' => 'smtp-user@example.com',
            'pass' => 'SENTINEL_SMTP_PASSWORD_XYZ',
            'auth' => true,
        ),
        'sendgrid' => array('api_key' => 'SENTINEL_SENDGRID_KEY_XYZ'),
    ),
);
$GLOBALS['wp_plugins_stub'] = array(
    'contact-form-7/wp-contact-form-7.php' => array('Name' => 'Contact Form 7', 'Version' => '6.2.3', 'RequiresWP' => '7.1', 'RequiresPHP' => '8.3', 'RequiresPlugins' => ''),
    'wp-mail-smtp/wp_mail_smtp.php' => array('Name' => 'WP Mail SMTP', 'Version' => '4.0.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
    'wpforms/wpforms.php' => array('Name' => 'WPForms', 'Version' => '1.9.0', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);

// CF7 stub: two forms — one fully configured with a literal sender, one
// with a mail-tag sender and an EMPTY recipient (incomplete notification).
class Wpcf7FormStub {
    private $mail;
    public function __construct($mail) { $this->mail = $mail; }
    public function prop($name) { return $name === 'mail' ? $this->mail : null; }
}
class WPCF7_ContactForm {
    public static function find($args = '') {
        return array(
            new Wpcf7FormStub(array('sender' => 'hello@example.com', 'recipient' => '[_site_admin_email]', 'subject' => 'x', 'body' => 'y')),
            new Wpcf7FormStub(array('sender' => '[your-name] <[your-email]>', 'recipient' => '', 'subject' => 'x', 'body' => 'y')),
        );
    }
}

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
class WpStubThemeCe { public function get($k) { return $k === 'Name' ? 'Theme' : '1.0'; } public function parent() { return null; } }
function wp_get_theme() { return new WpStubThemeCe(); }

require dirname(__FILE__) . '/../wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php';

$passed = 0;
$failed = 0;
function check($name, $cond) {
    global $passed, $failed;
    if ($cond) { $passed++; echo "ok - $name\n"; }
    else { $failed++; echo "FAIL - $name\n"; }
}

$snap = wp_doctor_ai_collect_snapshot();
check('schema is v7', $snap['schemaVersion'] === 7);
check('v5 keys present', isset($snap['contactForms']) && isset($snap['mailTransport']) && isset($snap['senderDomain']));

$cf7 = null;
$wpforms = null;
foreach ($snap['contactForms'] as $entry) {
    if ($entry['pluginId'] === 'contact-form-7') { $cf7 = $entry; }
    if ($entry['pluginId'] === 'wpforms') { $wpforms = $entry; }
}
check('cf7 entry present, active, COMPLETE', $cf7 !== null && $cf7['active'] === true && $cf7['coverage'] === 'COMPLETE');
check('cf7 forms counted (2)', $cf7 !== null && $cf7['formsCount'] === 2);
check('cf7 notification: one complete + one incomplete form -> PARTIAL', $cf7 !== null && $cf7['mailConfigStatus'] === 'PARTIAL');
check('wpforms recognised but UNSUPPORTED, no counts claimed', $wpforms !== null && $wpforms['coverage'] === 'UNSUPPORTED' && $wpforms['formsCount'] === null);

$smtp = null;
foreach ($snap['mailTransport'] as $entry) {
    if ($entry['pluginId'] === 'wp-mail-smtp') { $smtp = $entry; }
}
check('wp-mail-smtp entry present, active, PARTIAL', $smtp !== null && $smtp['active'] === true && $smtp['coverage'] === 'PARTIAL');
check('wp-mail-smtp mailer identifier only', $smtp !== null && $smtp['mailer'] === 'smtp');
check('wp-mail-smtp sender domain only, never full address', $smtp !== null && $smtp['senderDomain'] === 'example.com');
check('wp-mail-smtp required fields complete (from + host present)', $smtp !== null && $smtp['requiredFieldsComplete'] === 'yes');

check('senderDomain block is domain-only', $snap['senderDomain']['senderDomain'] === 'example.com' && $snap['senderDomain']['comparisonEstablished'] === false);

$json = json_encode($snap);
check('no sentinel secret in snapshot', strpos($json, 'SENTINEL_SMTP_PASSWORD_XYZ') === false && strpos($json, 'SENTINEL_SENDGRID_KEY_XYZ') === false);
check('no smtp host/username in snapshot', strpos($json, 'smtp.example.com') === false && strpos($json, 'smtp-user@example.com') === false);
check('no recipient address or subject/body in snapshot', strpos($json, '[_site_admin_email]') === false && strpos($json, '[your-email]') === false);
check('no form submissions/entries keys', strpos($json, 'submission') === false && strpos($json, 'entries') === false);

// Inactive-plugin case: CF7 deactivated -> no enumeration, no invented count.
$GLOBALS['wp_options']['active_plugins'] = array('wp-mail-smtp/wp_mail_smtp.php');
$snap2 = wp_doctor_ai_collect_snapshot();
$cf7b = null;
foreach ($snap2['contactForms'] as $entry) {
    if ($entry['pluginId'] === 'contact-form-7') { $cf7b = $entry; }
}
check('inactive cf7: active false, formsCount null (never invented)', $cf7b !== null && $cf7b['active'] === false && $cf7b['formsCount'] === null);

// No recognised form plugin at all -> single unknown UNSUPPORTED entry.
$GLOBALS['wp_plugins_stub'] = array(
    'akismet/akismet.php' => array('Name' => 'Akismet', 'Version' => '5.3', 'RequiresWP' => '', 'RequiresPHP' => '', 'RequiresPlugins' => ''),
);
$GLOBALS['wp_options']['active_plugins'] = array('akismet/akismet.php');
$snap3 = wp_doctor_ai_collect_snapshot();
$unknown = null;
foreach ($snap3['contactForms'] as $entry) {
    if ($entry['pluginId'] === 'unknown') { $unknown = $entry; }
}
check('no recognised form plugin -> unknown UNSUPPORTED entry (never "no forms")', $unknown !== null && $unknown['coverage'] === 'UNSUPPORTED');

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
