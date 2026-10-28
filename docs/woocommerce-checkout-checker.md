# Tool 03 — WooCommerce Checkout & Payment Diagnostics (Milestone 7)

Read-only store inspection. It never modifies a site, never runs a payment,
never inspects orders, and never changes gateway settings, page assignments,
or order status. Safe next steps are described for the user to perform
manually — never executed by this app.

## Snapshot v3 (connector plugin 1.2.0, backward-compatible)

- Validator (`lib/connector/validate-snapshot.js`) accepts schema 1, 2, AND 3.
  v1/v2 payloads validate exactly as before; they simply carry no WooCommerce
  data. A v1/v2 snapshot is NEVER read as "WooCommerce disabled": the engine
  reports it as INSUFFICIENT_EVIDENCE (Rule K) with a re-sync instruction.
- v3 = all v2 fields PLUS `woocommerce` (required for v3, exact-key object):
  `{ installed, active, version, status: AVAILABLE|NOT_INSTALLED|INACTIVE|UNKNOWN,
     pages: { cart, checkout, myAccount: { pageId, exists, status:
       publish|draft|trash|private|unknown, implementation:
       block|classic-shortcode|unknown } },
     gateways: [{ id, title, enabled, available, blockCompatibility:
       SUPPORTED|UNSUPPORTED|UNKNOWN, blockCompatibilitySource:
       not-determined|declared }] }`.
  Unknown or prohibited keys (including any gateway settings object, key,
  secret, or order/customer field) reject the whole payload.
- Collector (`wordpress-plugin/wp-doctor-ai-connector/includes/class-diagnostics.php`,
  read-only, admin-triggered sync only, same 64 KiB diagnostics cap):
  - Presence is guarded by `function_exists('WC')` / `class_exists('WooCommerce')`.
    Installed-but-inactive is distinguished from not-installed via the
    inventory slug `woocommerce`; if WooCommerce is missing/inactive, no
    WooCommerce-only function runs.
  - Page assignments come from three single-key options only
    (`woocommerce_cart_page_id`, `woocommerce_checkout_page_id`,
    `woocommerce_myaccount_page_id`). Implementation is classified ONLY from
    `has_block('woocommerce/cart' | 'woocommerce/checkout')` and
    `has_shortcode()` for `woocommerce_cart` / `woocommerce_checkout` /
    `woocommerce_my_account`. Page bodies are never stored — only the
    classification, page id, and post status. My Account has no block in
    WooCommerce 11.2.1 (verified by searching `includes/blocks/` and
    `src/Blocks/`), so it is classic-shortcode or unknown, never "block".
  - Gateways come ONLY from the registered list
    `WC()->payment_gateways()->payment_gateways()`. Deliberately NOT
    `get_available_payment_gateways()`: its own docblock warns against
    admin/REST contexts without a WC session (filters may fatal), so
    `available` is null in this context — not safely determinable, never
    guessed from `enabled`. Gateway `->settings` is never read.
  - Block compatibility: WooCommerce declares `cart_checkout_blocks`
    compatibility per PLUGIN FILE (`FeaturesUtil::declare_compatibility`),
    not per gateway, and that feature's default plugin compatibility in
    WC 11.2.1 is COMPATIBLE — so there is no trustworthy gateway-level
    mapping in the admin sync context, and resolving "uncertain" plugins
    would falsely mark every gateway compatible. The collector therefore
    reports `UNKNOWN` / `not-determined` for every gateway. The validator
    and engine DO accept `SUPPORTED` / `UNSUPPORTED` (with source
    `declared`) for a future trustworthy source; the current collector
    never invents them.
  - Version: `WC()->version` when available, else the `woocommerce` plugin
    header version, else null. No fresh update check, no outbound gateway
    request, no telemetry.

## Freshness policy

