import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@courier/shared";
import type { Request, Response } from "express";
import { db, type Human } from "../db.ts";

const SECURE = config.courier.url.startsWith("https://");

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sign(value: string): string {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

export function setSignedCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
  const signed = `${value}.${sign(`${name}:${value}`)}`;
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${SECURE ? "; Secure" : ""}`,
  );
}

export function readSignedCookie(req: Request, name: string): string | null {
  const raw = parseCookies(req)[name];
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return null;
  const value = raw.slice(0, idx);
  const expected = Buffer.from(sign(`${name}:${value}`));
  const actual = Buffer.from(raw.slice(idx + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return value;
}

export function clearCookie(res: Response, name: string): void {
  res.append("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? "; Secure" : ""}`);
}

export function currentHuman(req: Request): Human | null {
  const id = readSignedCookie(req, "courier_session");
  return id ? (db.get<Human>("humans", id) ?? null) : null;
}

export function startSession(res: Response, humanId: string): void {
  setSignedCookie(res, "courier_session", humanId, 60 * 60 * 24 * 7);
}

export function endSession(res: Response): void {
  clearCookie(res, "courier_session");
}
