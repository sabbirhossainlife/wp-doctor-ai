// Pure presentational navigation data for the 12 diagnostic tools.
// Source of truth for header dropdown, mobile drawer, homepage grid and
// dashboard quick actions. No business logic, no fetching, no secrets.
// Status flags are honest labels only: they never change a tool's behaviour.

export const TOOL_CATEGORIES = [
  {
    id: "diagnostics-performance",
    label: "Diagnostics & Performance",
    tools: [
      {
        href: "/tools/error-checker",
        name: "Website Error Checker",
        short: "Error Checker",
        description:
          "Public availability, HTTP status, redirects and timeouts — with evidence, not guesses.",
        status: "ready",
      },
      {
        href: "/tools/website-speed-analyzer",
        name: "Website Speed Analyzer",
        short: "Speed Analyzer",
        description:
          "Lab and field speed signals, kept separate. Lab scores are never presented as ranking scores.",
        status: "ready",
      },
    ],
  },
  {
    id: "compatibility-commerce",
    label: "Compatibility & Commerce",
    tools: [
      {
        href: "/tools/plugin-theme-checker",
        name: "Plugin & Theme Conflict Checker",
        short: "Plugin & Theme Checker",
        description:
          "Read-only diagnostics from an authorized WordPress connector. No automatic deactivation.",
        status: "ready",
      },
      {
        href: "/tools/woocommerce-checkout-checker",
        name: "WooCommerce Checkout Checker",
        short: "WooCommerce Checker",
        description:
          "Configuration and error evidence only. No real payments, no order changes.",
        status: "ready",
      },
      {
        href: "/tools/elementor-layout-checker",
        name: "Elementor & Layout Checker",
        short: "Elementor Checker",
        description:
          "Editor and asset-loading evidence, with visual symptoms kept separate from technical facts.",
        status: "ready",
      },
    ],
  },
  {
    id: "ssl-email",
    label: "SSL & Email",
    tools: [
      {
        href: "/tools/ssl-redirect-checker",
        name: "SSL & Redirect Checker",
        short: "SSL Checker",
        description:
          "Certificate verification and redirect chains, checked separately and honestly.",
        status: "ready",
      },
      {
        href: "/tools/contact-email-checker",
        name: "Contact & Email Checker",
        short: "Contact & Email Checker",
        description:
          "Contact-form and mail configuration evidence. Nothing is sent or submitted.",
        status: "ready",
      },
    ],
  },
  {
    id: "security-recovery",
    label: "Security & Recovery",
    tools: [
      {
        href: "/tools/security-scanner",
        name: "Security & Vulnerability Scanner",
        short: "Security Scanner",
        description:
          "Advisory matches and hardening observations. No result here ever means a site is completely secure.",
        status: "ready",
      },
      {
        href: "/tools/malware-recovery",
        name: "Malware & Hack Recovery",
        short: "Malware Recovery",
        description:
          "File-integrity and signature evidence from connector snapshots. Nothing is cleaned or changed.",
        status: "ready",
      },
      {
        href: "/tools/backup-restore-migration",
        name: "Backup, Restore & Migration Assistant",
        short: "Backup & Migration",
        description:
          "Backup creation and planning are supported; live restore and migration execution are blocked.",
        status: "partial",
        statusLabel: "Partial — restore/migration execution blocked",
      },
    ],
  },
  {
    id: "seo-monitoring",
    label: "SEO & Monitoring",
    tools: [
      {
        href: "/tools/seo-spam-checker",
        name: "SEO Spam & Indexing Checker",
        short: "SEO Checker",
        description:
          "SEO signals and conservative spam indicators for human review. Search Console is not connected.",
        status: "ready",
      },
      {
        href: "/tools/uptime-monitor",
        name: "Uptime & Maintenance Monitor",
        short: "Uptime Monitor",
        description:
          "Single-location reachability checks for registered sites. Recurring checks need an external scheduler.",
        status: "scheduler-inactive",
        statusLabel: "Scheduler inactive",
      },
    ],
  },
];

export const ALL_TOOLS = TOOL_CATEGORIES.flatMap((category) =>
  category.tools.map((tool) => ({ ...tool, category: category.label })),
);

export const TOOL_HREFS = ALL_TOOLS.map((tool) => tool.href);
