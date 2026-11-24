import {
  ADMIN_APPLICATIONS_ENDPOINT,
  ADMIN_PAGE_SIZE,
  ADMIN_REQUEST_HEADER,
  ADMIN_SEARCH_ENDPOINT,
  APPLICATION_STATUSES,
  APPROVAL_MAIL_STATUSES,
  approvalMailEndpoint,
  installLinkEndpoint,
  type AdminApplication,
  type ApprovalMailIntent,
  type ApprovalMailRequest,
  type AdminErrorCode,
  type AdminFieldErrors,
  type ApplicationPatch,
  type InstallLink,
  type SearchRequest,
  type StatusFilter,
} from "@/lib/admin/contracts";

const ADMIN_REQUEST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  [ADMIN_REQUEST_HEADER]: "1",
};

export interface ClientFailure {
  ok: false;
  /** A contract code, or NETWORK / UNREADABLE when no usable response arrived. */
  code: AdminErrorCode | "NETWORK" | "UNREADABLE";
  fieldErrors?: AdminFieldErrors;
}

export type SearchOutcome =
  | { ok: true; items: AdminApplication[]; nextCursor: string | null }
  | ClientFailure;

export type UpdateOutcome = { ok: true; item: AdminApplication } | ClientFailure;

/** `item`: the request as stored after the change, when the server could read it. */
export type IssueLinkOutcome = { ok: true; link: InstallLink; item?: AdminApplication } | ClientFailure;

export type RevokeLinkOutcome = { ok: true; revoked: number; item?: AdminApplication } | ClientFailure;

export type ApprovalMailOutcome = { ok: true; item: AdminApplication } | ClientFailure;

interface SearchParams {
  q: string;
  status: StatusFilter;
  cursor?: string | null;
  signal?: AbortSignal;
}

function isApplication(value: unknown): value is AdminApplication {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.email === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.operatorNote === "string" &&
    (item.lastContactedAt === null || typeof item.lastContactedAt === "string") &&
    typeof item.updatedAt === "string" &&
    typeof item.updatesApproved === "boolean" &&
    typeof item.macRegistered === "boolean" &&
    (item.latestCodeMail === null || isRecord(item.latestCodeMail)) &&
    (item.approvalMail === null || isApprovalMail(item.approvalMail)) &&
    APPLICATION_STATUSES.includes(item.status as AdminApplication["status"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isApprovalMail(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    APPROVAL_MAIL_STATUSES.includes(value.status as (typeof APPROVAL_MAIL_STATUSES)[number])
  );
}

/** The parsed body, or a ClientFailure when the request failed or the body isn't usable. */
async function send(
  url: string,
  init: RequestInit
): Promise<{ status: number; body: Record<string, unknown> } | ClientFailure> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: ADMIN_REQUEST_HEADERS,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, code: "NETWORK" };
  }
  try {
    const body = await response.json();
    if (body && typeof body === "object") return { status: response.status, body };
  } catch {
    // Fall through: HTML error pages and empty bodies are not contract responses.
  }
  return { ok: false, code: "UNREADABLE" };
}

function failure(body: Record<string, unknown>): ClientFailure {
  if (body.ok === false && typeof body.code === "string") {
    const fieldErrors =
      body.fieldErrors && typeof body.fieldErrors === "object"
        ? (body.fieldErrors as AdminFieldErrors)
        : undefined;
    return { ok: false, code: body.code as AdminErrorCode, fieldErrors };
  }
  return { ok: false, code: "UNREADABLE" };
}

export async function searchApplications({
  q,
  status,
  cursor = null,
  signal,
}: SearchParams): Promise<SearchOutcome> {
  // The search terms travel only in this POST body, never in a URL.
  const request: SearchRequest = { q, status, cursor, limit: ADMIN_PAGE_SIZE };
  const result = await send(ADMIN_SEARCH_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
  if ("ok" in result) return result;

  const { status: httpStatus, body } = result;
  if (
    httpStatus === 200 &&
    body.ok === true &&
    Array.isArray(body.items) &&
    body.items.every(isApplication)
  ) {
    const nextCursor = typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null;
    return { ok: true, items: body.items, nextCursor };
  }
  return failure(body);
}

export async function updateApplication(
  id: AdminApplication["id"],
  patch: ApplicationPatch
): Promise<UpdateOutcome> {
  const result = await send(`${ADMIN_APPLICATIONS_ENDPOINT}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if ("ok" in result) return result;

  const { status: httpStatus, body } = result;
  if (httpStatus === 200 && body.ok === true && isApplication(body.item)) {
    return { ok: true, item: body.item };
  }
  return failure(body);
}

function isInstallLink(value: unknown): value is InstallLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.url === "string" &&
    /^https?:\/\//.test(link.url) &&
    typeof link.expiresAt === "string" &&
    Number.isInteger(link.build) &&
    typeof link.version === "string"
  );
}

/** A new private install link for an allowed request; the URL is in this answer only. */
export async function issueInstallLink(id: AdminApplication["id"]): Promise<IssueLinkOutcome> {
  const result = await send(installLinkEndpoint(id), { method: "POST", body: "{}" });
  if ("ok" in result) return result;

  const { status: httpStatus, body } = result;
  if (httpStatus === 201 && body.ok === true && isInstallLink(body.link)) {
    return { ok: true, link: body.link, ...(isApplication(body.item) ? { item: body.item } : {}) };
  }
  return failure(body);
}

export async function revokeInstallLink(id: AdminApplication["id"]): Promise<RevokeLinkOutcome> {
  const result = await send(installLinkEndpoint(id), { method: "DELETE" });
  if ("ok" in result) return result;

  const { status: httpStatus, body } = result;
  if (httpStatus === 200 && body.ok === true && Number.isInteger(body.revoked)) {
    return { ok: true, revoked: body.revoked as number, ...(isApplication(body.item) ? { item: body.item } : {}) };
  }
  return failure(body);
}

/**
 * Sends the approval mail the card shows (`intent` "send"), or a new one after it ("resend"). The server
 * refuses (409 CONFLICT) when the card is out of date, so a repeated press sends nothing more.
 */
export async function requestApprovalMail(
  id: AdminApplication["id"],
  expectedMailId: string | null,
  intent: ApprovalMailIntent
): Promise<ApprovalMailOutcome> {
  const request: ApprovalMailRequest = { expectedMailId, intent };
  const result = await send(approvalMailEndpoint(id), { method: "POST", body: JSON.stringify(request) });
  if ("ok" in result) return result;

  const { status: httpStatus, body } = result;
  if (httpStatus === 200 && body.ok === true && isApplication(body.item)) {
    return { ok: true, item: body.item };
  }
  return failure(body);
}
