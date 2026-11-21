import "server-only";
import type { DigestMail } from "@/lib/notifications/mailer";
import { CODE_TTL_SECONDS } from "./contracts";

const MINUTES = CODE_TTL_SECONDS / 60;

/** The code is the only variable part: no name, address, installation or link goes into the mail. */
export function composeCodeMail(code: string): DigestMail {
  return {
    subject: "Nokka 등록 코드 (Registration code)",
    text: [
      "Nokka 앱에 아래 코드를 입력하면 코드를 요청한 이 Mac이 업데이트를 받도록 등록됩니다.",
      `코드는 ${MINUTES}분 동안 한 번만 쓸 수 있습니다. 다른 Mac이 등록되어 있었다면 그 Mac은 더 이상 업데이트를 받지 않습니다.`,
      "",
      code,
      "",
      "요청하지 않았다면 이 메일을 무시하세요. 코드를 다른 사람에게 알려 주지 마세요.",
      "",
      "Enter this code in the Nokka app to register the Mac that requested it for updates.",
      `It works once within ${MINUTES} minutes. A Mac registered before stops receiving updates.`,
      "If you didn't ask for it, ignore this email and don't share the code.",
    ].join("\n"),
  };
}
