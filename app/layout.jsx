import "./globals.css";
import SiteHeader from "../components/SiteHeader";
import PageFooter from "../components/PageFooter";

export const metadata = {
  title: "WP Doctor AI — WordPress Troubleshooting & Expert Repair",
  description:
    "WP Doctor AI will diagnose WordPress website problems with evidence-based checks and connect owners with expert repair. Milestone 0 foundation only.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen min-w-0 flex-col">
        <SiteHeader />
        <div className="min-w-0 flex-1">{children}</div>
        <PageFooter />
      </body>
    </html>
  );
}
