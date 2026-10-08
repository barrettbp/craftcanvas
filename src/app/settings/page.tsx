import { TopBar } from "@/components/app-shell/TopBar";

export const metadata = { title: "Settings" };

// Placeholder. WP2 replaces this with connection status, Disconnect and Delete account.
export default function SettingsPage() {
  return (
    <>
      <TopBar />
      <main className="flex flex-1 flex-col gap-2 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your Craft connection and account options will be managed from this page.
        </p>
      </main>
    </>
  );
}
