import { mediaPathError, remoteMediaHosts } from "./media-policy.mjs";
import type { SiteMedia } from "../generated/types";
import { siteMediaBinding } from "./media-binding";
export type MediaInput = SiteMedia;
export interface ResolvedMedia {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  editRef?: string;
}
export class MediaResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "MediaResolutionError";
  }
}
export function resolveMedia(
  media: SiteMedia,
  options: { publicDir?: string } = {},
): ResolvedMedia {
  const issue = mediaPathError(media.path, options.publicDir);
  if (issue) throw new MediaResolutionError("MEDIA_PATH_INVALID", issue);
  const editRef = siteMediaBinding(media);
  return {
    src: media.path,
    alt: media.alt,
    width: media.width,
    height: media.height,
    ...(editRef === undefined ? {} : { editRef }),
  };
}

export const allowedRemoteMediaHosts = new Set(remoteMediaHosts);
