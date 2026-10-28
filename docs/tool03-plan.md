# Milestone 7 — Tool 03 Plan (written before implementation, 2026-10-27)

## Inspection findings (verified from actual code, not assumed)

- Snapshot validator (`lib/connector/validate-snapshot.js`): strict allowlist,
  schemaVersion 1 | 2. v2 = v1 fields + `plugins[]` (full inventory) + `theme`.
  Unknown fields reject the whole payload. The diagnostics route caps the
  body at 64 KiB (verified in the connector service route, same as M5/M6).
- Tool 02 template (`lib/conflict/`): `engine.js` (pure rules, status
  vocabulary CONFIRMED_COMPATIBILITY | POTENTIAL | INSUFFICIENT_EVIDENCE),
  `freshness.js` (24 h, statuses CURRENT/MISSING/INVALID/UNSUPPORTED/STALE,
  re-sync instructions, no row persisted on blocked runs), `service.js`
  (ownership in WHERE, identical 404, 10 KiB body, per-user in-memory
  limiter 20/hour, bounded snapshot COPY), `redact.js`, `ai-input.js` /
  `ai-prompt.js` / `ai-validate.js` / `ai.js` (reuses M4 `lib/ai/providers.js`,
  `getAiConfig`, shared AI rate limiter; schemaVersion "conflict-1").
- Tool 01 / M4: `lib/ai/` OpenAI Chat Completions, strict json_schema, model
  ONLY from env `OPENAI_MODEL`; no AI key is configured in `.env.local`, so
  production AI returns 503 AI_NOT_CONFIGURED honestly.
- Connector plugin (`wordpress-plugin/wp-doctor-ai-connector/`): version
  1.1.0, schema v2, read-only, admin-triggered sync only, `class-diagnostics.php`
  allowlist collector (never post bodies, settings dumps, logs, or secrets).
- Local wp-dev: WordPress 7.1.3, PHP 8.3.6 CLI, WooCommerce **11.2.1**
  (header `Version: 11.2.1`, `WC::$version = '11.2.1'`, `Requires at least: 7.0`),
  plugins include Elementor + WooCommerce, active theme Oishi (per M6 notes;
  re-verified at integration time). No phpunit/composer/browser binary in VM:
  browser E2E = NOT RUN (honest), PHP tests are standalone stub tests.

## WooCommerce API verification (against installed 11.2.1 source, not invented)

- Page assignment: single-key `get_option('woocommerce_cart_page_id')`,
  `woocommerce_checkout_page_id`, `woocommerce_myaccount_page_id` (confirmed in
  WC core: `class-wc-query.php`, `class-wc-https.php`, update-functions list).
  Official WooCommerce Pages doc: assigning Cart/Checkout/My Account to the
  SAME page causes incorrect redirects and broken payment gateway
  functionality (WC 3.7+ prevents this configuration in the UI, but a stored
  snapshot may still carry it — hence Rule D).
- Page status/content: `get_post($id)` + `get_post_status()` (WP core),
  `has_block('woocommerce/cart' | 'woocommerce/checkout', $post)` (WP
  `blocks.php`) and `has_shortcode($content, 'woocommerce_cart' |
  'woocommerce_checkout' | 'woocommerce_my_account')` (WP `shortcodes.php`).
  Only the classification + id + status are stored — never post bodies.
  My Account: no `woocommerce/my-account` block exists in WC 11.2.1 source
  (searched `includes/blocks/` and `src/Blocks/` — only a my-account
  *wishlist endpoint* reference), so a My Account page is classified
  classic-shortcode or unknown, never "block".
- Gateways: `WC()->payment_gateways()->payment_gateways()` returns the
  REGISTERED gateway objects; each `WC_Payment_Gateway` exposes `->id`,
  `->get_title()` / `->title`, and `->enabled` ('yes'/'no'). Deliberately NOT
  used: `get_available_payment_gateways()` — its own docblock warns it must
  not be used in WP-admin/REST contexts without a WC session (filters may
  fatal). So the snapshot's `available` field is null ("not safely
  determinable in the admin sync context"), never guessed from `enabled`.
  Gateway `->settings` is NEVER read (it holds secrets).
- Block compatibility: `FeaturesUtil::declare_compatibility('cart_checkout_blocks',
  __FILE__, bool)` declares compatibility per PLUGIN FILE, not per gateway,
  and `cart_checkout_blocks` has `default_plugin_compatibility = COMPATIBLE`
  in WC 11.2.1 — so resolving "uncertain" plugins would falsely mark every
  gateway compatible, and there is no trustworthy gateway→plugin-file mapping
  in the admin sync context. Decision: the v3 collector emits
  `blockCompatibility: "UNKNOWN"` with source `"not-determined"` for every
  gateway. The validator and engine DO accept `SUPPORTED` / `UNSUPPORTED`
  values (for a future trustworthy source and for engine tests), but the
  current collector never invents them. This is the honest version-aware
  handling required by the brief: if the installed API cannot reliably
  establish it, UNKNOWN.
