import { TopBar } from "@/components/app-shell/TopBar";

export const metadata = { title: "Connect Craft" };

// Placeholder. WP2 replaces this with the step by step Craft connect flow.
export default function SettingsCraftPage() {
  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col gap-2 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Connect Craft</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Paste your Craft API connection URL and key here to start pulling in notes.
        </p>
      </main>
    </>
  );
}
