"use client";

import Container from "./Container";
import LogoutButton from "./LogoutButton";
import { useSession } from "../lib/auth-client";

export default function SiteHeader() {
  const { data: session, isPending } = useSession();
  return (
    <header className="border-b border-slate-200 bg-white">
      <Container>
        <nav className="flex items-center justify-between py-4" aria-label="Primary">
          <a href="/" className="text-base font-bold text-ink">
            WP Doctor AI
          </a>
          <ul className="flex items-center gap-5 text-sm">
            <li>
              <a href="/" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                Home
              </a>
            </li>
            {isPending ? null : session ? (
              <>
                <li>
                  <a href="/dashboard" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Dashboard
                  </a>
                </li>
                <li>
                  <a href="/tools/error-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Error Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/plugin-theme-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Plugin &amp; Theme Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/woocommerce-checkout-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    WooCommerce Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/elementor-layout-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Elementor Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/website-speed-analyzer" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Speed Analyzer
                  </a>
                </li>
                <li>
                  <a href="/tools/ssl-redirect-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    SSL Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/contact-email-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Contact &amp; Email Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/security-scanner" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Security Scanner
                  </a>
                </li>
                <li>
                  <a href="/tools/malware-recovery" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Malware Recovery
                  </a>
                </li>
                <li>
                  <a href="/tools/backup-restore-migration" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Backup &amp; Migration
                  </a>
                </li>
                <li>
                  <a href="/tools/seo-spam-checker" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    SEO Checker
                  </a>
                </li>
                <li>
                  <a href="/tools/uptime-monitor" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Uptime Monitor
                  </a>
                </li>
                <li>
                  <LogoutButton className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium" />
                </li>
              </>
            ) : (
              <>
                <li>
                  <a href="/login" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Log in
                  </a>
                </li>
                <li>
                  <a href="/register" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                    Register
                  </a>
                </li>
              </>
            )}
          </ul>
        </nav>
      </Container>
    </header>
  );
}
