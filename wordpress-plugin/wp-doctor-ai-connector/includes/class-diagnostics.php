<?php
/**
 * Read-only diagnostic snapshot collector (schema v4, backward-compatible:
 * v1/v2 consumers ignore the new `woocommerce` key; the server validator
 * still accepts v1 and v2 payloads).
 *
 * Allowlist only. Fields that are unavailable are reported as null /
 * empty — never invented. Nothing here reads user data, post content,
 * option dumps, logs, or secrets of any kind.
 *
 * v2 additions over v1 (v1 fields activePlugins/activeTheme are kept so
 * old consumers keep working):
 *  - plugins[]: ALL installed plugins from get_plugins(), plus must-use
 *    plugins from get_mu_plugins(), each with active/networkActive/muPlugin
 *    flags, header requirements ("Requires at least" / "Requires PHP",
 *    verified against WP 7.1.3 wp-admin/includes/plugin.php), dependencies
 *    ONLY from the WP 6.5+ "Requires Plugins" header (comma-separated
 *    slugs; absent or unparseable -> []), and update info ONLY from the
 *    cached update_plugins site transient (read-only). This collector
 *    NEVER calls wp_update_plugins() or any refresh: missing/stale update
 *    data is reported as unavailable/stale.
 *  - theme: active theme with parent name/version and header requirements
 *    ("Requires at least" / "Requires PHP", verified against WP 7.1.3
 *    wp-includes/class-wp-theme.php).
 *
 * The plugin never performs background sync: the admin page sends a
 * snapshot only when an administrator explicitly requests it.
 *
 * Milestone 12 (schema v6) — Security indicators, derived ONLY from runtime
 * constants via defined(): WP_DEBUG, WP_DEBUG_DISPLAY, WP_DEBUG_LOG,
 * DISALLOW_FILE_EDIT. Each is yes/no/unknown (unknown when the constant
 * is not defined). The plugin NEVER reads wp-config.php contents, option
 * dumps, users, or secrets of any kind for this section.
 *
 * Milestone 13 (schema v7) — theme `slug` (the active theme's stylesheet
 * directory name via wp_get_theme()->get_stylesheet(), a trusted runtime
 * source — display names are never matched as identities) and a bounded
 * sanitized `malwareScan` summary from includes/class-malware.php (local
 * file inspection at sync time; see that file for scope, limits, and
 * privacy exclusions). If the malware scan cannot run, malwareScan is
 * null and the server reports "malware file inspection not performed" —
 * never "no malware".
 *
 * Milestone 8 (schema v4) — Elementor + environment, derived ONLY from the
 * existing plugin inventory and PHP configuration (no new inventory fields,
 * no page/post data, no logs, no secrets):
 *  - Elementor Free matches an inventory entry whose slug is `elementor`
 *    OR whose display name is "Elementor" (case-insensitive); Pro matches
 *    slug `elementor-pro` OR name "Elementor Pro". Slug alone is never the
 *    sole signal, and Pro is never assumed from Free being active. If
 *    get_plugins() is unavailable the status is UNKNOWN; if it ran and no
 *    entry matches, the status is NOT_INSTALLED. A missing Pro version is
 *    reported as null (UNKNOWN), never invented.
 *  - Environment values are CONFIGURED values only: ini_get('memory_limit'),
 *    WP_MEMORY_LIMIT when defined, ini_get('max_execution_time'). They are
 *    not observed runtime availability and never prove memory exhaustion.
 */

if (!defined('ABSPATH')) {
    exit;
}

function wp_doctor_ai_plugin_slug_from_file($plugin_file) {
    if (strpos($plugin_file, '/') !== false) {
        $parts = explode('/', $plugin_file);
        return $parts[0];
    }
    $base = basename($plugin_file);
    if (substr($base, -4) === '.php') {
        $base = substr($base, 0, -4);
    }
    return $base;
}

function wp_doctor_ai_parse_dependencies($header_value) {
    if (!is_string($header_value) || trim($header_value) === '') {
        return array();
    }
    $deps = array();
    foreach (explode(',', $header_value) as $part) {
        $slug = strtolower(trim($part));
        if ($slug === '' || !preg_match('/^[a-z0-9][a-z0-9_\-]*$/', $slug)) {
            // Unparseable header -> no dependencies invented.
            return array();
        }
        $deps[] = $slug;
    }
    return $deps;
}

function wp_doctor_ai_header_or_null($value) {
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    return $value === '' ? null : $value;
}

