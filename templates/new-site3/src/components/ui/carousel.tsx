"use client";

import * as React from "react";
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CarouselApi = UseEmblaCarouselType[1];
type EmblaOptions = NonNullable<Parameters<typeof useEmblaCarousel>[0]>;
type WithoutDirection<T> = Omit<T, "axis" | "direction"> & {
  axis?: never;
  direction?: never;
};
type CarouselOptions = WithoutDirection<Omit<EmblaOptions, "breakpoints">> & {
  breakpoints?: Record<
    string,
    WithoutDirection<Omit<EmblaOptions, "breakpoints">>
  >;
};
type CarouselProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "dir" | "role"
> & {
  opts?: CarouselOptions;
  plugins?: Parameters<typeof useEmblaCarousel>[1];
  orientation?: "horizontal" | "vertical";
  dir?: "ltr" | "rtl";
  role?: "group" | "region";
  setApi?: (api: CarouselApi) => void;
};
type CarouselContextProps = {
  carouselRef: UseEmblaCarouselType[0];
  api: CarouselApi;
  orientation: "horizontal" | "vertical";
  dir: "ltr" | "rtl";
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
};

const CarouselContext = React.createContext<CarouselContextProps | null>(null);
const getServerScrollState = () => 0;

function useCarouselContext() {
  const context = React.useContext(CarouselContext);
  if (!context)
    throw new Error("useCarousel must be used within a <Carousel />");
  return context;
}

// Only for descendants of Carousel. API reads do not subscribe to selection;
// pagination must synchronize selectedScrollSnap/scrollSnapList on select/reInit.
function useCarousel() {
  const {
    api,
    orientation,
    dir,
    scrollPrev,
    scrollNext,
    canScrollPrev,
    canScrollNext,
  } = useCarouselContext();
  return {
    api,
    orientation,
    dir,
    scrollPrev,
    scrollNext,
    canScrollPrev,
    canScrollNext,
  };
}

function assertDirectionOptions(opts: CarouselOptions | undefined) {
  for (const [scope, options] of [
    ["opts", opts],
    ...Object.entries(opts?.breakpoints ?? {}),
  ] as const) {
    if (options && ("axis" in options || "direction" in options)) {
      throw new Error(
        `CAROUSEL_DIRECTION_CONFLICT: ${scope} must use the root orientation/dir props instead of axis/direction`,
      );
    }
  }
}

// One Content per root. Supply aria-label or aria-labelledby for the root and
// each Item. Embla owns its API; setApi borrows it and receives undefined on
// effect cleanup. Use a stable, idempotent callback (a React setter works).
const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  (
    {
      orientation = "horizontal",
      dir = "ltr",
      role = "group",
      opts,
      plugins,
      setApi,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    assertDirectionOptions(opts);
    if (
      !["horizontal", "vertical"].includes(orientation) ||
      !["ltr", "rtl"].includes(dir)
    ) {
      throw new Error(
        "CAROUSEL_DIRECTION_INVALID: expected horizontal/vertical and ltr/rtl",
      );
    }
    const [carouselRef, api] = useEmblaCarousel(
      {
        ...opts,
        axis: orientation === "horizontal" ? "x" : "y",
        direction: dir,
      },
      plugins,
    );
    const subscribe = React.useCallback(
      (onChange: () => void) => {
        api?.on("select", onChange);
        api?.on("reInit", onChange);
        return () => {
          api?.off("select", onChange);
          api?.off("reInit", onChange);
        };
      },
      [api],
    );
    const getSnapshot = React.useCallback(
      () => (api?.canScrollPrev() ? 1 : 0) | (api?.canScrollNext() ? 2 : 0),
      [api],
    );
    const scrollState = React.useSyncExternalStore(
      subscribe,
      getSnapshot,
      getServerScrollState,
    );
    const scrollPrev = React.useCallback(() => {
      api?.scrollPrev();
    }, [api]);
    const scrollNext = React.useCallback(() => {
      api?.scrollNext();
    }, [api]);

    React.useEffect(() => {
      if (!api || !setApi) return;
      setApi(api);
      return () => setApi(undefined);
    }, [api, setApi]);

    return (
      <CarouselContext.Provider
        value={{
          carouselRef,
          api,
          orientation,
          dir,
          scrollPrev,
          scrollNext,
          canScrollPrev: (scrollState & 1) !== 0,
          canScrollNext: (scrollState & 2) !== 0,
        }}
      >
        <div
          {...props}
          ref={ref}
          dir={dir}
          role={role}
          aria-roledescription={props["aria-roledescription"] ?? "carousel"}
          data-orientation={orientation}
          className={cn("relative", className)}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  },
);
Carousel.displayName = "Carousel";

// viewportClassName styles the overflow wrapper. className, ref, style, and
// other DOM props target the track. Size, gap, and control placement are CSS.
const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { viewportClassName?: string }
>(({ className, viewportClassName, ...props }, ref) => {
  const { carouselRef, orientation } = useCarouselContext();
  return (
    <div ref={carouselRef} className={cn("overflow-hidden", viewportClassName)}>
      <div
        {...props}
        ref={ref}
        className={cn(
          "flex",
          orientation === "horizontal"
            ? "[touch-action:pan-y_pinch-zoom]"
            : "flex-col [touch-action:pan-x_pinch-zoom]",
          className,
        )}
      />
    </div>
  );
});
CarouselContent.displayName = "CarouselContent";

const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    role="group"
    aria-roledescription="slide"
    {...props}
    ref={ref}
    className={cn("min-h-0 min-w-0 shrink-0 grow-0 basis-full", className)}
  />
));
CarouselItem.displayName = "CarouselItem";

