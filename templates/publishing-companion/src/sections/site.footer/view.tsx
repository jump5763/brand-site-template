import { Facebook, Instagram, Link2, Twitter } from "lucide-react";

import { SiteContainer } from "@/components/shared/site-container";
import { Body } from "@/components/ui/typography/Body";

export type SiteFooterStore = {
  id: string;
  name: string;
  addressLine: string;
  cityLine: string;
  phone: string;
};

export type SiteFooterHoursRow = {
  id: string;
  days: string;
  time: string;
};

export type SiteFooterLink = {
  id: string;
  label: string;
  href: string;
};

export type SiteFooterProps = {
  id: string;
  brandName: string;
  headline: string;
  description: string;
  columnTitles: {
    stores: string;
    hours: string;
    explore: string;
    contact: string;
  };
  stores: SiteFooterStore[];
  hours: SiteFooterHoursRow[];
  hoursNote: string;
  explore: SiteFooterLink[];
  contact: {
    email: string;
    phone: string;
    social: SiteFooterLink[];
  };
  legalNote: string;
};

const columnTitleClassName =
  "text-[13px] font-semibold uppercase tracking-[0.18em] text-primary";

function resolveSocialIcon(item: { id: string; label: string }) {
  const tokens = `${item.id} ${item.label}`
    .toLowerCase()
    .split(/[^a-z]+/);
  if (tokens.includes("instagram")) return Instagram;
  if (tokens.includes("facebook")) return Facebook;
  if (tokens.includes("twitter") || tokens.includes("x")) return Twitter;
  return Link2;
}

export default function SiteFooterView({
  id,
  brandName,
  headline,
  description,
  columnTitles,
  stores,
  hours,
  hoursNote,
  explore,
  contact,
  legalNote,
}: SiteFooterProps) {
  const headingId = `${id}-heading`;

  return (
    <footer
      id={id}
      aria-labelledby={headingId}
      className="border-t border-border bg-secondary text-secondary-foreground scroll-mt-24"
    >
      <SiteContainer className="py-14 tablet:py-20">
        <p className="font-heading text-[15px] font-semibold uppercase tracking-[0.24em] text-primary">
          {brandName}
        </p>
        <h2 id={headingId} className="t-h2 mt-4 max-w-[24ch] text-primary">
          {headline}
        </h2>
        <div className="mt-4 max-w-[62ch] text-primary/75">
          <Body as="p" size="md">
            {description}
          </Body>
        </div>

        <div className="mt-12 grid gap-10 tablet:grid-cols-2 desktop:grid-cols-4">
          <div>
            <h3 className={columnTitleClassName}>{columnTitles.stores}</h3>
            <ul className="mt-5 flex flex-col gap-5 text-[14px] leading-[1.6] text-primary/75">
              {stores.map((store) => (
                <li key={store.id}>
                  <p className="font-medium">{store.name}</p>
                  <p>{store.addressLine}</p>
                  <p>{store.cityLine}</p>
                  <p>{store.phone}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={columnTitleClassName}>{columnTitles.hours}</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {hours.map((row) => (
                <li
                  key={row.id}
                  className="flex justify-between gap-6 text-[14px] text-primary/80"
                >
                  <span>{row.days}</span>
                  <span>{row.time}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] text-primary/60">{hoursNote}</p>
          </div>

          <div>
            <h3 className={columnTitleClassName}>{columnTitles.explore}</h3>
            <ul className="mt-5 flex flex-col gap-3">
              {explore.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className="text-[14px] text-primary/80 transition-colors hover:text-primary"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={columnTitleClassName}>{columnTitles.contact}</h3>
            <div className="mt-5 text-[14px] text-primary/80">
              <p>{contact.email}</p>
              <p className="mt-1">{contact.phone}</p>
            </div>
            <ul className="mt-5 flex flex-wrap items-center gap-3">
              {contact.social.map((item) => {
                const Icon = resolveSocialIcon(item);
                const isExternal = item.href.startsWith("http");
                return (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      aria-label={item.label}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noreferrer noopener" : undefined}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/20 text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-primary/10 pt-6 text-[12px] text-primary/60 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="font-heading font-semibold uppercase tracking-[0.24em]">
            {brandName}
          </p>
          <p>{legalNote}</p>
        </div>
      </SiteContainer>
    </footer>
  );
}
