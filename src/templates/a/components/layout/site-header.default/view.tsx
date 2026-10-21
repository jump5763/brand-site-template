"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { publicPathname } from "@/site-routing.mjs";
import { Menu } from "lucide-react";

import { ActionLink, isExternalHref } from "@/templates/a/components/shared/action-link";
import { Button } from "@/templates/a/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/templates/a/components/ui/sheet";
import { cn } from "@/templates/a/lib/utils";

export type SiteHeaderNavItem = {
  label: string;
  href: string;
};

export type SiteHeaderAction = {
  label: string;
  href: string;
};

export type SiteHeaderProps = {
  id: string;
  brandName: string;
  nav: readonly SiteHeaderNavItem[];
  orderAction: SiteHeaderAction;
  openMenuLabel: string;
  closeMenuLabel: string;
  sheetTitle: string;
};

/** External links never mark the current page; in-page jumps cannot be identified from the path alone. */
function isActiveHref(href: string, pathname: string) {
  if (isExternalHref(href)) return false;
  const [path, fragment] = href.split("#");
  if (fragment) return false;
  return path === pathname;
}

export default function SiteHeaderView({
  id,
  brandName,
  nav,
  orderAction,
  openMenuLabel,
  closeMenuLabel,
  sheetTitle,
}: SiteHeaderProps) {
  const pathname = publicPathname(usePathname());
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinkClass = (href: string) =>
    cn(
      "relative inline-block text-[15px] font-medium leading-none transition-colors duration-300",
      "after:absolute after:inset-x-0 after:-bottom-1.5 after:h-[2px] after:origin-left after:rounded-full after:bg-primary/40 after:transition-transform after:duration-300 after:ease-out after:content-['']",
      isActiveHref(href, pathname)
        ? "text-primary after:scale-x-100"
        : "text-foreground/80 hover:text-primary after:scale-x-0 hover:after:scale-x-100",
    );

  return (
    <header
      id={id}
      data-codeforma-layout-slot="header"
      className={cn(
        "sticky top-0 z-50 border-b transition duration-300",
        isScrolled
          ? "border-border/70 bg-background/90 shadow-sm backdrop-blur"
          : "border-transparent bg-transparent backdrop-blur-none",
      )}
    >
      <div className="container-site flex h-[72px] items-center justify-between gap-6 tablet:h-[88px]">
        <ActionLink
          href="/"
          label={brandName}
          className="font-heading text-[20px] font-semibold tracking-tight text-primary tablet:text-[22px]"
        />

        <nav className="hidden items-center gap-8 desktop:flex">
          {nav.map((item) => (
            <ActionLink
              key={`${item.label}-${item.href}`}
              href={item.href}
              label={item.label}
              className={navLinkClass(item.href)}
            />
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Button asChild size="lg" className="hidden h-11 px-6 text-[15px] desktop:inline-flex">
            <ActionLink href={orderAction.href} label={orderAction.label} />
          </Button>
          <Button asChild size="sm" className="desktop:hidden">
            <ActionLink href={orderAction.href} label={orderAction.label} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="desktop:hidden"
            aria-label={isMenuOpen ? closeMenuLabel : openMenuLabel}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        </div>

        <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <SheetContent side="right" className="w-[86%] max-w-sm" aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle>{sheetTitle}</SheetTitle>
            </SheetHeader>
            <div className="mt-6" onClick={() => setIsMenuOpen(false)}>
              <nav className="flex flex-col">
                {nav.map((item, index) => (
                  <ActionLink
                    key={`${item.label}-${item.href}`}
                    href={item.href}
                    label={item.label}
                    className={cn(
                      "py-3 text-base font-medium transition-colors duration-300",
                      index < nav.length - 1 && "border-b border-border",
                      isActiveHref(item.href, pathname)
                        ? "text-primary"
                        : "text-foreground/80 hover:text-primary",
                    )}
                  />
                ))}
              </nav>
              <Button asChild size="lg" className="mt-8 w-full">
                <ActionLink href={orderAction.href} label={orderAction.label} />
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
