import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { loadLocalEnv } from "../env.js";
import { loadConfig } from "../config.js";
import { SelectorsSchema } from "../tennislink/selectors.js";
import { findMatch } from "../tennislink/find-match.js";
import { readMatch } from "../tennislink/read-match.js";
import { MatchIdSchema } from "../domain/schemas.js";
import { z } from "zod";
loadLocalEnv();
const id = MatchIdSchema.parse(process.argv[2]),
  config = loadConfig();
const selectors = SelectorsSchema.parse(
  JSON.parse(await readFile(config.TENNISLINK_SELECTORS, "utf8")),
);
const rules = z
  .record(z.string(), z.string().min(1))
  .parse(
    JSON.parse(
      await readFile(process.argv[3] ?? "config/line-rules.local.json", "utf8"),
    ),
  );
await mkdir(config.TENNISLINK_PROFILE_DIR, { recursive: true, mode: 0o700 });
const browser = await chromium.launchPersistentContext(
  config.TENNISLINK_PROFILE_DIR,
  { headless: false },
);
try {
  const page = await browser.newPage();
  await page.goto(config.TENNISLINK_ENTRY_URL);
  const input = createInterface({ input: stdin, output: stdout });
  try {
    await input.question(
      "Complete login/MFA/CAPTCHA yourself, then open score entry. Press Enter when ready. ",
    );
  } finally {
    input.close();
  }
  await findMatch(page, id, selectors);
  const context = await readMatch(page, id, selectors, rules);
  await mkdir("var/context", { recursive: true, mode: 0o700 });
  const path = `var/context/${id}-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(context, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(`Official context saved to ${path}`);
} finally {
  await browser.close();
}
