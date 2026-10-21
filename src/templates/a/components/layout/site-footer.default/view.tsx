import { ActionLink } from "@/templates/a/components/shared/action-link";
import { Button } from "@/templates/a/components/ui/button";
import { Body } from "@/templates/a/components/ui/typography/Body";
import { Heading } from "@/templates/a/components/ui/typography/Heading";

import { NewsletterForm } from "./newsletter-form";

export type SiteFooterLink = {
  label: string;
  href: string;
};

export type SiteFooterNavGroup = {
  title: string;
  links: readonly SiteFooterLink[];
};

export type SiteFooterStore = {
  name: string;
  addressLines: readonly string[];
  phone: string;
};

export type SiteFooterNewsletter = {
  title: string;
  description: string;
  emailLabel: string;
  placeholder: string;
  submitLabel: string;
  successMessage: string;
  privacyNote: string;
};

export type SiteFooterProps = {
  id: string;
  brandName: string;
  brandDescription: string;
  orderAction: SiteFooterLink;
  newsletter: SiteFooterNewsletter;
  navGroups: readonly SiteFooterNavGroup[];
  stores: readonly SiteFooterStore[];
  hoursTitle: string;
  hoursLines: readonly string[];
  socialTitle: string;
  social: readonly { label: string; href: string }[];
  legalLinks: readonly SiteFooterLink[];
  copyright: string;
};

const columnLabelClass = "t-eyebrow text-foreground/60";
const columnLinkClass =
  "text-sm text-foreground/80 transition-colors duration-300 hover:text-primary";

export default function SiteFooterView({
  id,
  brandName,
  brandDescription,
  orderAction,
  newsletter,
  navGroups,
  stores,
  hoursTitle,
  hoursLines,
  socialTitle,
  social,
  legalLinks,
  copyright,
}: SiteFooterProps) {
  return (
    <footer
      id={id}
      data-codeforma-layout-slot="footer"
      className="border-t border-border bg-secondary"
    >
      <div className="border-b border-border/70">
        <div className="container-site py-12 tablet:py-16">
          <div className="grid gap-8 desktop:grid-cols-[1.1fr_1fr] desktop:items-center">
            <div>
              <Heading
                level={2}
                id={`${id}-newsletter-heading`}
                variant="title-lg"
                className="text-primary"
              >
                {newsletter.title}
              </Heading>
              <Body size="md" className="mt-3 max-w-[52ch] text-foreground/75">
                {newsletter.description}
              </Body>
            </div>
            <div>
              <NewsletterForm
                emailLabel={newsletter.emailLabel}
                placeholder={newsletter.placeholder}
                submitLabel={newsletter.submitLabel}
                successMessage={newsletter.successMessage}
              />
              <p className="mt-3 text-xs text-foreground/60">{newsletter.privacyNote}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container-site grid gap-10 py-14 tablet:grid-cols-2 tablet:py-16 desktop:grid-cols-12">
        <div className="desktop:col-span-4">
          <p className="font-heading text-xl font-semibold text-primary">{brandName}</p>
          <Body size="sm" className="mt-3 max-w-[38ch] text-foreground/75">
            {brandDescription}
          </Body>
          <Button asChild className="mt-5">
            <ActionLink href={orderAction.href} label={orderAction.label} />
          </Button>
          <div className="mt-6">
            <p className={columnLabelClass}>{socialTitle}</p>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {social.map((item) => (
                <li key={item.href}>
                  <ActionLink
                    href={item.href}
                    label={item.label}
                    className="text-sm text-foreground/70 transition-colors duration-300 hover:text-primary"
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {navGroups.map((group) => (
          <div key={group.title} className="desktop:col-span-2">
            <p className={columnLabelClass}>{group.title}</p>
            <ul className="mt-4 space-y-2.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <ActionLink href={link.href} label={link.label} className={columnLinkClass} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="desktop:col-span-2">
          <p className={columnLabelClass}>{hoursTitle}</p>
          <ul className="mt-4 space-y-2">
            {hoursLines.map((line) => (
              <li key={line} className="text-sm text-foreground/75">
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-5 desktop:col-span-2">
          {stores.map((store) => (
            <div key={store.name}>
              <p className="text-sm font-semibold text-foreground">{store.name}</p>
              <address className="mt-1 not-italic text-sm text-foreground/75">
                {store.addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <p className="mt-1 text-sm text-foreground/75">{store.phone}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border/70">
        <div className="container-site flex flex-col gap-4 py-6 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-xs text-foreground/60">{copyright}</p>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {legalLinks.map((link, index) => (
              <li key={link.href} className="flex items-center gap-3">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-foreground/40">
                    ·
                  </span>
                ) : null}
                <ActionLink
                  href={link.href}
                  label={link.label}
                  className="text-xs text-foreground/60 transition-colors duration-300 hover:text-primary"
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
