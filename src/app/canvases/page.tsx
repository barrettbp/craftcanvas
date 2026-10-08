import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { TopBar } from "@/components/app-shell/TopBar";
import { CanvasList } from "@/components/canvas-list/CanvasList";
import { toSummary } from "@/lib/canvas/api";
import { listCanvasesForUser, userHasCraftConnection } from "@/lib/canvas/repo";

export const metadata = { title: "Canvases" };
export const dynamic = "force-dynamic";

/** Canvas list (spec 8.7): the user's canvases, newest first. */
export default async function CanvasesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [rows, hasCraftConnection] = await Promise.all([listCanvasesForUser(userId), userHasCraftConnection(userId)]);

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
        <CanvasList initial={rows.map(toSummary)} hasCraftConnection={hasCraftConnection} />
      </main>
    </>
  );
}