/**
 * Milestone 7 (schema v3) — WooCommerce read-only section.
 *
 * Verified against WooCommerce 11.2.1 source on local WP 7.1.3:
 *  - Page assignments are single-key options: woocommerce_cart_page_id,
 *    woocommerce_checkout_page_id, woocommerce_myaccount_page_id. Only
 *    those three keys are read — never an option dump.
 *  - Page implementation is classified ONLY from reliably detectable
 *    signals: has_block('woocommerce/cart'|'woocommerce/checkout') and
 *    has_shortcode() for woocommerce_cart / woocommerce_checkout /
 *    woocommerce_my_account. Page bodies are NEVER stored — only the
 *    classification, the page id, and the post status.
 *  - My Account has no block in WC 11.2.1 (searched includes/blocks and
 *    src/Blocks): it is classic-shortcode or unknown, never "block".
 *  - Gateways come ONLY from the registered list
 *    WC()->payment_gateways()->payment_gateways(). Deliberately NOT
 *    get_available_payment_gateways(): its own docblock warns against
 *    admin/REST contexts without a WC session (filters may fatal), so
 *    `available` is null here — not safely determinable in this context,
 *    never guessed from `enabled`. Gateway ->settings is NEVER read
 *    (it holds secrets). No order, customer, transaction, or webhook data.
 *  - Block compatibility: WooCommerce declares cart_checkout_blocks
 *    compatibility per PLUGIN FILE (FeaturesUtil::declare_compatibility),
 *    not per gateway, and that feature's default plugin compatibility in
 *    WC 11.2.1 is COMPATIBLE — so there is no trustworthy gateway-level
 *    mapping in this context. Every gateway is therefore reported
 *    blockCompatibility UNKNOWN / source not-determined. The server
 *    validator and rule engine accept SUPPORTED/UNSUPPORTED for a future
 *    trustworthy source, but this collector never invents them.
 *  - Everything is guarded by function_exists()/class_exists()/
 *    method_exists() checks. If WooCommerce is missing or inactive, that
 *    state is recorded explicitly and no WooCommerce-only function runs.
 */
function wp_doctor_ai_woo_page_entry($option_key, $block_name, $shortcode) {
    $entry = array('pageId' => null, 'exists' => false, 'status' => 'unknown', 'implementation' => 'unknown');
    if (!function_exists('get_option')) {
        return $entry;
    }
    $raw = get_option($option_key, 0);
    if (!is_numeric($raw) || (int) $raw <= 0) {
        return $entry;
    }
    $entry['pageId'] = (int) $raw;
    if (!function_exists('get_post')) {
        return $entry;
    }
    $post = get_post($entry['pageId']);
    if (!$post) {
        return $entry;
    }
    $entry['exists'] = true;
    if (function_exists('get_post_status')) {
        $status = get_post_status($post);
        if (in_array($status, array('publish', 'draft', 'trash', 'private'), true)) {
            $entry['status'] = $status;
        }
    }
    $content = isset($post->post_content) && is_string($post->post_content) ? $post->post_content : '';
    if ($block_name !== null && function_exists('has_block') && has_block($block_name, $post)) {
        $entry['implementation'] = 'block';
    } elseif (function_exists('has_shortcode') && has_shortcode($content, $shortcode)) {
        $entry['implementation'] = 'classic-shortcode';
    }
    return $entry;
}

