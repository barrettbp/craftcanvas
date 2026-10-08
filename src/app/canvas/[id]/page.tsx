import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { CanvasEditor } from "@/components/canvas/CanvasEditor";
import { isCanvasId, toDetail } from "@/lib/canvas/api";
import { getCanvasForUser } from "@/lib/canvas/repo";

export const dynamic = "force-dynamic";

/** One query per request, shared between `generateMetadata` and the page. */
const loadCanvas = cache(getCanvasForUser);

export async function generateMetadata({ params }: PageProps<"/canvas/[id]">) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId || !isCanvasId(id)) return { title: "Canvas" };
  const row = await loadCanvas(userId, id);
  return { title: row?.title ?? "Canvas" };
}

/**
 * Loads the canvas server side, scoped by the Clerk user (404 when missing or
 * owned by someone else), and hydrates the client editor.
 */
export default async function CanvasPage({ params }: PageProps<"/canvas/[id]">) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!isCanvasId(id)) notFound();

  const row = await loadCanvas(userId, id);
  if (!row) notFound();

  return <CanvasEditor canvas={toDetail(row)} />;
}
