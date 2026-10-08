"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { canvases, craftConnections, craftDocuments, getDb, users } from "@/db";

export type DeleteAccountResult = { ok: false; error: string };

/**
 * Deletes everything we hold for the signed in user (canvases, document index,
 * encrypted Craft key, users row), then deletes the Clerk user and redirects
 * to the landing page. The Clerk webhook `user.deleted` is a harmless no-op
 * afterwards because the users row is already gone.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  try {
    const db = getDb();
    await db.delete(canvases).where(eq(canvases.userId, userId));
    const connections = await db.select({ id: craftConnections.id }).from(craftConnections).where(eq(craftConnections.userId, userId));
    for (const c of connections) {
      await db.delete(craftDocuments).where(eq(craftDocuments.connectionId, c.id));
    }
    await db.delete(craftConnections).where(eq(craftConnections.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  } catch (err) {
    console.error("[settings/deleteAccount] database cleanup failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "Could not delete your data. Please try again." };
  }

  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch (err) {
    console.error("[settings/deleteAccount] Clerk deleteUser failed", err instanceof Error ? err.message : err);
    return { ok: false, error: "Your data was removed but the sign in account could not be deleted. Please try again." };
  }

  redirect("/");
}
