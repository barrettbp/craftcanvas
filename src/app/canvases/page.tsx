import { TopBar } from "@/components/app-shell/TopBar";

export const metadata = { title: "Canvases" };

// Placeholder. WP1 replaces this with the canvas list (grid, new, rename, duplicate, delete).
export default function CanvasesPage() {
  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col gap-2 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Canvases</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Your canvases will appear here once the canvas list is built.</p>
      </main>
    </>
  );
}
