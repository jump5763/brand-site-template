import { loadSiteSchema } from "@/site-schema/runtime/load-site";
import { themeToCssVariables } from "@/site-schema/runtime/apply-theme";
import "./globals.css";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const site = await loadSiteSchema();
  return (
    <html lang="en">
      <body
        style={themeToCssVariables(site.theme)}
        className="bg-background font-sans text-foreground antialiased"
      >
        <span id="top" aria-hidden="true" className="absolute" />
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}