function wp_doctor_ai_collect_woocommerce($plugins) {
    $wc_available = function_exists('WC') || class_exists('WooCommerce');
    $woo_entry = null;
    if (is_array($plugins)) {
        foreach ($plugins as $p) {
            if (is_array($p) && isset($p['slug']) && $p['slug'] === 'woocommerce') {
                $woo_entry = $p;
                break;
            }
        }
    }
    $installed = $wc_available || $woo_entry !== null;
    $active = $wc_available ? true : ($woo_entry !== null && !empty($woo_entry['active']));
    if ($wc_available) {
        $status = 'AVAILABLE';
    } elseif ($installed) {
        $status = 'INACTIVE';
    } elseif (function_exists('get_plugins')) {
        $status = 'NOT_INSTALLED';
    } else {
        $status = 'UNKNOWN';
    }
    $version = null;
    if ($wc_available && function_exists('WC')) {
        $wc = WC();
        if (is_object($wc) && isset($wc->version) && is_string($wc->version) && $wc->version !== '') {
            $version = $wc->version;
        }
    }
    if ($version === null && $woo_entry !== null && isset($woo_entry['version'])) {
        $version = $woo_entry['version'];
    }
    $gateways = array();
    if ($wc_available && function_exists('WC')) {
        $wc = WC();
        if (is_object($wc) && method_exists($wc, 'payment_gateways')) {
            $registry = $wc->payment_gateways();
            if (is_object($registry) && method_exists($registry, 'payment_gateways')) {
                $registered = $registry->payment_gateways();
                if (is_array($registered)) {
                    foreach ($registered as $gateway) {
                        if (!is_object($gateway) || !isset($gateway->id) || !is_string($gateway->id) || $gateway->id === '') {
                            continue;
                        }
                        $title = $gateway->id;
                        if (method_exists($gateway, 'get_title')) {
                            $t = $gateway->get_title();
                            if (is_string($t) && $t !== '') {
                                $title = $t;
                            }
                        } elseif (isset($gateway->title) && is_string($gateway->title) && $gateway->title !== '') {
                            $title = $gateway->title;
                        }
                        $gateways[] = array(
                            'id' => $gateway->id,
                            'title' => $title,
                            'enabled' => isset($gateway->enabled) && $gateway->enabled === 'yes',
                            // Not safely determinable in the admin sync context (see header).
                            'available' => null,
                            'blockCompatibility' => 'UNKNOWN',
                            'blockCompatibilitySource' => 'not-determined',
                        );
                    }
                }
            }
        }
    }
    return array(
        'installed' => $installed,
        'active' => $active,
        'version' => $version,
        'status' => $status,
        'pages' => array(
            'cart' => wp_doctor_ai_woo_page_entry('woocommerce_cart_page_id', 'woocommerce/cart', 'woocommerce_cart'),
            'checkout' => wp_doctor_ai_woo_page_entry('woocommerce_checkout_page_id', 'woocommerce/checkout', 'woocommerce_checkout'),
            'myAccount' => wp_doctor_ai_woo_page_entry('woocommerce_myaccount_page_id', null, 'woocommerce_my_account'),
        ),
        'gateways' => $gateways,
    );
}

function wp_doctor_ai_elementor_match($entry, $slug, $name) {
    if (!is_array($entry)) {
        return false;
    }
    if (isset($entry['slug']) && is_string($entry['slug']) && strtolower($entry['slug']) === $slug) {
        return true;
    }
    if (isset($entry['name']) && is_string($entry['name']) && strtolower(trim($entry['name'])) === strtolower($name)) {
        return true;
    }
    return false;
}

function wp_doctor_ai_collect_elementor($plugins, $plugins_available) {
    $free = null;
    $pro = null;
    if (is_array($plugins)) {
        foreach ($plugins as $entry) {
            if ($free === null && wp_doctor_ai_elementor_match($entry, 'elementor', 'Elementor')) {
                $free = $entry;
            }
            if ($pro === null && wp_doctor_ai_elementor_match($entry, 'elementor-pro', 'Elementor Pro')) {
                $pro = $entry;
            }
        }
    }
    if (!$plugins_available) {
        $status = 'UNKNOWN';
    } elseif ($free === null) {
        $status = 'NOT_INSTALLED';
    } elseif (!empty($free['active'])) {
        $status = 'AVAILABLE';
    } else {
        $status = 'INACTIVE';
    }
    return array(
        'installed' => $free !== null,
        'active' => $free !== null && !empty($free['active']),
        'version' => ($free !== null && isset($free['version'])) ? $free['version'] : null,
        'pro' => array(
            'installed' => $pro !== null,
            'active' => $pro !== null && !empty($pro['active']),
            'version' => ($pro !== null && isset($pro['version'])) ? $pro['version'] : null,
        ),
        'status' => $status,
    );
}

function wp_doctor_ai_env_string($value) {
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    return $value === '' ? null : $value;
}

function wp_doctor_ai_collect_environment() {
    $wp_memory = null;
    if (defined('WP_MEMORY_LIMIT')) {
        $constant = WP_MEMORY_LIMIT;
        $wp_memory = is_string($constant) ? wp_doctor_ai_env_string($constant) : null;
    }
    return array(
        // Configured limits only — never observed runtime availability.
        'phpMemoryLimit' => function_exists('ini_get') ? wp_doctor_ai_env_string(ini_get('memory_limit')) : null,
        'wpMemoryLimit' => $wp_memory,
        'maxExecutionTime' => function_exists('ini_get') ? wp_doctor_ai_env_string(ini_get('max_execution_time')) : null,
    );
}

