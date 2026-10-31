import { getBuildSites } from "@/server/build-input.mjs";
import { DemoLink } from "./demo-link";

export const metadata = { title: "Brand Site · 模板预览", robots: { index: false, follow: false } };

export default function IndexPage() {
  const sites = process.env.NODE_ENV === "development" ? getBuildSites() : [];
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-semibold">Brand Site 模板预览</h1>
      <p className="mt-4 text-muted-foreground">模板由 Builder 安装并装配到运行包。公开站点请使用商家域名访问。</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {sites.map((site) => (
          <DemoLink key={site.id} hostname={site.hostname}>
            <strong className="block text-xl">{site.name}</strong>
            <span className="mt-2 block text-sm text-muted-foreground">{site.hostname}</span>
          </DemoLink>
        ))}
      </div>
    </main>
  );
}
