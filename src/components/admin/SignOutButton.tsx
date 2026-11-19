"use client";

import { useRef, useState } from "react";
import { signOutAdmin } from "@/lib/admin/auth-client";
import { copy } from "./copy";

export default function SignOutButton() {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const pending = useRef(false);

  async function signOut() {
    if (pending.current) return;
    pending.current = true;
    setState("pending");
    try {
      // On success this navigates to the login page, so there is nothing more to do here.
      await signOutAdmin();
    } catch {
      setState("failed");
    } finally {
      pending.current = false;
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={signOut}
        aria-disabled={state === "pending"}
        className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-fg transition-colors duration-100 hover:bg-surface-2 aria-disabled:cursor-wait aria-disabled:opacity-70"
      >
        {state === "pending" ? copy.signingOut : copy.signOut}
      </button>
      {state === "failed" && (
        <p role="alert" className="text-sm text-accent-text">
          {copy.signOutFailed}
        </p>
      )}
    </div>
  );
}
