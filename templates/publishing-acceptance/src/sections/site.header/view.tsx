"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Menu } from "lucide-react";

import { SiteContainer } from "@/components/shared/site-container";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type SiteHeaderNavigationItem = {
  id: string;
  label: string;
  href: string;
};

export type SiteHeaderProps = {
  id: string;
  brandName: string;
  brandTagline?: string;
  brandHref: string;
  navigationLabel: string;
  navigation: SiteHeaderNavigationItem[];
  action: { label: string; href: string };
};

const SCROLL_THRESHOLD = 24;

export default function SiteHeaderView({
  id,
  brandName,
  brandTagline,
  brandHref,
  navigationLabel,
  navigation,
  action,
}: SiteHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      id={id}
      className={cn(
        "fixed inset-x-0 top-0 z-50 h-16 border-b border-border/60 bg-background/85 backdrop-blur-md transition-[background-color,box-shadow] duration-300 motion-reduce:transition-none tablet:h-20",
        scrolled &&
          "bg-background/95 shadow-[0_10px_30px_-24px_hsl(var(--primary)/0.45)]",
      )}
    >
      <SiteContainer className="flex h-full items-center justify-between gap-6">
        <a
          href={brandHref}
          className="flex flex-col gap-0.5 transition-opacity hover:opacity-80"
        >
          <span className="font-heading text-[15px] font-semibold uppercase tracking-[0.24em] text-primary tablet:text-[17px]">
            {brandName}
          </span>
          {brandTagline ? (
            <span className="hidden text-[10px] uppercase tracking-[0.3em] text-muted-foreground tablet:block">
              {brandTagline}
            </span>
          ) : null}
        </a>

        <div className="flex items-center gap-4 desktop:gap-6">
          <nav
            aria-label={navigationLabel}
            className="hidden items-center gap-8 desktop:flex"
          >
            {navigation.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className="relative text-[15px] font-medium text-foreground/80 transition-colors after:absolute after:-bottom-1.5 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all after:duration-300 hover:text-primary hover:after:w-full motion-reduce:after:transition-none"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <Button
            asChild
            size="lg"
            className="hidden h-11 rounded-full px-7 tablet:inline-flex"
          >
            <a href={action.href} className="group">
              {action.label}
              <ArrowRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </a>
          </Button>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open main menu"
                aria-expanded={menuOpen}
                className="desktop:hidden"
              >
                <Menu aria-hidden="true" className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[86vw] max-w-sm p-0">
              <div className="flex h-full flex-col overflow-y-auto px-6 py-8">
                <SheetTitle asChild className="sr-only">
                  <span>{navigationLabel}</span>
                </SheetTitle>
                <div className="flex flex-col gap-1">
                  {navigation.map((item) => (
                    <a
                      key={item.id}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="rounded-lg px-4 py-3 text-base font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
                <Button asChild size="lg" className="mt-6 w-full rounded-full">
                  <a href={action.href} onClick={() => setMenuOpen(false)}>
                    {action.label}
                  </a>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </SiteContainer>
    </header>
  );
}
