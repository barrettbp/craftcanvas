"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { canvases, craftConnections, craftDocuments, getDb, users } from "@/db";
import { log } from "@/lib/log";

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes everything we hold for the signed in user (canvases, document index,
 * encrypted Craft key, users row) in one transaction, then deletes the Clerk
 * user. The Clerk webhook `user.deleted` is a harmless no-op afterwards
 * because the users row is already gone.
 *
 * Returns `{ ok: true }` instead of redirecting: the browser still holds a
 * Clerk session cookie for the deleted user, so the client signs out through
 * Clerk (which clears it) and lands on `/`. A server redirect would bounce a
 * stale session from `/` to `/canvases` until the token expired.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  try {
    await getDb().transaction(async (tx) => {
      await tx.delete(canvases).where(eq(canvases.userId, userId));
      const connections = await tx.select({ id: craftConnections.id }).from(craftConnections).where(eq(craftConnections.userId, userId));
      for (const c of connections) {
        await tx.delete(craftDocuments).where(eq(craftDocuments.connectionId, c.id));
      }
      await tx.delete(craftConnections).where(eq(craftConnections.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
  } catch (err) {
    log.error("settings/deleteAccount database cleanup failed", { userId, err });
    return { ok: false, error: "Could not delete your data. Nothing was removed; please try again." };
  }

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch (err) {
    log.error("settings/deleteAccount Clerk deleteUser failed", { userId, err });
    return { ok: false, error: "Your data was removed but the sign in account could not be deleted. Please try again." };
  }

  log.info("settings/deleteAccount completed", { userId });
  return { ok: true };
}
