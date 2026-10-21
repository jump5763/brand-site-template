import { createElement } from "react";
import { cn } from "@/lib/utils";
import { Body, type BodySize } from "@/components/ui/typography/Body";
import { Eyebrow } from "./eyebrow";

export type SectionHeaderProps = {
  headingId: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  eyebrow?: string;
  description?: string;
  descriptionSize?: BodySize;
  align?: "start" | "center";
  className?: string;
  headingClassName?: string;
  descriptionClassName?: string;
};

const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export function SectionHeader({
  headingId,
  headingLevel = 2,
  title,
  eyebrow,
  description,
  descriptionSize,
  align = "start",
  className,
  headingClassName,
  descriptionClassName,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow ? <Eyebrow className="text-primary">{eyebrow}</Eyebrow> : null}
      {createElement(
        headingTags[headingLevel - 1],
        {
          id: headingId,
          className: cn("t-h2", eyebrow ? "mt-3" : undefined, headingClassName),
        },
        title,
      )}
      {description ? (
        <div
          className={cn(
            "mt-4 max-w-[62ch] font-body text-muted-foreground",
            descriptionClassName,
          )}
        >
          <Body as="p" size={descriptionSize ?? "md"}>
            {description}
          </Body>
        </div>
      ) : null}
    </div>
  );
}
