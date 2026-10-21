import type { ReactNode } from "react";
import "@/styles/base.css";
import "./index.css";

export default function IndexLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
