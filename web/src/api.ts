export type User = { id: number; email: string; is_owner: boolean };
export type SetupState = "needed" | "unavailable" | "done";
export type Session = { user: User | null; csrf: string | null; setup: SetupState };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let csrf: string | null = null;

export function setCsrf(token: string | null) {
  csrf = token;
}

export async function api<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}
