import "./globals.css";
import SiteHeader from "../components/SiteHeader";

export const metadata = {
  title: "WP Doctor AI — WordPress Troubleshooting & Expert Repair",
  description:
    "WP Doctor AI will diagnose WordPress website problems with evidence-based checks and connect owners with expert repair. Milestone 0 foundation only.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
