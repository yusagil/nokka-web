import "server-only";
import type { DigestMail } from "./mailer";

export type ApprovalMailContent = {
  /** As the person entered it in the request. */
  name: string;
  /** The private install link (`/install#<token>`): only ever in this mail, never stored or logged. */
  url: string;
  /** UTC ISO string; shown in Seoul time. */
  expiresAt: string;
  /** The Nokka version the link installs. */
  version: string;
};

const kst = (locale: string) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const formatKo = kst("ko-KR");
const formatEn = kst("en-US");

/**
 * The mail sent once the operator allows a request's updates: how to install with the private link (its button
 * downloads once) and how to register the Mac with a code from the app. Korean first, English below it, like
 * the registration code mail. The code itself is never in here: the app asks for it.
 */
export function composeApprovalMail({ name, url, expiresAt, version }: ApprovalMailContent): DigestMail {
  const until = new Date(expiresAt);
  return {
    subject: "Nokka 사용 승인 안내 (Your Nokka access is approved)",
    text: [
      `${name}님, 안녕하세요.`,
      "",
      "Nokka 사용 신청이 승인되었습니다. 아래 순서대로 설치하고, 업데이트를 받을 Mac을 등록해 주세요.",
      "",
      "1. 설치할 Mac에서 아래 링크를 엽니다.",
      url,
      `2. 열린 페이지에서 ‘설치 파일 받기’를 누르면 Nokka ${version} 설치 파일을 바로 받기 시작합니다. 이 버튼은 한 번만 쓸 수 있습니다. 링크는 ${formatKo.format(until)}(한국 시간)까지 쓸 수 있으며, 기한이 지났거나 받는 중에 끊겼다면 이 메일에 회신해 새 링크를 요청해 주세요.`,
      "3. 받은 DMG를 열고 Nokka를 응용 프로그램 폴더로 옮긴 뒤 엽니다.",
      "4. Nokka 메뉴에서 ‘업데이트 확인…’을 선택합니다. 등록 화면이 열리면 이 메일을 받은 주소를 입력하고 ‘코드 받기’를 누른 뒤, 메일로 받은 8자리 코드를 입력하고 ‘등록’을 누릅니다.",
      "",
      "이미 Nokka를 쓰고 있다면 링크를 열지 말고 4번부터 진행하세요. ‘업데이트 확인…’에서 등록 화면 대신 안내만 보이면 1번부터 진행해 새 버전을 설치하세요.",
      "",
      "링크는 받은 분만 쓸 수 있습니다. 다른 사람과 공유하지 마세요.",
      "",
      "Nokka 드림",
      "",
      "---",
      "",
      `Hello ${name},`,
      "",
      "Your request to use Nokka has been approved. Install it and register the Mac that should receive updates:",
      "",
      "1. On the Mac you want to install it on, open the link above.",
      `2. On that page, press ‘설치 파일 받기’ (Download): the Nokka ${version} installer starts downloading at once. The button works only once. The link works until ${formatEn.format(until)} KST. If it has expired or the download stopped, reply to this email for a new link.`,
      "3. Open the DMG, move Nokka to Applications and open it.",
      "4. In the Nokka menu, choose ‘업데이트 확인…’ (Check for Updates…). If the registration screen opens, enter the address this email was sent to, press ‘코드 받기’ (Get code), then enter the 8-digit code from the mail and press ‘등록’ (Register).",
      "",
      "If you already use Nokka, don't open the link: start at step 4. If ‘업데이트 확인…’ shows only a notice instead of the registration screen, start at step 1 to install the new version.",
      "",
      "The link is for you only. Please don't share it.",
    ].join("\n"),
  };
}
