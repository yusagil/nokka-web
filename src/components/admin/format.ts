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
  return mailto(email, copy.mailSubject, copy.mailBody(name));
}

/**
 * The draft from `composeMailto` in Gmail's web compose window. A mailto: link only works when the
 * browser or the system passes it to a mail app, and the page can't tell when nothing takes it; this
 * opens in a new tab of the same browser instead. It too only opens a draft.
 */
export function composeGmail(name: string, email: string): string {
  return gmail(email, copy.mailSubject, copy.mailBody(name));
}

/**
 * The install-link mail's body: the private link and its expiry (Seoul time). It is copied, never put
 * in a URL, so the link stays out of mailto: handlers, Gmail's request and the browser's history.
 */
export function installLinkMailBody(name: string, url: string, expiresAt: string): string {
  return copy.installLinkMailBody(name, url, formatDateTime(expiresAt));
}

/** A mail-app draft for the install-link mail: recipient and subject only; the copied body is pasted in. */
export function composeInstallLinkMailto(email: string): string {
  return mailto(email, copy.installLinkMailSubject);
}

/** The same draft as `composeInstallLinkMailto` in Gmail's web compose window. */
export function composeInstallLinkGmail(email: string): string {
  return gmail(email, copy.installLinkMailSubject);
}

function mailto(email: string, subject: string, body?: string): string {
  // Keep "@" readable for mail apps but encode anything that would break the URL (?, &, #, %).
  const to = encodeURIComponent(email).replace(/%40/g, "@");
  const draft = `mailto:${to}?subject=${encodeURIComponent(subject)}`;
  return body === undefined ? draft : `${draft}&body=${encodeURIComponent(body)}`;
}

function gmail(email: string, subject: string, body?: string): string {
  // view=cm opens the compose window, fs=1 full size; Gmail fills To, Subject (su) and the body.
  // encodeURIComponent, not URLSearchParams: a space stays %20 rather than "+".
  const fields = [
    ["view", "cm"],
    ["fs", "1"],
    ["to", email],
    ["su", subject],
    ...(body === undefined ? [] : [["body", body]]),
  ];
  return `https://mail.google.com/mail/?${fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}
