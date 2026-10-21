import Link from "next/link";
import { Leaf } from "lucide-react";

import { SiteContainer } from "@/templates/b/components/shared/site-container";

export type FooterInfoLink = { id: string; label: string; href: string };

export type FooterInfoColumn = {
  id: string;
  title: string;
  links: readonly FooterInfoLink[];
};

export type FooterInfoProps = {
  id: string;
  brandName: string;
  tagline: string;
  note?: string;
  copyright: string;
  columns: readonly FooterInfoColumn[];
  contact: {
    title: string;
    addressLines: readonly string[];
    phone: string;
    email: string;
  };
  hours: {
    title: string;
    rows: readonly { id: string; days: string; time: string }[];
  };
};

const columnHeadingClass =
  "font-body text-[12px] uppercase tracking-[0.14em] text-primary";
const linkClass =
  "font-body text-sm text-foreground/80 transition-colors hover:text-primary";

export default function FooterInfoView({
  id,
  brandName,
  tagline,
  note,
  copyright,
  columns,
  contact,
  hours,
}: FooterInfoProps) {
  return (
    <footer
      id={id}
      data-codeforma-layout-slot="footer"
      className="border-t border-border bg-secondary/40"
    >
      <SiteContainer className="py-16 tablet:py-20">
        <div className="grid gap-12 tablet:grid-cols-2 desktop:grid-cols-[1.3fr_1fr_1fr_1.2fr] desktop:gap-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Leaf aria-hidden="true" size={18} />
              </span>
              <span className="font-heading text-[15px] font-semibold uppercase tracking-[0.18em] text-foreground">
                {brandName}
              </span>
            </div>
            <p className="mt-5 max-w-[34ch] font-body text-sm leading-[1.7] text-muted-foreground">
              {tagline}
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.id}>
              <h2 className={columnHeadingClass}>{column.title}</h2>
              <ul className="mt-5 space-y-3">
                {column.links.map((link) => (
                  <li key={link.id}>
                    {link.href.startsWith("/") ? (
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h2 className={columnHeadingClass}>{contact.title}</h2>
            <p className="mt-5 font-body text-sm text-muted-foreground">
              {contact.addressLines.map((line, index) => (
                <span key={index} className="block">
                  {line}
                </span>
              ))}
            </p>
            <p className="mt-3 font-body text-sm text-muted-foreground">
              {contact.phone}
            </p>
            <p className="mt-1 font-body text-sm text-muted-foreground">
              {contact.email}
            </p>
          </div>

          <div>
            <h2 className={columnHeadingClass}>{hours.title}</h2>
            <dl className="mt-5 space-y-3">
              {hours.rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="font-body text-[13px] text-foreground">
                    {row.days}
                  </dt>
                  <dd className="font-body text-[13px] text-muted-foreground">
                    {row.time}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-border pt-6 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="font-body text-[13px] text-muted-foreground">
            {copyright}
          </p>
          {note ? (
            <p className="font-body text-[13px] text-muted-foreground">{note}</p>
          ) : null}
        </div>
      </SiteContainer>
    </footer>
  );
}
