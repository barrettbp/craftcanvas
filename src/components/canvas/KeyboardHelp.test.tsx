import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KeyboardHelp, closeKeyboardHelp, openKeyboardHelp, toggleKeyboardHelp, useKeyboardHelpStore } from "./KeyboardHelp";
import { allShortcuts } from "./shortcuts-table";

describe("<KeyboardHelp>", () => {
  afterEach(() => closeKeyboardHelp());

  it("is closed until opened, then lists every shortcut label", () => {
    const { container } = render(<KeyboardHelp />);
    const dialog = container.querySelector("dialog[data-keyboard-help]") as HTMLDialogElement;
    expect(dialog).not.toHaveAttribute("open");

    act(() => openKeyboardHelp());
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("heading", { level: 2, name: "Keyboard shortcuts" })).toBeInTheDocument();
    // Some labels double as key caps ("Delete"), so count matches instead of requiring one.
    for (const row of allShortcuts()) expect(screen.getAllByText(row.label).length, row.label).toBeGreaterThanOrEqual(1);
  });

  it("toggles, closes from the button and swallows key events so canvas shortcuts stay quiet", () => {
    const { container } = render(<KeyboardHelp />);
    const dialog = container.querySelector("dialog[data-keyboard-help]") as HTMLDialogElement;

    act(() => toggleKeyboardHelp());
    expect(useKeyboardHelpStore.getState().open).toBe(true);

    let reachedWindow = 0;
    const spy = () => {
      reachedWindow += 1;
    };
    window.addEventListener("keydown", spy);
    fireEvent.keyDown(dialog, { key: "z", metaKey: true });
    window.removeEventListener("keydown", spy);
    expect(reachedWindow).toBe(0);

    fireEvent.keyDown(dialog, { key: "?" });
    expect(useKeyboardHelpStore.getState().open).toBe(false);

    act(() => openKeyboardHelp());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useKeyboardHelpStore.getState().open).toBe(false);
  });
});