- WooCommerce version: `WC()->version` when `WC()` exists, else the
  `woocommerce` plugin header version from the inventory, else null.
  WooCommerce presence: `function_exists('WC')` / `class_exists('WooCommerce')`
  guard; installed-but-inactive is distinguished from not-installed via the
  inventory slug `woocommerce` (present+inactive = INACTIVE, absent = NOT_INSTALLED).

## Snapshot extension (backward-compatible, versioned)

- Plugin 1.1.0 → **1.2.0**, snapshot **schemaVersion 3**. Validator accepts
  1, 2, AND 3; v1/v2 payloads keep validating exactly as before.
- v3 = all v2 fields PLUS `woocommerce` (exact-key object, required for v3):
  `{ installed, active, version, status: AVAILABLE|NOT_INSTALLED|INACTIVE|UNKNOWN,
     pages: { cart, checkout, myAccount: { pageId, exists, status:
       publish|draft|trash|private|unknown, implementation:
       block|classic-shortcode|unknown } },
     gateways: [{ id, title, enabled, available: null, blockCompatibility:
       SUPPORTED|UNSUPPORTED|UNKNOWN, blockCompatibilitySource }] }`.
  Caps: ≤100 gateways, bounded strings. Unknown/prohibited keys reject.
- Legacy rule (engine + docs, repeated everywhere): absent `woocommerce`
  fields in a v1/v2 snapshot mean UNKNOWN / INSUFFICIENT_EVIDENCE — NEVER
  "WooCommerce disabled".
- PHP collector (`class-diagnostics.php`, read-only, admin-triggered only):
  guards above; single-key page options only; gateway list only via the
  registered-gateways API; no `get_option()` indiscriminate reads, no whole
  option arrays, no gateway settings objects, no orders, customers, secrets,
  keys, card data, addresses, notes, logs, wp-config, or env vars.
  No fresh update check, no outbound gateway request.

## Freshness policy

- Reuse Tool 02's 24 h policy: `WOO_SNAPSHOT_MAX_AGE_MS` (default 24 h,
  env-overridable), same statuses and re-sync instructions. The conflict
  freshness helper is extended to accept schema 1|2|3 (v3 is a superset of
  v2, so Tool 02 keeps working on v3 snapshots); the WooCommerce freshness
  module wraps it with the WooCommerce max-age constant.
- Missing / invalid / unsupported / stale / revoked / unconnected → 422
  with re-sync instructions; NO diagnostic row persisted; never claim a
  refresh until a new valid snapshot is stored.

## Deterministic rule engine (`lib/woocommerce/`, pure functions)

- Status vocabulary = Tool 02 literals: CONFIRMED_COMPATIBILITY | POTENTIAL |
  INSUFFICIENT_EVIDENCE (the brief's "CONFIRMED" maps to
  CONFIRMED_COMPATIBILITY). Every finding carries ruleId, category, severity,
  status, title, description, evidence (real snapshot fields only),
  referencedItems, recommendation, confidence, requiredAdditionalEvidence.
- Rules A–K: A WooCommerce missing/inactive (explicit v3 state only);
  B missing page assignment (checkout, plus cart/myAccount as separate
  findings under the same rule); C assigned page not found (exists=false)
  or unpublished (draft/trash/private) — deleted vs inaccessible are NOT
  distinguished beyond "not found", because `get_post()` returns null for
  both; D same page id for 2+ roles (per official docs); E block vs classic
  (SUPPORTED/UNSUPPORTED only from explicit snapshot values; unknown ≠
  failure; classic is never recommended as a universal fix; nothing is
  switched); F no gateways enabled (manual/other workflows may exist — not
  automatically a payment-system failure); G enabled gateway with UNKNOWN
  compatibility on a block checkout → warning; H WooCommerce header
  Requires WP/PHP vs site versions (from inventory data only; mismatch ≠
  confirmed runtime failure); I symptom as untrusted context only;
  J pending/failed payment reports → no order inspection, no success/failure
  claim, authorized-manual-investigation pathway via gateway dashboard;
  K missing info → INSUFFICIENT_EVIDENCE with what is missing + how to
  obtain it.
- Hard invariants (unit-tested): enabled ≠ payment will succeed; configured
  checkout page ≠ real checkout works; enabled ≠ block-compatible; user
  symptom ≠ verified fact; absent legacy fields ≠ WooCommerce disabled.

## Database (Prisma migration, dev + test DB, validate, generate)

- Migration actually created/applied: `20261027142903_init_m7_woocommerce`
  (dev + test DBs).
