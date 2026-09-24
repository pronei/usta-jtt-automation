import type { Page } from "playwright";
import { z } from "zod";
import { readCredentials } from "../env.js";
export const LoginSelectorsSchema = z
  .strictObject({
    origin: z.url(),
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .refine((s) => {
    const u = new URL(s.origin);
    return (
      u.protocol === "https:" &&
      (u.hostname === "usta.com" || u.hostname.endsWith(".usta.com")) &&
      u.origin === s.origin &&
      !u.username &&
      !u.password
    );
  }, "Configure the exact verified HTTPS USTA login origin");
export async function fillLoginCredentials(
  page: Page,
  raw: unknown,
): Promise<void> {
  const selectors = LoginSelectorsSchema.parse(raw);
  const credentials = readCredentials();
  if (!credentials) return;
  const assertOrigin = () => {
    if (new URL(page.url()).origin !== selectors.origin)
      throw new Error("Login origin does not match verified configuration");
  };
  assertOrigin();
  // Do not allow Playwright errors to expose filled values in logs.
  try {
    await page.locator(selectors.username).fill(credentials.username);
    assertOrigin();
    await page.locator(selectors.password).fill(credentials.password);
  } catch {
    throw new Error(
      "Credential autofill failed; finish login manually in the browser.",
    );
  }
  // Human clicks Sign In and completes MFA/CAPTCHA; no challenge bypass or login retry loop.
}
