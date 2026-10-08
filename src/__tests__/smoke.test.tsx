import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PrivacyPage from "@/app/privacy/page";
import { MissingEnvError, env, optionalEnv, requireEnv } from "@/lib/env";

describe("smoke", () => {
  it("renders the privacy placeholder page", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
  });
});

describe("env", () => {
  const original = process.env.CRAFT_KEY_ENCRYPTION_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.CRAFT_KEY_ENCRYPTION_SECRET;
    else process.env.CRAFT_KEY_ENCRYPTION_SECRET = original;
  });

  it("reads lazily and throws a clear error when a variable is missing", () => {
    delete process.env.CRAFT_KEY_ENCRYPTION_SECRET;
    expect(optionalEnv("CRAFT_KEY_ENCRYPTION_SECRET")).toBeUndefined();
    expect(() => requireEnv("CRAFT_KEY_ENCRYPTION_SECRET")).toThrow(MissingEnvError);
    expect(() => env.craftKeyEncryptionSecret()).toThrow(/CRAFT_KEY_ENCRYPTION_SECRET/);
  });

  it("returns the value once it is set", () => {
    process.env.CRAFT_KEY_ENCRYPTION_SECRET = "test-secret";
    expect(env.craftKeyEncryptionSecret()).toBe("test-secret");
    expect(env.supabaseThumbnailBucket()).toBe("thumbnails");
  });
});
