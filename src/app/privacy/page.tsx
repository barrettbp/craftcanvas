import Link from "next/link";

export const metadata = { title: "Privacy" };

/**
 * Plain statement of what CraftCanvas stores, for how long, what it never
 * stores and how to wipe it (spec section 11). Public route, no Clerk
 * components so it renders signed out and in tests.
 */

type Row = { what: string; why: string; howLong: string };

const STORED: Row[] = [
  {
    what: "Your Clerk user id and the email address of your Google account",
    why: "To know which canvases and which Craft connection are yours.",
    howLong: "Until you delete your account.",
  },
  {
    what: "Your Craft connection URL and your Craft API key, encrypted",
    why: "Our server calls Craft on your behalf. The key is encrypted with AES-256-GCM using a server side secret before it is written, is decrypted only inside the request that needs it, and is never sent to your browser or written to a log.",
    howLong: "Until you disconnect Craft or delete your account.",
  },
  {
    what: "An index of the documents the connection can see: title, folder path, last edited time, and a preview of about the first 600 characters",
    why: "So the notes panel, search and note cards are instant and keep working while Craft is slow or unreachable.",
    howLong: "Refreshed in the background; removed when you disconnect Craft or delete your account.",
  },
  {
    what: "Your canvases: the cards, arrows, groups, colours, text you typed, the viewport, and a small thumbnail image",
    why: "That is the product. Note cards store only the document id, title, folder path and the short preview above.",
    howLong: "Until you delete the canvas or your account.",
  },
];

const NEVER: string[] = [
  "Full note bodies. We fetch a document's markdown to build the short preview, then drop it.",
  "Passwords. Sign in is Google through Clerk; there is no CraftCanvas password.",
  "OAuth tokens. Clerk keeps the Google session; our database never sees a Google token.",
  "Craft API keys in plain text, in logs, or in any response to the browser. Every log line is scrubbed of anything that looks like a key.",
  "Analytics or advertising identifiers. There is no third party tracking on these pages.",
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-zinc-500">
          <Link href="/" className="hover:underline">
            CraftCanvas
          </Link>{" "}
          / Privacy
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          CraftCanvas is a thinking board for your Craft notes. Craft stays the source of truth: we keep the least we can to draw
          your canvases, and you can wipe all of it from Settings at any time. This page lists exactly what is stored and for how
          long.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What we store</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Data</th>
                <th className="py-2 pr-4 font-medium">Why</th>
                <th className="py-2 font-medium">How long</th>
              </tr>
            </thead>
            <tbody>
              {STORED.map((row) => (
                <tr key={row.what} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-3 pr-4 font-medium text-zinc-800 dark:text-zinc-100">{row.what}</td>
                  <td className="py-3 pr-4 text-zinc-600 dark:text-zinc-400">{row.why}</td>
                  <td className="py-3 text-zinc-600 dark:text-zinc-400">{row.howLong}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Everything above lives in a Postgres database hosted by Supabase, and the app runs on Vercel. Sign in is handled by Clerk,
          which stores your name, email and Google account link under its own privacy policy. Thumbnails are stored in Supabase
          Storage when it is configured, otherwise inside the database row.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What we never store</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          {NEVER.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How Craft is accessed</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You create an API connection inside Craft and choose which documents it can see. CraftCanvas can only read what that
          connection exposes, and never writes to Craft. All Craft requests are made from our server, never from your browser, and
          they are rate limited per user so a hijacked session cannot hammer your key. Revoking the connection in Craft cuts us off
          immediately; the index and canvases keep their last previews until you reconnect or remove them.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How to wipe it</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="font-medium text-zinc-800 dark:text-zinc-100">Disconnect Craft</strong> from{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            . This deletes the encrypted key and the whole document index right away. Your canvases stay, with the previews they
            already have.
          </li>
          <li>
            <strong className="font-medium text-zinc-800 dark:text-zinc-100">Delete a canvas</strong> from the canvases page. It is
            removed immediately; there is no recycle bin.
          </li>
          <li>
            <strong className="font-medium text-zinc-800 dark:text-zinc-100">Delete your account</strong> from{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            . This removes every canvas, the index, the encrypted key, your user row and your Clerk sign in, in that order, and
            signs you out. It cannot be undone and nothing in Craft is touched.
          </li>
        </ul>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Database backups kept by our hosting providers roll off on their own schedule, typically within seven days.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Logging</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Server logs record request paths, status codes and timings so we can keep the service healthy. They do not contain note
          text, previews or keys. Every log line passes through a filter that replaces anything shaped like a Craft API key before
          it is written.
        </p>
      </section>

      <footer className="border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
        Questions about your data? The source of this page is in the repository under <code>src/app/privacy</code>; the data model
        it describes is in <code>docs/FEATURE_SPEC.md</code>, section 9.
      </footer>
    </main>
  );
}
