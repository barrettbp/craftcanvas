import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/canvases");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex max-w-xl flex-col items-center gap-6 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">CraftCanvas</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">A thinking board for your Craft notes.</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Pull your Craft documents onto an infinite canvas, connect them with arrows, add text and groups, and keep
          Craft as the source of truth.
        </p>
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex h-12 items-center justify-center rounded-full bg-zinc-900 px-6 text-base font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Continue with Google
          </button>
        </SignInButton>
        <p className="text-xs text-zinc-500">
          By continuing you agree to how we handle your data. Read the{" "}
          <Link href="/privacy" className="underline">
            privacy page
          </Link>
          .
        </p>
      </div>
      <footer className="mt-16 flex items-center gap-4 text-xs text-zinc-500">
        <span>CraftCanvas</span>
        <Link href="/privacy" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
          Privacy
        </Link>
      </footer>
    </main>
  );
}