`WOO_SNAPSHOT_MAX_AGE_MS` (default 24 h, env-overridable), same statuses and
re-sync instructions as Tool 02. Missing / invalid / unsupported / stale /
revoked / unconnected snapshots → 422 with re-sync instructions
("open the connector admin page in WordPress and explicitly request a new
diagnostic sync, then re-run"); NO diagnostic row is persisted for a blocked
run; a refresh is never claimed until a new valid snapshot is stored.

## Deterministic rules (`lib/woocommerce/engine.js`, pure functions)

Status vocabulary = Tool 02 literals: CONFIRMED_COMPATIBILITY | POTENTIAL |
INSUFFICIENT_EVIDENCE. Every finding carries ruleId, category, severity,
status, title, description, evidence (real snapshot fields), referencedItems,
recommendation, confidence, requiredAdditionalEvidence.

| Rule | Meaning |
| ---- | ------- |
| A | WooCommerce missing/inactive — explicit v3 state only. |
| B | Missing page assignment (checkout HIGH; cart/myAccount MEDIUM). |
| C | Assigned page not found (exists=false — deleted vs inaccessible are NOT distinguished beyond "not found") or unpublished (draft/trash/private); unknown status → insufficient evidence. |
| D | Same page id assigned to 2+ of cart/checkout/myAccount — per official WooCommerce Pages documentation this causes incorrect redirects and broken payment gateway functionality. |
| E | Block vs classic: declared UNSUPPORTED + block checkout = confirmed incompatibility declaration (not a proven payment failure); declared UNSUPPORTED + unknown implementation = POTENTIAL; classic checkout = irrelevant (no finding); classic is never recommended as a universal fix; nothing is switched. |
| F | No gateways enabled = POTENTIAL with a manual-workflow caveat — not automatically a payment-system failure. |
| G | Enabled gateway with UNKNOWN block compatibility on a block checkout = warning (POTENTIAL); on unknown implementation = insufficient evidence; on classic = no finding. |
| H | WooCommerce header Requires WP/PHP vs site versions (inventory data only); mismatch ≠ confirmed runtime failure; malformed versions are skipped, never approximated. |
| I | Symptom as untrusted context only — never a cause, never a verified fact. |
| J | Pending/failed payment reports: no order inspection, no success/failure claim; authorized manual investigation via the gateway dashboard only. |
| K | Missing information → INSUFFICIENT_EVIDENCE with what is missing and how to obtain it (legacy snapshot, UNKNOWN status, unknown version, unclassifiable checkout implementation, skipped malformed versions). |

Hard invariants (unit-tested): enabled ≠ payment will succeed; configured
checkout page ≠ real checkout works; enabled ≠ block-compatible; user
symptom ≠ verified fact; absent legacy fields ≠ WooCommerce disabled.

## Database

Migration `20261027142903_init_m7_woocommerce` (dev + test DBs, validated,
client regenerated): `WooCommerceDiagnostic` (bounded snapshot COPY, never
an FK to the live latest-only snapshot row; symptom category allowlist;
`checkoutType` BLOCK|CLASSIC|UNKNOWN user-reported only; `affectedScope`
ONE|MULTIPLE|UNKNOWN; `startedAt` free-text ≤200; `errorExcerpt` ≤2000,
server-redacted), `WooCommerceDiagnosticFinding` (Tool 02 finding shape),
`WooCommerceAiAnalysis` (1:1, schemaVersion "woocommerce-1", regeneration
overwrites; never modifies deterministic rows). Never stored: payment
secrets, card data, customer data, order records, transaction data,
connector credentials, gateway settings.

## API routes (mirror Tool 02 conventions)

- `POST /api/woocommerce-diagnostics` — websiteId + symptom fields only
  (checkoutType, affectedScope, startedAt, errorExcerpt); client snapshot,
  gateway config, payment status, connectorId, ownerId ignored; 10 KiB body;
  per-user in-memory limiter 20/hour (single-process); identical 404;
  422 stale/missing/invalid with re-sync instructions.
- `GET /api/woocommerce-diagnostics` — own only, desc, bounded paging.
- `GET /api/woocommerce-diagnostics/[id]` — ownership in WHERE.
- `GET /api/woocommerce-diagnostics/snapshot?websiteId=` — own website only;
  WooCommerce summary (status/version/pages/gateways id+title+enabled+
  blockCompatibility); no secrets.
- `POST/GET /api/woocommerce-diagnostics/[id]/ai-analysis` — explicit user
  trigger only; reuses the M4 OpenAI adapter + shared AI rate limiter
  (10/day/user); input = verified findings + minimal non-sensitive gateway
  metadata + normalized page config + versions + symptom + sanitized excerpt
  ONLY; validation rejects unknown/duplicate finding refs, invented payment
  success, invented order creation/status, credential-validity claims,
  confirmed-cause claims, and dangerous actions (live payments, refunds,
  order changes, webhook changes, live-site switches). Unconfigured AI →
  503 AI_NOT_CONFIGURED; the deterministic report stands alone. No mock AI
  content in production.

## UI

`/tools/woocommerce-checkout-checker` (website select with connection +
freshness, snapshot review, symptom form with checkout-type-if-known,
affected scope, when started, redacted-excerpt warning, Run with loading
state + duplicate-submit prevention, "live site is not modified" notice),
`/history`, `/[id]` (deterministic findings + AI section SEPARATE +
manual-only safe next steps), header link when signed in. No fake progress
percentages, no "live payment test running" claim, no repair / order /
payment-test entry point. All user/plugin content escaped by React.

## Safe next steps (manual only, labelled manual)

Review page assignments in WooCommerce settings; check gateway docs for
block support; test in staging; authorized manual investigation of
pending/failed payments via the gateway dashboard — never executed by the app.

## Versions / configurations actually tested

- Local wp-dev: WordPress 7.1.3, PHP 8.3.6, WooCommerce **11.2.1**,
  active theme Oishi, active plugins at integration time: Contact Form 7,
  Elementor, Mivloo Core, WooCommerce, Yoast SEO.
- Real collector run against wp-dev (read-only bootstrap probe, no pairing,
  no sync, no site modification): schema v3, WooCommerce AVAILABLE 11.2.1,
  pages cart id 8 / checkout id 9 / myAccount id 10 — all distinct,
  published; cart + checkout block, myAccount classic-shortcode; gateways
  bacs (disabled), cheque (disabled), cod (enabled, blockCompatibility
  UNKNOWN). That real snapshot validates server-side and the engine yields
  exactly Rule G (cod unknown compat on block checkout, POTENTIAL) + Rule I
  (symptom context) — no false positives. Note: earlier M6 notes listed 8
  plugins on wp-dev; the current active list is the 5 above (inventory
  changes since M6 are not investigated here — the collector reports what
  is present now).
- Pairing + sync end-to-end was NOT re-run for v3 in this milestone: the
  pairing/diagnostics route code is unchanged from M5/M6 except that the
  validator now also accepts v3, and the DB tests seed real-shaped v3
  payloads through the same service path. The wp-dev site was left clean:
  no connector plugin was installed there and no wp-config change was made
  for this integration probe.
- AI: no live provider key exists (`.env.local` has no AI vars), so
  production AI returns 503 AI_NOT_CONFIGURED; all provider tests use mocks.

## Limitations

- Block compatibility is UNKNOWN for every gateway from the current
  collector (see above) — a gateway may be fully block-compatible and this
  report will still say unknown until a trustworthy declaration source exists.
- `available` (checkout-time gateway availability) is not determinable in
  the admin sync context and is always null; it is not the same as `enabled`.
- A clean configuration report is not a guarantee that a real checkout will
  succeed (cart contents, shipping/tax rules, currency, customer location,
  and gateway account state are not inspected).
- In-memory rate limiters are single-process only (same limitation as
  Tools 01/02).
- Browser Playwright E2E was NOT RUN (no browser binary in this VM).

## Deployment requirements

- Prisma migration `20261027142903_init_m7_woocommerce` applied to the
  deployment database; client regenerated.
- Connector plugin 1.2.0 on customer sites for v3 snapshots (older plugins
  keep working with degraded Rule K reporting).
- Production SaaS domain still unconfirmed (see Milestone 5 note): it must
  be supplied via the plugin's `WP_DOCTOR_AI_API_BASE_URL` constant.

## Still NOT built (after Milestone 7)

Tool 04, Elementor troubleshooting, automatic repairs, production site
modification, live payment execution, order management automation,
payment-provider SDKs, remote-control capability, and any later milestone.
