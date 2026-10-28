<?php
/**
 * Local connection state. The connector credential lives in a single
 * WordPress option with autoload disabled, so it is never loaded on
 * every request and never rendered in admin HTML or logs.
 */

if (!defined('ABSPATH')) {
    exit;
}

function wp_doctor_ai_get_credential() {
    $value = get_option('wp_doctor_ai_credential', '');
    return is_string($value) ? $value : '';
}

function wp_doctor_ai_store_credential($credential) {
    // Third parameter disables autoload (WP 6.x accepts boolean false;
    // older versions accept 'no' via the same parameter position).
    update_option('wp_doctor_ai_credential', $credential, false);
}

function wp_doctor_ai_get_status() {
    $status = get_option('wp_doctor_ai_status', 'disconnected');
    $allowed = array('disconnected', 'connected', 'revoked', 'not-configured');
    return in_array($status, $allowed, true) ? $status : 'disconnected';
}

function wp_doctor_ai_set_status($status) {
    update_option('wp_doctor_ai_status', $status, false);
}

function wp_doctor_ai_get_paired_at() {
    return get_option('wp_doctor_ai_paired_at', '');
}

function wp_doctor_ai_get_last_sync() {
    return get_option('wp_doctor_ai_last_sync', '');
}

function wp_doctor_ai_get_last_error() {
    return get_option('wp_doctor_ai_last_error', '');
}

function wp_doctor_ai_set_last_error($message) {
    // Only safe, non-secret messages are ever stored here. Callers must
    // never pass raw API bodies, headers, or credentials.
    update_option('wp_doctor_ai_last_error', is_string($message) ? substr($message, 0, 500) : '', false);
}

function wp_doctor_ai_clear_local_connection() {
    delete_option('wp_doctor_ai_credential');
    delete_option('wp_doctor_ai_status');
    delete_option('wp_doctor_ai_paired_at');
    delete_option('wp_doctor_ai_last_sync');
    delete_option('wp_doctor_ai_last_error');
}
