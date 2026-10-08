export const metadata = { title: "Privacy" };

// Placeholder. WP5 replaces this with the full statement of what is stored and for how long.
export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col gap-2 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        CraftCanvas stores only note titles, short previews, your encrypted Craft key and your canvases, and you can
        wipe all of it from settings at any time.
      </p>
    </main>
  );
}
