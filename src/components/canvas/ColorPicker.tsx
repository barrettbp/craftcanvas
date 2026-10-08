"use client";

import { Ban, Check } from "lucide-react";

import { PRESET_COLORS } from "@/lib/canvas/colors";

type ColorPickerProps = {
  value?: string;
  onPick: (color: string | undefined) => void;
  className?: string;
};

/** Six preset swatches (JSON Canvas ids "1" to "6") plus "no colour". */
export function ColorPicker({ value, onPick, className }: ColorPickerProps) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`} role="group" aria-label="Colour">
      <button
        type="button"
        title="No colour"
        aria-label="No colour"
        onClick={() => onPick(undefined)}
        className={`flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800 ${
          !value ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900" : ""
        }`}
      >
        <Ban className="h-3.5 w-3.5" aria-hidden />
      </button>
      {PRESET_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.name}
          aria-label={c.name}
          onClick={() => onPick(c.id)}
          style={{ background: c.hex }}
          className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${
            value === c.id ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900" : ""
          }`}
        >
          {value === c.id ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
        </button>
      ))}
    </div>
  );
}