/**
 * Milestone 11 (schema v5) — Contact forms + mail transport, read-only.
 *
 * Verified sources:
 *  - Contact Form 7 6.2.3 on local WP 7.1.3: forms are posts of type
 *    `wpcf7_contact_form`; `WPCF7_ContactForm::find()` enumerates them and
 *    `prop('mail')` returns the mail template array with `sender` and
 *    `recipient` keys. Only three facts are extracted per form set: the
 *    count (capped at 200), whether every form has a non-empty sender AND
 *    recipient template, and a sender domain ONLY when a sender template
 *    is a literal email address (mail-tags like [your-email] yield null).
 *    Form titles, recipients, subjects, bodies, and submissions/entries
 *    are NEVER read or sent.
 *  - WP Mail SMTP option schema (published source, fixture-verified only —
 *    NOT installed on local wp-dev, so not live-verified): option key
 *    `wp_mail_smtp`, groups `mail.from_email` / `mail.mailer` and
 *    `smtp.*`. Only the mailer identifier, the from_email DOMAIN, and
 *    presence booleans are extracted. Secret VALUES (smtp password, API
 *    keys, tokens), hosts, and usernames are NEVER copied — presence is
 *    reported as a boolean only, and only to decide whether required
 *    fields appear complete.
 *  - Known form/mail plugins without a verified adapter are reported as
 *    coverage UNSUPPORTED with installed/active/version only — no counts,
 *    no config claims. Unknown/custom forms collapse to one
 *    pluginId "unknown" UNSUPPORTED entry; that never means "no forms".
 *  - The senderDomain comparison block reports domain-only data; the
 *    comparison target is supplied by the server (the diagnostic's
 *    emailDomain), never derived here from an admin address.
 */
function wp_doctor_ai_plugin_entry_by_slug($plugins, $slug) {
    if (!is_array($plugins)) {
        return null;
    }
    foreach ($plugins as $p) {
        if (is_array($p) && isset($p['slug']) && $p['slug'] === $slug) {
            return $p;
        }
    }
    return null;
}

function wp_doctor_ai_domain_from_email($value) {
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    // Literal address only: anything containing a mail-tag bracket or a
    // space is a template, not an address, and yields no domain.
    if (strpos($value, '[') !== false || strpos($value, ']') !== false || strpos($value, ' ') !== false) {
        return null;
    }
    if (!preg_match('/^[^@\s]+@([A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,})$/', $value, $m)) {
        return null;
    }
    return strtolower($m[1]);
}

function wp_doctor_ai_collect_cf7($plugins) {
    $entry = wp_doctor_ai_plugin_entry_by_slug($plugins, 'contact-form-7');
    $base = array(
        'pluginId' => 'contact-form-7',
        'name' => 'Contact Form 7',
        'installed' => $entry !== null,
        'active' => $entry !== null && !empty($entry['active']),
        'version' => ($entry !== null && isset($entry['version'])) ? $entry['version'] : null,
        'adapterName' => 'contact-form-7',
        'adapterVersion' => '1',
        'coverage' => 'COMPLETE',
        'formsCount' => null,
        'notificationConfigured' => null,
        'mailConfigStatus' => null,
    );
    if ($entry === null || empty($entry['active']) || !class_exists('WPCF7_ContactForm')) {
        // Inactive or class unavailable: no form enumeration attempted.
        $base['coverage'] = $entry === null ? 'COMPLETE' : 'COMPLETE';
        $base['notificationConfigured'] = null;
        $base['mailConfigStatus'] = null;
        return $base;
    }
    $forms = WPCF7_ContactForm::find(array('posts_per_page' => 200));
    if (!is_array($forms)) {
        $forms = array();
    }
    $base['formsCount'] = count($forms);
    if (count($forms) === 0) {
        $base['notificationConfigured'] = 'unknown';
        $base['mailConfigStatus'] = 'NO_FORMS';
        return $base;
    }
    $configured = 0;
    $sender_domains = array();
    foreach ($forms as $form) {
        if (!is_object($form) || !method_exists($form, 'prop')) {
            continue;
        }
        $mail = $form->prop('mail');
        if (!is_array($mail)) {
            continue;
        }
        $sender = isset($mail['sender']) && is_string($mail['sender']) ? trim($mail['sender']) : '';
        $recipient = isset($mail['recipient']) && is_string($mail['recipient']) ? trim($mail['recipient']) : '';
        if ($sender !== '' && $recipient !== '') {
            $configured++;
        }
        $domain = wp_doctor_ai_domain_from_email($sender);
        if ($domain !== null) {
            $sender_domains[$domain] = true;
        }
    }
    $base['notificationConfigured'] = $configured === count($forms) ? 'yes' : ($configured === 0 ? 'no' : 'unknown');
    // Tri-state honesty: a mix is neither fully yes nor fully no; the
    // server rule engine treats 'unknown' here as PARTIAL evidence via
    // mailConfigStatus, never as a pass.
    if ($configured === count($forms)) {
        $base['mailConfigStatus'] = 'CONFIGURED';
    } elseif ($configured === 0) {
        $base['mailConfigStatus'] = 'INCOMPLETE';
    } else {
        $base['mailConfigStatus'] = 'PARTIAL';
    }
    // NOTE: sender domains are intentionally NOT attached per-form; the
    // single senderDomain block below carries at most one domain, and
    // only when every literal sender agreed on it.
    if (count($sender_domains) === 1) {
        $GLOBALS['wp_doctor_ai_cf7_sender_domain'] = array_keys($sender_domains)[0];
    }
    return $base;
}

