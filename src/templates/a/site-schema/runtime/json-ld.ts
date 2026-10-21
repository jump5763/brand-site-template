export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

export function jsonLdProps(value: unknown) {
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: { __html: serializeJsonLd(value) },
  } as const;
}
