import { z } from "zod";
import { AcademyFilterSchema } from "./tennislink/academy.js";
const Env = z.object({
  ACADEMY_NAME: z.string().trim().min(1).default("Momentum Tennis"),
  ACADEMY_ALIASES: z.string().default(""),
  ACADEMY_TEAM_IDS: z.string().default(""),
  TENNISLINK_SCORES_URL: z.union([z.url(), z.literal("")]).default(""),
  TENNISLINK_SCORE_SELECTORS: z
    .string()
    .default("config/score-selectors.local.json"),
  TENNISLINK_LOGIN_SELECTORS: z.string().default(""),
  TENNISLINK_MAX_SCORE_PAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  TENNISLINK_ENTRY_URL: z
    .url()
    .default(
      "https://tennislink.usta.com/TeamTennis/Secure/EnterMatchNumber.aspx",
    ),
  TENNISLINK_SELECTORS: z.string().default("config/selectors.local.json"),
  TENNISLINK_PROFILE_DIR: z.string().default("var/browser-profile"),
  DATABASE_PATH: z.string().default("var/momentum.sqlite"),
  ENABLE_FINAL_SUBMISSION: z.enum(["true", "false"]).default("false"),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = Env.parse(env);
  const url = new URL(c.TENNISLINK_ENTRY_URL);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "tennislink.usta.com" ||
    url.username ||
    url.password
  )
    throw new Error("Untrusted TennisLink URL");
  const csv = (value: string) =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  return {
    ...c,
    finalSubmissionEnabled: c.ENABLE_FINAL_SUBMISSION === "true",
    academy: AcademyFilterSchema.parse({
      name: c.ACADEMY_NAME,
      aliases: csv(c.ACADEMY_ALIASES),
      team_ids: csv(c.ACADEMY_TEAM_IDS),
    }),
  };
}