function wp_doctor_ai_unsupported_form_entry($plugins, $slug, $name) {
    $entry = wp_doctor_ai_plugin_entry_by_slug($plugins, $slug);
    if ($entry === null) {
        return null;
    }
    return array(
        'pluginId' => $slug,
        'name' => $name,
        'installed' => true,
        'active' => !empty($entry['active']),
        'version' => isset($entry['version']) ? $entry['version'] : null,
        'adapterName' => null,
        'adapterVersion' => null,
        'coverage' => 'UNSUPPORTED',
        'formsCount' => null,
        'notificationConfigured' => null,
        'mailConfigStatus' => null,
    );
}

function wp_doctor_ai_collect_contact_forms($plugins) {
    $out = array();
    $out[] = wp_doctor_ai_collect_cf7($plugins);
    $known = array(
        array('wpforms', 'WPForms'),
        array('wpforms-lite', 'WPForms Lite'),
        array('gravityforms', 'Gravity Forms'),
        array('ninja-forms', 'Ninja Forms'),
        array('fluentform', 'Fluent Forms'),
        array('elementor-pro', 'Elementor Pro (forms)'),
    );
    $any_recognised = false;
    foreach ($known as $pair) {
        $e = wp_doctor_ai_unsupported_form_entry($plugins, $pair[0], $pair[1]);
        if ($e !== null) {
            $out[] = $e;
            $any_recognised = true;
        }
    }
    if (!$any_recognised && !wp_doctor_ai_plugin_entry_by_slug($plugins, 'contact-form-7')) {
        // No recognised form plugin at all: one honest unknown entry.
        $out[] = array(
            'pluginId' => 'unknown',
            'name' => 'Unknown or custom form integration',
            'installed' => false,
            'active' => false,
            'version' => null,
            'adapterName' => null,
            'adapterVersion' => null,
            'coverage' => 'UNSUPPORTED',
            'formsCount' => null,
            'notificationConfigured' => null,
            'mailConfigStatus' => null,
        );
    }
    return $out;
}

function wp_doctor_ai_collect_wp_mail_smtp($plugins) {
    $entry = wp_doctor_ai_plugin_entry_by_slug($plugins, 'wp-mail-smtp');
    $base = array(
        'pluginId' => 'wp-mail-smtp',
        'name' => 'WP Mail SMTP',
        'installed' => $entry !== null,
        'active' => $entry !== null && !empty($entry['active']),
        'version' => ($entry !== null && isset($entry['version'])) ? $entry['version'] : null,
        'configPresent' => 'unknown',
        'requiredFieldsComplete' => 'unknown',
        'mailer' => null,
        'senderConfigured' => 'unknown',
        'senderDomain' => null,
        'coverage' => 'PARTIAL',
    );
    if ($entry === null || empty($entry['active']) || !function_exists('get_option')) {
        return $base;
    }
    $opts = get_option('wp_mail_smtp', false);
    if (!is_array($opts) || !isset($opts['mail']) || !is_array($opts['mail'])) {
        return $base;
    }
    $mail = $opts['mail'];
    $mailer = isset($mail['mailer']) && is_string($mail['mailer']) ? strtolower(trim($mail['mailer'])) : '';
    $allowed_mailers = array('mail', 'smtp', 'sendgrid', 'mailgun', 'ses', 'postmark', 'sendinblue', 'sparkpost', 'zoho', 'gmail', 'outlook');
    $base['mailer'] = in_array($mailer, $allowed_mailers, true) ? $mailer : ($mailer === '' ? null : 'other');
    $from_domain = isset($mail['from_email']) ? wp_doctor_ai_domain_from_email($mail['from_email']) : null;
    $base['senderConfigured'] = $from_domain !== null ? 'yes' : (isset($mail['from_email']) && is_string($mail['from_email']) && trim($mail['from_email']) !== '' ? 'unknown' : 'no');
    $base['senderDomain'] = $from_domain;
    $base['configPresent'] = 'yes';
    // Required-field completeness from presence booleans ONLY. For
    // smtp: a host must be present; secret VALUES are never read into a
    // variable that could leak (only isset()/non-empty checks on the
    // nested array, and the result is a boolean).
    if ($base['mailer'] === 'smtp') {
        $smtp = isset($opts['smtp']) && is_array($opts['smtp']) ? $opts['smtp'] : array();
        $host_present = isset($smtp['host']) && is_string($smtp['host']) && trim($smtp['host']) !== '';
        $base['requiredFieldsComplete'] = ($from_domain !== null && $host_present) ? 'yes' : 'no';
    } elseif ($base['mailer'] !== null && $base['mailer'] !== 'mail') {
        // API mailers: from address + any provider credential group
        // present (boolean only, never its contents).
        $provider_present = isset($opts[$base['mailer']]) && is_array($opts[$base['mailer']]) && count($opts[$base['mailer']]) > 0;
        $base['requiredFieldsComplete'] = ($from_domain !== null && $provider_present) ? 'yes' : 'no';
    } else {
        $base['requiredFieldsComplete'] = $from_domain !== null ? 'yes' : 'no';
    }
    if ($from_domain !== null) {
        $GLOBALS['wp_doctor_ai_smtp_sender_domain'] = $from_domain;
    }
    return $base;
}

