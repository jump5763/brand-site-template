import type { ReactNode } from "react";
import Link from "next/link";

export type ActionLinkProps = {
  href: string;
  label: string;
  className?: string;
  children?: ReactNode;
};

/** Internal Site Schema links resolve to site-relative paths; everything else leaves the app. */
export function isExternalHref(href: string) {
  return !href.startsWith("/");
}

/**
 * Renders one resolved Site Schema action. Internal targets use client navigation,
 * external targets open safely in a new tab. Used as the child of `Button asChild`.
 */
export function ActionLink({ href, label, className, children }: ActionLinkProps) {
  if (isExternalHref(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {children ?? label}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children ?? label}
    </Link>
  );
}
