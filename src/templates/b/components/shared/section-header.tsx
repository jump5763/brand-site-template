import { cn } from "@/templates/b/lib/utils";
import { Body, type BodySize } from "@/templates/b/components/ui/typography/Body";

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
  const HeadingTag = headingTags[headingLevel - 1];

  return (
    <div
      className={cn(
        "flex flex-col",
        align === "center" ? "items-center text-center" : "items-start",
        className,
      )}
    >
      {eyebrow ? <p className="t-eyebrow font-body text-primary">{eyebrow}</p> : null}
      <HeadingTag
        id={headingId}
        className={cn("t-h2", eyebrow ? "mt-3" : undefined, headingClassName)}
      >
        {title}
      </HeadingTag>
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
