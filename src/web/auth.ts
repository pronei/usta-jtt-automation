import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const ReviewersSchema = z
  .array(z.strictObject({ name: z.string().trim().min(1), token: z.string().min(16) }))
  .min(1)
  .refine(
    (r) =>
      new Set(r.map((x) => x.name)).size === r.length &&
      new Set(r.map((x) => x.token)).size === r.length,
    "Duplicate reviewer names or tokens",
  );
export type Reviewers = z.infer<typeof ReviewersSchema>;
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function reviewerForToken(reviewers: Reviewers, token: string): string | null {
  for (const r of reviewers) if (same(r.token, token)) return r.name;
  return null;
}
const sign = (secret: string, name: string) =>
  createHmac("sha256", secret).update(name).digest("base64url");
export function signSession(secret: string, name: string): string {
  return Buffer.from(name).toString("base64url") + "." + sign(secret, name);
}
export function verifySession(secret: string, cookie: string | undefined): string | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return null;
  const name = Buffer.from(cookie.slice(0, dot), "base64url").toString();
  return name && same(sign(secret, name), cookie.slice(dot + 1)) ? name : null;
}
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}
