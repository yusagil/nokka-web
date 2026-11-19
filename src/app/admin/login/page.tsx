import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_INBOX_PATH } from "@/lib/admin/contracts";
import { getAdminSession } from "@/lib/admin/session";
import LoginButton from "./LoginButton";

export const metadata: Metadata = { title: "관리자 로그인 · Nokka" };

const MESSAGES = {
  forbidden: "이 GitHub 계정은 신청함에 들어올 수 없습니다.",
  unavailable: "지금은 관리자 로그인을 사용할 수 없습니다. 서버 설정이나 데이터베이스 연결을 확인해 주세요.",
  failed: "GitHub 로그인을 마치지 못했습니다. 허용된 관리자 계정으로 다시 시도해 주세요.",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await getAdminSession(await headers());
  if (session.ok) redirect(ADMIN_INBOX_PATH);

  // Only known reasons are shown; Better Auth's own error codes and descriptions are not echoed.
  const { error } = await searchParams;
  const unavailable = session.status === 503;
  const message = unavailable
    ? MESSAGES.unavailable
    : error === "forbidden" || session.status === 403
      ? MESSAGES.forbidden
      : error
        ? MESSAGES.failed
        : null;

  return (
    <main id="main-content" className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold text-fg">신청함 관리자 로그인</h1>
      <p className="mt-3 text-base text-fg-muted">
        허용된 GitHub 계정으로만 들어올 수 있습니다. 로그인하면 GitHub 공개 프로필과 이메일 읽기 권한을 요청합니다.
      </p>
      {message && (
        <p role="alert" className="mt-6 rounded-[10px] border border-line bg-surface px-4 py-3 text-sm text-accent-text">
          {message}
        </p>
      )}
      <div className="mt-8">
        <LoginButton disabled={unavailable} />
      </div>
    </main>
  );
}
