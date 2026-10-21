import type { ReactNode } from "react";
import "@/styles/globals.css";

export default function IndexLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