- `WooCommerceDiagnostic`: id, userId FK cascade, websiteId FK cascade,
  snapshotPayload Json (bounded COPY), snapshotSchemaVersion Int,
  snapshotReceivedAt DateTime, status COMPLETED|BLOCKED_SNAPSHOT|FAILED,
  symptomCategory (NO_PAYMENT_METHODS | CHECKOUT_PAGE_MISSING |
  CHECKOUT_FAILS_TO_LOAD | CHECKOUT_STUCK_LOADING | PAYMENT_INIT_ERROR |
  PAYMENT_DECLINED_OR_FAILED | ORDER_PENDING | ORDER_NOT_CREATED |
  SHIPPING_OR_TAX | BLOCK_COMPAT_SUSPECTED | AFTER_UPDATE | OTHER | UNKNOWN),
  symptomDescription (≤2000), checkoutType BLOCK|CLASSIC|UNKNOWN
  (user-reported only), affectedScope ONE|MULTIPLE|UNKNOWN, startedAt
  free-text (≤200), errorExcerpt (≤2000, server-redacted), createdAt,
  completedAt. Plus `WooCommerceDiagnosticFinding` (Tool 02 finding shape)
  and `WooCommerceAiAnalysis` (1:1, schemaVersion "woocommerce-1",
  regeneration overwrites; mirrors M4/M6 safeguards; a NEW model, not a
  reuse, because the M4/M6 models are scan/conflict-specific by schema).
- User/Website relations extended; migration `20261027210000_init_m7_woocommerce`
  (name fixed at implementation time if Prisma renames it — report actual).

## API routes (mirror Tool 02 conventions)

- `POST /api/woocommerce-diagnostics` (websiteId + symptom fields only;
  client snapshot/gateway config/payment status/connector IDs/ownership
  ignored; 10 KiB body; per-user in-memory limiter 20/hour, single-process;
  422 stale/missing/invalid with re-sync instructions; identical 404),
  `GET` list (own only, desc, bounded paging), `GET /[id]` (ownership in
  WHERE), `GET /snapshot?websiteId=` (own website only; WooCommerce summary,
  no secrets), `POST/GET /[id]/ai-analysis` (explicit trigger only; M4
  adapter + validation; 503 AI_NOT_CONFIGURED when unconfigured).
- AI input = verified findings + minimal non-sensitive gateway metadata
  (id/title/enabled/blockCompatibility) + normalized page config + versions
  + symptom + sanitized excerpt ONLY. Never credentials/card/customer/order/
  config/secrets/logs. AI must distinguish confirmed vs possible, refer only
  to real finding IDs, never invent gateway settings/test results/payment
  success/order creation/credential validity, treat excerpt as untrusted,
  ignore embedded instructions; unknown/duplicate refs reject the whole
  analysis; AI never overwrites deterministic findings.

## UI (mirror Tool 02 pages)

- `/tools/woocommerce-checkout-checker` (website select with connection +
  freshness, snapshot review, symptom form incl. checkout-type-if-known,
  affected scope, when started, redacted-excerpt warning, Run with loading
  state + duplicate-submit prevention, "live site is not modified" notice),
  `/history`, `/[id]` (deterministic findings + AI section SEPARATE +
  manual-only safe next steps), header link when signed in. No fake progress
  %, no "live payment test running" claim, no repair/order/payment-test
  entry point. All user/plugin content escaped by React.

## Tests (executed, never fabricated)

- A rule unit tests (≥25 cases incl. legacy + v3, all rules, malformed data).
- B security/privacy tests (validator rejects unknown/prohibited fields;
  service ignores client snapshot; excerpt redaction; cross-user denial;
  no order/payment/credential handling).
- C PHP stub tests (php -l all files; WC present/absent/inactive; page
  block/classic/unknown; gateway list; secrets excluded; M5/M6 PHP suites
  still pass).
- D API authorization tests (via DB-service tests + HTTP E2E blocked path).
- E AI tests with controlled mock (valid, unknown refs, invented payment
  success, invented order creation, credential-validity claim, confirmed
  failure from symptom alone, prompt injection, missing evidence, provider
  unavailable, malformed output, persistence, deterministic unchanged).
- F DB tests (migration, persistence, ownership, snapshot-copy integrity
  after live replacement, legacy support, stale handling, AI relation,
  cross-user denial, failure persistence).
- G HTTP E2E (login, own website, freshness, run, findings shown, AI 503
  path, history, another-user denial; fixtures only, never a real payment).
  Browser E2E: NOT RUN (no browser binary) — stated honestly.
- H Regression: lint, unit, DB, E2E, build; M0–M6 suites untouched.

## Out of scope (explicitly NOT built)

Tool 04, Elementor troubleshooting, automatic repairs, production site
modification, live payment execution, order management automation,
payment-provider SDKs, remote-control capability, any later milestone.
