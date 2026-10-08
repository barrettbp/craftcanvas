/**
 * Server only: uploads a thumbnail to Supabase Storage with the service role
 * key and returns a URL the canvas list can render. Env is read when called,
 * never at import time.
 */
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

export type UploadThumbnailInput = {
  bucket: string;
  path: string;
  /** Raw PNG bytes. */
  bytes: Uint8Array;
};

export class ThumbnailUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThumbnailUploadError";
  }
}

/** Uploads (upsert) and returns the public URL of the object. The bucket should be public read. */
export async function uploadThumbnailToSupabase({ bucket, path, bytes }: UploadThumbnailInput): Promise<string> {
  const url = env.supabaseUrl();
  const key = env.supabaseServiceRoleKey();
  if (!url || !key) throw new ThumbnailUploadError("Supabase Storage is not configured");

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = client.storage.from(bucket);
  const { error } = await storage.upload(path, bytes, { contentType: "image/png", upsert: true, cacheControl: "60" });
  if (error) throw new ThumbnailUploadError(error.message);

  const { data } = storage.getPublicUrl(path);
  // Cache bust: the path is stable across uploads, the URL must not be.
  return `${data.publicUrl}?v=${Date.now()}`;
}
