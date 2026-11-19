"use client";

export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data: T & { error?: string; field?: string };
};

/** Small fetch wrapper: JSON in, JSON out, same-origin cookies. Never throws on HTTP errors. */
export async function call<T = Record<string, unknown>>(
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: "Can’t reach the server. Check your connection." } as ApiResult<T>["data"],
    }; // translated by callers via t()
  }
}

export const safeNext = (n: string | null | undefined) => (n && /^\/(?!\/)[\w\-/]*$/.test(n) ? n : "/");
