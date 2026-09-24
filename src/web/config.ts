import { z } from "zod";
const WebEnv = z.object({
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WEB_PUBLIC_URL: z.url(),
  WEB_SESSION_SECRET: z.string().min(32),
  WEB_REVIEWERS: z.string().default("config/reviewers.local.json"),
  FORMAT_RULES: z.string().default("config/format-rules.local.json"),
  SCORING_RULES: z.string().default("config/scoring-rules.local.json"),
  PYTHON_BIN: z.string().default(".venv/bin/python"),
  UPLOAD_DIR: z.string().default("var/uploads"),
  DATABASE_PATH: z.string().default("var/momentum.sqlite"),
});
export type WebConfig = z.infer<typeof WebEnv>;
export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const c = WebEnv.parse(env);
  const u = new URL(c.WEB_PUBLIC_URL);
  if (u.protocol !== "https:" && u.hostname !== "localhost")
    throw new Error("WEB_PUBLIC_URL must be https (the bookmarklet runs on an https page)");
  return c;
}