function wp_doctor_ai_collect_mail_transport($plugins) {
    $out = array();
    $out[] = wp_doctor_ai_collect_wp_mail_smtp($plugins);
    foreach (array(array('fluent-smtp', 'FluentSMTP'), array('post-smtp', 'Post SMTP')) as $pair) {
        $entry = wp_doctor_ai_plugin_entry_by_slug($plugins, $pair[0]);
        if ($entry !== null) {
            $out[] = array(
                'pluginId' => $pair[0],
                'name' => $pair[1],
                'installed' => true,
                'active' => !empty($entry['active']),
                'version' => isset($entry['version']) ? $entry['version'] : null,
                'configPresent' => 'unknown',
                'requiredFieldsComplete' => 'unknown',
                'mailer' => null,
                'senderConfigured' => 'unknown',
                'senderDomain' => null,
                'coverage' => 'UNSUPPORTED',
            );
        }
    }
    return $out;
}

function wp_doctor_ai_collect_sender_domain() {
    // Domain-only; the server supplies the comparison target. Prefer the
    // mail plugin's from domain, else CF7's unanimous literal sender
    // domain; otherwise unknown. Never a full address.
    $domain = null;
    if (isset($GLOBALS['wp_doctor_ai_smtp_sender_domain']) && is_string($GLOBALS['wp_doctor_ai_smtp_sender_domain'])) {
        $domain = $GLOBALS['wp_doctor_ai_smtp_sender_domain'];
    } elseif (isset($GLOBALS['wp_doctor_ai_cf7_sender_domain']) && is_string($GLOBALS['wp_doctor_ai_cf7_sender_domain'])) {
        $domain = $GLOBALS['wp_doctor_ai_cf7_sender_domain'];
    }
    return array(
        'senderConfigured' => $domain !== null ? 'yes' : 'unknown',
        'senderDomain' => $domain,
        // The collector cannot know the server's emailDomain target, so
        // it never claims a match: comparison is established server-side.
        'domainMatches' => null,
        'comparisonEstablished' => false,
    );
}

function wp_doctor_ai_security_tri_state($constant) {
    if (!defined($constant)) {
        return 'unknown';
    }
    $value = constant($constant);
    // WP_DEBUG_LOG may be a string path when logging to a custom file;
    // any truthy value means logging is enabled.
    return !empty($value) ? 'yes' : 'no';
}

function wp_doctor_ai_collect_security_indicators() {
    return array(
        'wpDebug' => wp_doctor_ai_security_tri_state('WP_DEBUG'),
        'wpDebugDisplay' => wp_doctor_ai_security_tri_state('WP_DEBUG_DISPLAY'),
        'wpDebugLog' => wp_doctor_ai_security_tri_state('WP_DEBUG_LOG'),
        'disallowFileEdit' => wp_doctor_ai_security_tri_state('DISALLOW_FILE_EDIT'),
    );
}

