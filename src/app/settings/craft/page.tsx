import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TopBar } from "@/components/app-shell/TopBar";
import { CraftConnectForm } from "@/components/settings/CraftConnectForm";
import { findConnectionForUser } from "@/lib/craft/connection";

export const metadata = { title: "Connect Craft" };
export const dynamic = "force-dynamic";

const STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Open Connections in Craft",
    body: (
      <>
        In the Craft desktop or web app open your space settings and choose <strong>Connections</strong>, then{" "}
        <strong>New API Connection</strong>.
      </>
    ),
  },
  {
    title: "Choose what the connection can see",
    body: (
      <>
        Pick <strong>All documents</strong> for the best experience. CraftCanvas can only list, search and preview the documents you
        include here; a connection limited to selected documents will show only those.
      </>
    ),
  },
  {
    title: "Switch the connection to API Key mode",
    body: <>Select the API Key option. Craft shows a connection URL and a key that starts with &ldquo;pdk_&rdquo;.</>,
  },
  {
    title: "Paste both values below",
    body: (
      <>
        The URL looks like <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">https://connect.craft.do/links/…/api/v1</code>.
        The key is encrypted on our server before it is stored and never sent to your browser again.
      </>
    ),
  },
];

export default async function SettingsCraftPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  let existing: { label: string | null; host: string | null; status: string } | null = null;
  try {
    const connection = await findConnectionForUser(userId);
    if (connection) existing = { label: connection.label, host: connection.host, status: connection.status };
  } catch (err) {
    console.error("[settings/craft] could not load connection", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-10">
        <header>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>{" "}
            / Connect Craft
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Connect Craft</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Create an API connection inside Craft, then paste its URL and key here. Takes about a minute.
          </p>
        </header>

        {existing ? (
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {existing.status === "unauthorized"
              ? "Your current connection was rejected by Craft. Saving new details below replaces it."
              : `You already have a connection (${existing.label ?? "Craft space"}${existing.host ? `, ${existing.host}` : ""}). Saving new details replaces it.`}
          </p>
        ) : null}

        <section className="grid gap-8 md:grid-cols-[1fr_280px]">
          <ol className="flex flex-col gap-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {i + 1}
                </span>
                <div>
                  <h2 className="font-medium">{step.title}</h2>
                  <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          {/* Screenshot placeholder: swap for real images of the Craft Connections screen. */}
          <div
            aria-hidden="true"
            className="hidden min-h-48 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-center text-xs text-zinc-400 md:flex dark:border-zinc-700"
          >
            Screenshot of Craft&rsquo;s
            <br />
            Connections screen
          </div>
        </section>

        <CraftConnectForm />
      </main>
    </>
  );
}
