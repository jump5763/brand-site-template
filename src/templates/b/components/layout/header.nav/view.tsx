"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { publicPathname } from "@/site-routing.mjs";
import { Leaf, Menu } from "lucide-react";

import { SiteContainer } from "@/templates/b/components/shared/site-container";
import { Button } from "@/templates/b/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/templates/b/components/ui/sheet";
import { cn } from "@/templates/b/lib/utils";

export type HeaderNavItem = { id: string; label: string; href: string };

export type HeaderNavProps = {
  id: string;
  brandName: string;
  items: readonly HeaderNavItem[];
  cta: { label: string; href: string };
};

const navLinkBase =
  "relative inline-flex items-center py-1 font-body text-[14px] tracking-wide transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 hover:text-primary hover:after:scale-x-100";

const mobileLinkBase =
  "block rounded-xl px-4 py-3 font-body text-[15px] transition-colors hover:bg-secondary hover:text-primary";

export default function HeaderNavView({
  id,
  brandName,
  items,
  cta,
}: HeaderNavProps) {
  const pathname = publicPathname(usePathname());
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 25);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Section-anchored links are intentionally never marked as the active page.
  const isActive = (href: string) =>
    href.startsWith("/") && !href.includes("#") && href.split("?")[0] === pathname;

  return (
    <header
      id={id}
      data-codeforma-layout-slot="header"
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-border bg-background/95 shadow-sm backdrop-blur"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <SiteContainer className="flex h-16 items-center justify-between gap-6 tablet:h-20">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Leaf aria-hidden="true" size={18} />
          </span>
          <span className="font-heading text-[15px] font-semibold uppercase tracking-[0.18em] text-foreground">
            {brandName}
          </span>
        </Link>

        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-8 tablet:flex"
        >
          {items.map((item) => {
            const active = isActive(item.href);
            const itemClassName = cn(
              navLinkBase,
              active ? "text-primary after:scale-x-100" : "text-foreground/80",
            );
            return item.href.startsWith("/") ? (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={itemClassName}
              >
                {item.label}
              </Link>
            ) : (
              <a
                key={item.id}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={itemClassName}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        <Button asChild className="hidden h-10 rounded-full px-6 tablet:inline-flex">
          {cta.href.startsWith("/") ? (
            <Link href={cta.href}>{cta.label}</Link>
          ) : (
            <a href={cta.href} target="_blank" rel="noopener noreferrer">
              {cta.label}
            </a>
          )}
        </Button>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              className="tablet:hidden"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="flex w-full max-w-[380px] flex-col p-6"
          >
            <SheetTitle className="sr-only">Site navigation</SheetTitle>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Leaf aria-hidden="true" size={18} />
              </span>
              <span className="font-heading text-[15px] font-semibold uppercase tracking-[0.18em] text-foreground">
                {brandName}
              </span>
            </div>
            <nav
              aria-label="Mobile navigation"
              className="mt-8 flex flex-col gap-1"
            >
              {items.map((item) => {
                const active = isActive(item.href);
                const itemClassName = cn(
                  mobileLinkBase,
                  active ? "bg-secondary text-primary" : undefined,
                );
                return (
                  <SheetClose asChild key={item.id}>
                    {item.href.startsWith("/") ? (
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={itemClassName}
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={itemClassName}
                      >
                        {item.label}
                      </a>
                    )}
                  </SheetClose>
                );
              })}
            </nav>
            <SheetClose asChild>
              <Button asChild className="mt-8 h-11 w-full rounded-full">
                {cta.href.startsWith("/") ? (
                  <Link href={cta.href}>{cta.label}</Link>
                ) : (
                  <a href={cta.href} target="_blank" rel="noopener noreferrer">
                    {cta.label}
                  </a>
                )}
              </Button>
            </SheetClose>
          </SheetContent>
        </Sheet>
      </SiteContainer>
    </header>
  );
}