type CarouselControlProps = Omit<
  React.ComponentProps<typeof Button>,
  "asChild"
> & { asChild?: never };

// Controls remain native buttons. Custom children replace the default icon and
// text, so icon-only replacements must provide an accessible name.
const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  CarouselControlProps
>(
  (
    {
      className,
      variant = "outline",
      size = "icon",
      type = "button",
      disabled,
      onClick,
      children,
      ...props
    },
    ref,
  ) => {
    const { orientation, dir, scrollPrev, canScrollPrev } = useCarousel();
    return (
      <Button
        {...props}
        ref={ref}
        asChild={false}
        type={type}
        variant={variant}
        size={size}
        className={cn("rounded-full", className)}
        disabled={Boolean(disabled) || !canScrollPrev}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) scrollPrev();
        }}
      >
        {children ?? (
          <>
            <ArrowLeft
              aria-hidden="true"
              className={cn(
                "h-4 w-4",
                orientation === "vertical"
                  ? "rotate-90"
                  : dir === "rtl"
                    ? "rotate-180"
                    : "",
              )}
            />
            <span className="sr-only">Previous slide</span>
          </>
        )}
      </Button>
    );
  },
);
CarouselPrevious.displayName = "CarouselPrevious";

const CarouselNext = React.forwardRef<HTMLButtonElement, CarouselControlProps>(
  (
    {
      className,
      variant = "outline",
      size = "icon",
      type = "button",
      disabled,
      onClick,
      children,
      ...props
    },
    ref,
  ) => {
    const { orientation, dir, scrollNext, canScrollNext } = useCarousel();
    return (
      <Button
        {...props}
        ref={ref}
        asChild={false}
        type={type}
        variant={variant}
        size={size}
        className={cn("rounded-full", className)}
        disabled={Boolean(disabled) || !canScrollNext}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) scrollNext();
        }}
      >
        {children ?? (
          <>
            <ArrowRight
              aria-hidden="true"
              className={cn(
                "h-4 w-4",
                orientation === "vertical"
                  ? "rotate-90"
                  : dir === "rtl"
                    ? "rotate-180"
                    : "",
              )}
            />
            <span className="sr-only">Next slide</span>
          </>
        )}
      </Button>
    );
  },
);
CarouselNext.displayName = "CarouselNext";

export {
  type CarouselApi,
  type CarouselOptions,
  type CarouselProps,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  useCarousel,
};
