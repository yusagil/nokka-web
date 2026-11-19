"use client";

import { useState } from "react";
import { signInWithGitHub } from "@/lib/admin/auth-client";

export default function LoginButton({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    if (pending || disabled) return;
    setPending(true);
    setFailed(false);
    try {
      // Success leaves the page for GitHub, so pending stays on.
      await signInWithGitHub();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        aria-disabled={pending || undefined}
        className="inline-flex h-12 w-full items-center justify-center rounded-full bg-accent-strong px-7 text-base font-medium text-white shadow-sm transition-colors duration-150 hover:bg-accent-stronger disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-wait aria-disabled:opacity-70"
      >
        {pending ? "GitHub로 이동 중…" : "GitHub로 로그인"}
      </button>
      {failed && (
        <p role="alert" className="mt-4 text-sm text-accent-text">
          로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </>
  );
}
