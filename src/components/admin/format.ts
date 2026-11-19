import { copy } from "./copy";

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Seoul time, e.g. "2026. 11. 19. 21:30". Unparseable input is shown as is. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

/**
 * A mailto: link that opens the operator's mail app with the recipient, subject and a short draft.
 * Opening it sends nothing and changes nothing; the operator sends the mail and records it.
 */
export function composeMailto(name: string, email: string): string {
  // Keep "@" readable for mail apps but encode anything that would break the URL (?, &, #, %).
  const to = encodeURIComponent(email).replace(/%40/g, "@");
  const subject = encodeURIComponent(copy.mailSubject);
  const body = encodeURIComponent(copy.mailBody(name));
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
