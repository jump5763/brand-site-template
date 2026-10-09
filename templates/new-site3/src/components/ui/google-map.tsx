import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

type GoogleMapProps = Omit<
  ComponentPropsWithRef<"div">,
  "children" | "dangerouslySetInnerHTML"
> & {
  apiKey?: string;
  mode: "place";
  query: string;
  zoom?: number;
};

const MAP_API_KEY = "AIzaSyB__Z322kpAr4jZbdZBXKSGyxRs9ypfxlw";
const DEFAULT_QUERY = "place_id:ChIJ4zGFAZpYwokRGUGph3Mf37k";

function GoogleMap({
  apiKey = MAP_API_KEY,
  mode = "place",
  query = DEFAULT_QUERY,
  zoom = 16,
  title = "Interactive Google map",
  className,
  ref,
  ...props
}: GoogleMapProps) {
  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    zoom: String(zoom),
  });

  return (
    <div ref={ref} className={cn("size-full", className)} {...props}>
      <iframe
        src={`https://www.google.com/maps/embed/v1/${mode}?${params}`}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="size-full border-0"
      />
    </div>
  );
}

export { GoogleMap, type GoogleMapProps };
