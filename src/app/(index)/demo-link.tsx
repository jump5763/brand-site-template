"use client";

import type { ReactNode, MouseEvent } from "react";

export function DemoLink({ hostname, children }: { hostname: string; children: ReactNode }) {
  function openSite(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const target = new URL(window.location.href);
    target.hostname = hostname;
    target.pathname = "/";
    target.search = "";
    target.hash = "";
    window.location.assign(target);
  }
  return <a href={`http://${hostname}:3000/`} onClick={openSite} className="rounded-xl border p-6 transition-colors hover:bg-secondary">{children}</a>;
}
