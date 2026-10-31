import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.ts";

/** Server-to-server calls between the store and Courier, authenticated with a shared secret. */
export async function internalFetch<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", "X-Internal-Secret": config.internalSecret },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error((json as any).error ?? `Internal call failed: ${res.status} ${url}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return json;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function requireInternal(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header("x-internal-secret") ?? "";
  if (!safeEqual(provided, config.internalSecret)) {
    res.status(401).json({ error: "internal auth required" });
    return;
  }
  next();
}
