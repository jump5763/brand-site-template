import type {ComponentProps} from "react";
// This helper is client-safe and keeps the shared Image bound to current.json media.
// eslint-disable-next-line no-restricted-imports
import {mediaEditingProps} from "@/site-schema/runtime/media-binding";

type NativeImageProps = ComponentProps<"img">;
type SharedImageProps = Omit<NativeImageProps, "src" | "alt">;
export type BoundImageMedia = Readonly<{
  src: string;
  alt: string;
  editRef?: string;
}>;

export type ImageProps = SharedImageProps & (
  | {media: BoundImageMedia; src?: never; alt?: never}
  | {media?: never; src?: NativeImageProps["src"]; alt?: NativeImageProps["alt"]}
);

declare const process: {
  env: {
    NEXT_PUBLIC_IMAGE_CDN?: string;
  };
};

function resolveImageSource(src: NativeImageProps["src"]) {
  const cdnBaseUrl = typeof process === "undefined"
    ? ""
    : process.env.NEXT_PUBLIC_IMAGE_CDN?.replace(/\/+$/, "") ?? "";

  if (typeof src !== "string" || !src.startsWith("/") || src.startsWith("//") || cdnBaseUrl.length === 0) {
    return src;
  }

  return `${cdnBaseUrl}${src}`;
}

export function Image({media, src, alt, ...props}: ImageProps) {
  const imageSource = media?.src ?? src;
  const imageAlt = media?.alt ?? alt;

  return (
    // The shared component intentionally stays framework-agnostic.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      {...(media === undefined ? {} : mediaEditingProps(media))}
      src={resolveImageSource(imageSource)}
      alt={imageAlt}
    />
  );
}
