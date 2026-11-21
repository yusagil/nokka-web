import {
  ADMIN_APPLICATIONS_ENDPOINT,
  ADMIN_PAGE_SIZE,
  ADMIN_REQUEST_HEADER,
  ADMIN_SEARCH_ENDPOINT,
  APPLICATION_STATUSES,
  type AdminApplication,
  type AdminErrorCode,
  type AdminFieldErrors,
  type ApplicationPatch,
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
    APPLICATION_STATUSES.includes(item.status as AdminApplication["status"])
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
