<?php
/**
 * SaaS HTTP client.
 *
 * Uses wp_remote_post() against the validated, constant-configured base
 * URL only. wp_safe_remote_post() is intentionally NOT used: its
 * 80/443/8080 port allowlist would reject legitimate local development
 * SaaS servers, while our own validation (constant-only base URL, no
 * user input, https in production, no credentials/query/fragment) is
 * the destination restriction. TLS verification is always on and
 * redirects are disabled (redirection => 0) so credentials can never
 * be forwarded to another host by a redirect.
 */

if (!defined('ABSPATH')) {
    exit;
}

function wp_doctor_ai_remote_post($path, $body, $credential) {
    $base = wp_doctor_ai_get_api_base();
    if (!$base['valid']) {
        return array('ok' => false, 'error' => $base['error'], 'code' => 'CONNECTOR_NOT_CONFIGURED');
    }
    $url = $base['base'] . $path;
    $headers = array('Content-Type' => 'application/json');
    if (is_string($credential) && $credential !== '') {
        $headers['Authorization'] = 'Bearer ' . $credential;
        $headers['X-WPDoctor-Timestamp'] = (string) time();
        if (function_exists('random_bytes')) {
            try {
                $headers['X-WPDoctor-Nonce'] = bin2hex(random_bytes(16));
            } catch (Exception $e) {
                $headers['X-WPDoctor-Nonce'] = wp_generate_password(32, false, false);
            }
        } else {
            $headers['X-WPDoctor-Nonce'] = wp_generate_password(32, false, false);
        }
    }
    $response = wp_remote_post($url, array(
        'method' => 'POST',
        'timeout' => 15,
        'redirection' => 0,
        'httpversion' => '1.1',
        'blocking' => true,
        'sslverify' => true,
        'headers' => $headers,
        'body' => wp_json_encode($body),
    ));
    if (is_wp_error($response)) {
        return array('ok' => false, 'error' => 'Could not reach the WP Doctor AI service. Check the configured endpoint and try again.', 'code' => 'REMOTE_SERVICE_UNAVAILABLE');
    }
    $raw = wp_remote_retrieve_body($response);
    if (strlen($raw) > 65536) {
        return array('ok' => false, 'error' => 'The service returned an oversized response.', 'code' => 'REMOTE_SERVICE_UNAVAILABLE');
    }
    $status = (int) wp_remote_retrieve_response_code($response);
    $decoded = json_decode($raw, true);
    if ($status < 200 || $status >= 300) {
        $message = 'The service rejected the request.';
        $code = 'REMOTE_SERVICE_UNAVAILABLE';
        if (is_array($decoded) && !empty($decoded['error']) && is_string($decoded['error'])) {
            // The SaaS returns only safe, bounded error messages.
            $message = substr($decoded['error'], 0, 500);
        }
        if (is_array($decoded) && !empty($decoded['code']) && is_string($decoded['code'])) {
            $code = $decoded['code'];
        }
        return array('ok' => false, 'error' => $message, 'code' => $code);
    }
    if (!is_array($decoded)) {
        return array('ok' => false, 'error' => 'The service returned an unexpected response.', 'code' => 'REMOTE_SERVICE_UNAVAILABLE');
    }
    return array('ok' => true, 'data' => $decoded, 'code' => '');
}

function wp_doctor_ai_pair_with_code($code) {
    $result = wp_doctor_ai_remote_post('/api/connector/pair', array(
        'code' => $code,
        'homeUrl' => home_url(),
        'siteUrl' => site_url(),
        'pluginVersion' => WP_DOCTOR_AI_CONNECTOR_VERSION,
    ), '');
    if (!$result['ok']) {
        return $result;
    }
    if (empty($result['data']['credential']) || !is_string($result['data']['credential'])) {
        return array('ok' => false, 'error' => 'The service returned an unexpected response.', 'code' => 'REMOTE_SERVICE_UNAVAILABLE');
    }
    return array('ok' => true, 'credential' => $result['data']['credential'], 'code' => '');
}

function wp_doctor_ai_send_snapshot($snapshot) {
    $credential = wp_doctor_ai_get_credential();
    if ($credential === '') {
        return array('ok' => false, 'error' => 'This site is not paired yet. Pair it first.', 'code' => 'CONNECTOR_NOT_CONFIGURED');
    }
    return wp_doctor_ai_remote_post('/api/connector/diagnostics', $snapshot, $credential);
}
