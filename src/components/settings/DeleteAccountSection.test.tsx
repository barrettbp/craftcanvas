import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteAccount, signOut, push, refresh } = vi.hoisted(() => ({ deleteAccount: vi.fn(), signOut: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/settings/actions", () => ({ deleteAccount: () => deleteAccount() }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { DeleteAccountSection } from "./DeleteAccountSection";

function openAndType(word: string) {
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: word } });
}

describe("<DeleteAccountSection>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signOut.mockResolvedValue(undefined);
  });

  it("keeps the confirm button disabled until DELETE is typed exactly", () => {
    render(<DeleteAccountSection />);
    openAndType("delete");
    const confirm = screen.getByRole("button", { name: "Delete everything" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Type DELETE exactly.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("shows the action's error and lets the user retry", async () => {
    deleteAccount.mockResolvedValueOnce({ ok: false, error: "Could not delete your data." });
    render(<DeleteAccountSection />);
    openAndType("DELETE");
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Could not delete your data."));
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete everything" })).toBeEnabled();
  });

  it("signs out to the landing page after a successful deletion", async () => {
    deleteAccount.mockResolvedValueOnce({ ok: true });
    render(<DeleteAccountSection />);
    openAndType("DELETE");
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: /Account deleted/ })).toBeDisabled());
  });

  it("falls back to a router navigation when Clerk cannot sign out", async () => {
    deleteAccount.mockResolvedValueOnce({ ok: true });
    signOut.mockRejectedValueOnce(new Error("session gone"));
    render(<DeleteAccountSection />);
    openAndType("DELETE");
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalled();
  });
});
