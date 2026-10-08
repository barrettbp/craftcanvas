import { TopBar } from "@/components/app-shell/TopBar";

export const metadata = { title: "Canvas" };

// Placeholder. WP1 replaces this with the React Flow canvas page.
export default async function CanvasPage({ params }: PageProps<"/canvas/[id]">) {
  const { id } = await params;
  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col gap-2 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Canvas</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The infinite canvas for <code className="font-mono text-sm">{id}</code> will render here.
        </p>
      </main>
    </>
  );
}