function wp_doctor_ai_collect_snapshot() {
    if (!function_exists('get_plugins')) {
        $admin_plugin_file = ABSPATH . 'wp-admin/includes/plugin.php';
        if (file_exists($admin_plugin_file)) {
            require_once $admin_plugin_file;
        }
    }
    $active_plugins = array();
    $plugins = array();
    $active = array();
    $network_active = array();
    if (function_exists('get_option')) {
        $active = get_option('active_plugins', array());
        if (!is_array($active)) {
            $active = array();
        }
    }
    if (function_exists('is_multisite') && is_multisite() && function_exists('get_site_option')) {
        $sitewide = get_site_option('active_sitewide_plugins', array());
        if (is_array($sitewide)) {
            foreach (array_keys($sitewide) as $network_plugin) {
                $network_active[] = $network_plugin;
                if (!in_array($network_plugin, $active, true)) {
                    $active[] = $network_plugin;
                }
            }
        }
    }
    // Cached update data only — read-only. Never triggers a refresh.
    $update_response = array();
    $update_checked_at = null;
    if (function_exists('get_site_transient')) {
        $updates = get_site_transient('update_plugins');
        if (is_object($updates)) {
            if (isset($updates->response) && is_array($updates->response)) {
                $update_response = $updates->response;
            } elseif (isset($updates->response) && is_object($updates->response)) {
                $update_response = get_object_vars($updates->response);
            }
            if (isset($updates->last_checked) && is_numeric($updates->last_checked)) {
                $update_checked_at = (int) $updates->last_checked;
            }
        }
    }
    if (function_exists('get_plugins')) {
        $all_plugins = get_plugins();
        if (!is_array($all_plugins)) {
            $all_plugins = array();
        }
        foreach ($all_plugins as $plugin_file => $data) {
            if (!is_array($data)) {
                $data = array();
            }
            $is_active = in_array($plugin_file, $active, true);
            $is_network = in_array($plugin_file, $network_active, true);
            $new_version = null;
            $has_update = false;
            if (isset($update_response[$plugin_file])) {
                $entry = $update_response[$plugin_file];
                if (is_object($entry) && isset($entry->new_version)) {
                    $new_version = (string) $entry->new_version;
                    $has_update = true;
                } elseif (is_array($entry) && isset($entry['new_version'])) {
                    $new_version = (string) $entry['new_version'];
                    $has_update = true;
                }
            }
            $plugins[] = array(
                'name' => isset($data['Name']) ? $data['Name'] : $plugin_file,
                'slug' => wp_doctor_ai_plugin_slug_from_file($plugin_file),
                'version' => isset($data['Version']) ? wp_doctor_ai_header_or_null($data['Version']) : null,
                'active' => $is_active,
                'networkActive' => $is_network,
                'muPlugin' => false,
                'requiresWP' => isset($data['RequiresWP']) ? wp_doctor_ai_header_or_null($data['RequiresWP']) : null,
                'requiresPHP' => isset($data['RequiresPHP']) ? wp_doctor_ai_header_or_null($data['RequiresPHP']) : null,
                'dependencies' => isset($data['RequiresPlugins']) ? wp_doctor_ai_parse_dependencies($data['RequiresPlugins']) : array(),
                'updateAvailable' => $has_update,
                'newVersion' => $new_version,
                'updateCheckedAt' => $update_checked_at,
            );
            if ($is_active) {
                $active_plugins[] = array(
                    'name' => isset($data['Name']) ? $data['Name'] : $plugin_file,
                    'version' => isset($data['Version']) ? wp_doctor_ai_header_or_null($data['Version']) : null,
                );
            }
        }
        // Active plugins whose metadata is missing from get_plugins().
        foreach ($active as $plugin_file) {
            if (!isset($all_plugins[$plugin_file])) {
                $active_plugins[] = array('name' => $plugin_file, 'version' => null);
            }
        }
        // Must-use plugins: always active, never in get_plugins().
        if (function_exists('get_mu_plugins')) {
            $mu_plugins = get_mu_plugins();
            if (is_array($mu_plugins)) {
                foreach ($mu_plugins as $plugin_file => $data) {
                    if (!is_array($data)) {
                        $data = array();
                    }
                    $plugins[] = array(
                        'name' => isset($data['Name']) ? $data['Name'] : $plugin_file,
                        'slug' => wp_doctor_ai_plugin_slug_from_file($plugin_file),
                        'version' => isset($data['Version']) ? wp_doctor_ai_header_or_null($data['Version']) : null,
                        'active' => true,
                        'networkActive' => false,
                        'muPlugin' => true,
                        'requiresWP' => isset($data['RequiresWP']) ? wp_doctor_ai_header_or_null($data['RequiresWP']) : null,
                        'requiresPHP' => isset($data['RequiresPHP']) ? wp_doctor_ai_header_or_null($data['RequiresPHP']) : null,
                        'dependencies' => isset($data['RequiresPlugins']) ? wp_doctor_ai_parse_dependencies($data['RequiresPlugins']) : array(),
                        'updateAvailable' => false,
                        'newVersion' => null,
                        'updateCheckedAt' => $update_checked_at,
                    );
                    $active_plugins[] = array(
                        'name' => isset($data['Name']) ? $data['Name'] : $plugin_file,
                        'version' => isset($data['Version']) ? wp_doctor_ai_header_or_null($data['Version']) : null,
                    );
                }
            }
        }
    }
    $theme = null;
    $active_theme = null;
    if (function_exists('wp_get_theme')) {
        $current_theme = wp_get_theme();
        if ($current_theme && method_exists($current_theme, 'get')) {
            $parent_name = null;
            $parent_version = null;
            if (method_exists($current_theme, 'parent') && method_exists($current_theme, 'get')) {
                $parent = $current_theme->parent();
                if ($parent && method_exists($parent, 'get')) {
                    $parent_name = wp_doctor_ai_header_or_null($parent->get('Name'));
                    $parent_version = wp_doctor_ai_header_or_null($parent->get('Version'));
                }
            }
            $active_theme = array(
                'name' => $current_theme->get('Name'),
                'version' => $current_theme->get('Version'),
            );
            $theme_slug = null;
            if (method_exists($current_theme, 'get_stylesheet')) {
                $stylesheet = $current_theme->get_stylesheet();
                if (is_string($stylesheet) && $stylesheet !== '' && preg_match('/^[a-z0-9][a-z0-9_-]*$/i', $stylesheet)) {
                    $theme_slug = $stylesheet;
                }
            }
            $theme = array(
                'name' => $current_theme->get('Name'),
                'version' => wp_doctor_ai_header_or_null($current_theme->get('Version')),
                'parentName' => $parent_name,
                'parentVersion' => $parent_version,
                'requiresWP' => wp_doctor_ai_header_or_null($current_theme->get('RequiresWP')),
                'requiresPHP' => wp_doctor_ai_header_or_null($current_theme->get('RequiresPHP')),
                // v7 only: trusted runtime stylesheet directory name.
                'slug' => $theme_slug,
            );
        }
    }
    $woocommerce = wp_doctor_ai_collect_woocommerce($plugins);
    $plugins_available = function_exists('get_plugins');
    $contact_forms = wp_doctor_ai_collect_contact_forms($plugins);
    $mail_transport = wp_doctor_ai_collect_mail_transport($plugins);
    $malware_scan = null;
    if (function_exists('wp_doctor_ai_collect_malware_scan')) {
        // Bounded, read-only, admin-triggered local inspection (see
        // class-malware.php). A failure here must not break the snapshot:
        // a null malwareScan means "not performed", never "no malware".
        try {
            $malware_scan = wp_doctor_ai_collect_malware_scan($plugins);
        } catch (Exception $e) {
            $malware_scan = null;
        } catch (Throwable $e) {
            $malware_scan = null;
        }
    }
    return array(
        'schemaVersion' => 7,
        'wordpressVersion' => function_exists('get_bloginfo') ? get_bloginfo('version') : null,
        'phpVersion' => phpversion(),
        'homeUrl' => function_exists('home_url') ? home_url() : null,
        'siteUrl' => function_exists('site_url') ? site_url() : null,
        'pluginVersion' => WP_DOCTOR_AI_CONNECTOR_VERSION,
        'activePlugins' => $active_plugins,
        'activeTheme' => $active_theme,
        'multisite' => function_exists('is_multisite') ? is_multisite() : false,
        'locale' => function_exists('get_locale') ? get_locale() : null,
        'plugins' => $plugins,
        'theme' => $theme,
        'woocommerce' => $woocommerce,
        'elementor' => wp_doctor_ai_collect_elementor($plugins, $plugins_available),
        'environment' => wp_doctor_ai_collect_environment(),
        'contactForms' => $contact_forms,
        'mailTransport' => $mail_transport,
        'senderDomain' => wp_doctor_ai_collect_sender_domain(),
        'securityIndicators' => wp_doctor_ai_collect_security_indicators(),
        'malwareScan' => $malware_scan,
    );
}
