import type { UserJSON, WebhookEvent } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Webhook } from "svix";

import { getDb, users } from "@/db";
import { env } from "@/lib/env";

/**
 * Clerk webhook (delivered through svix).
 *
 * - `user.created`: upsert a `users` row keyed by the Clerk userId.
 * - `user.deleted`: delete the row; FK cascades remove connections, index and canvases.
 *
 * Configure the endpoint in the Clerk dashboard as `<origin>/api/webhooks/clerk`
 * and put its signing secret in `CLERK_WEBHOOK_SECRET`.
 */
export async function POST(req: Request) {
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing_svix_headers" }, { status: 400 });
  }

  const payload = await req.text();

  // `Webhook.verify` throws on a bad signature or stale timestamp.
  try {
    const wh = new Webhook(env.clerkWebhookSecret());
    wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    console.error("[webhooks/clerk] verification failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(payload) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  switch (event.type) {
    case "user.created": {
      const user = event.data;
      await getDb()
        .insert(users)
        .values({ id: user.id, email: primaryEmail(user) })
        .onConflictDoUpdate({ target: users.id, set: { email: primaryEmail(user) } });
      break;
    }
    case "user.deleted": {
      const id = event.data.id;
      if (id) {
        await getDb().delete(users).where(eq(users.id, id));
      }
      break;
    }
    default:
      // Other event types are accepted and ignored.
      break;
  }

  return NextResponse.json({ ok: true });
}

function primaryEmail(user: UserJSON): string | null {
  const primary = user.email_addresses?.find((e) => e.id === user.primary_email_address_id);
  return primary?.email_address ?? user.email_addresses?.[0]?.email_address ?? null;
}
