<?php
/**
 * SaaS API base URL validation.
 *
 * The base URL comes ONLY from the WP_DOCTOR_AI_API_BASE_URL constant
 * (wp-config.php). There is deliberately no admin field that could
 * redirect credential-bearing requests to an arbitrary host.
 *
 * Production rules: https only, no credentials, no query/fragment,
 * no unexpected ports (none or 443).
 * Development exception: http is allowed ONLY when
 * WP_DOCTOR_AI_DEV_MODE is true AND the host is a loopback address
 * (localhost, 127.0.0.1, ::1). Any other combination is refused.
 */

if (!defined('ABSPATH')) {
    exit;
}

function wp_doctor_ai_is_loopback_host($host) {
    $host = strtolower($host);
    return $host === 'localhost' || $host === '127.0.0.1' || $host === '[::1]' || $host === '::1';
}

function wp_doctor_ai_validate_api_base($url) {
    if (!is_string($url) || trim($url) === '') {
        return array('valid' => false, 'error' => 'The SaaS API base URL is not configured. Define WP_DOCTOR_AI_API_BASE_URL in wp-config.php.', 'base' => '');
    }
    $url = trim($url);
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
        return array('valid' => false, 'error' => 'The configured SaaS API base URL is invalid.', 'base' => '');
    }
    $scheme = strtolower($parts['scheme']);
    $host = strtolower($parts['host']);
    if (!empty($parts['user']) || !empty($parts['pass'])) {
        return array('valid' => false, 'error' => 'The configured SaaS API base URL must not contain credentials.', 'base' => '');
    }
    if (!empty($parts['query']) || !empty($parts['fragment'])) {
        return array('valid' => false, 'error' => 'The configured SaaS API base URL must not contain a query string or fragment.', 'base' => '');
    }
    $dev_mode = defined('WP_DOCTOR_AI_DEV_MODE') && WP_DOCTOR_AI_DEV_MODE;
    $port = isset($parts['port']) ? (int) $parts['port'] : null;
    if ($scheme === 'https') {
        if ($port !== null && $port !== 443) {
            return array('valid' => false, 'error' => 'The configured SaaS API base URL uses an unexpected port. Use https on port 443.', 'base' => '');
        }
    } elseif ($scheme === 'http' && $dev_mode && wp_doctor_ai_is_loopback_host($host)) {
        // Development-only exception for local SaaS servers (e.g. :3000).
        // Refused for every non-loopback host and whenever dev mode is off.
    } else {
        return array('valid' => false, 'error' => 'The SaaS API base URL must use https. Insecure http is only allowed for local development (WP_DOCTOR_AI_DEV_MODE + loopback host).', 'base' => '');
    }
    $path = isset($parts['path']) ? rtrim($parts['path'], '/') : '';
    $base = $scheme . '://' . $host;
    if ($port !== null) {
        $base .= ':' . $port;
    }
    $base .= $path;
    return array('valid' => true, 'error' => '', 'base' => $base);
}

function wp_doctor_ai_get_api_base() {
    if (!defined('WP_DOCTOR_AI_API_BASE_URL')) {
        return array('valid' => false, 'error' => 'The SaaS API base URL is not configured. Define WP_DOCTOR_AI_API_BASE_URL in wp-config.php.', 'base' => '');
    }
    return wp_doctor_ai_validate_api_base(WP_DOCTOR_AI_API_BASE_URL);
}
