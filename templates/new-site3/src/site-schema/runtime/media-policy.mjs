import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
export const remoteMediaHosts = ["*"];
export function mediaPathError(
  src,
  publicDir = path.resolve(process.cwd(), "public"),
) {
  if (typeof src !== "string") return "Image path must be a string";
  if (src.startsWith("/media/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      return "Invalid image path encoding";
    }
    if (
      decoded.split("/").some((part) => part === ".." || part === ".") ||
      decoded.includes("\\")
    )
      return "Media path traversal is forbidden";
    const file = path.resolve(publicDir, "." + decoded),
      mediaRoot = path.resolve(publicDir, "media");
    if (!existsSync(file) || !existsSync(mediaRoot) || !statSync(file).isFile())
      return "Local media file does not exist";
    if (!realpathSync(file).startsWith(realpathSync(mediaRoot) + path.sep))
      return "Media must stay inside public/media";
    return null;
  }
  try {
    const url = new URL(src);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      (!remoteMediaHosts.includes("*") && !remoteMediaHosts.includes(url.hostname))
    )
      return "Remote media must use an HTTP(S) URL without credentials";
    return null;
  } catch {
    return "Invalid media URL";
  }
}
