import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Write bytes to the cache directory and open the share sheet on them --
 * the way an app hands a file to Files, Drive, mail, or another app. */
export async function saveAndShare(bytes: Uint8Array, name: string, mimeType: string, uti?: string) {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: name });
}

/** Write bytes to the cache and return a file URI an <Image> can show --
 * the way an authenticated image reaches the screen without a data: URI. */
export function cacheImage(bytes: Uint8Array, name: string): string {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}

export function safeFileName(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "kall";
}
