import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "../config.js";
import { loadLocalEnv } from "../env.js";
import {
  ScoreListSelectorsSchema,
  readAcademyScores,
  trustedScoreUrl,
} from "../tennislink/read-scores.js";
import { fillLoginCredentials } from "../tennislink/login.js";
loadLocalEnv();
const config = loadConfig();
if (!config.TENNISLINK_SCORES_URL)
  throw new Error(
    "Set TENNISLINK_SCORES_URL to a verified team/schedule/results listing URL.",
  );
const url = trustedScoreUrl(config.TENNISLINK_SCORES_URL);
const selectors = ScoreListSelectorsSchema.parse(
  JSON.parse(await readFile(config.TENNISLINK_SCORE_SELECTORS, "utf8")),
);
await mkdir(config.TENNISLINK_PROFILE_DIR, { recursive: true, mode: 0o700 });
const browser = await chromium.launchPersistentContext(
  config.TENNISLINK_PROFILE_DIR,
  { headless: false },
);
const terminal = createInterface({ input: stdin, output: stdout });
try {
  const page = await browser.newPage();
  await page.goto(url);
  if (config.TENNISLINK_LOGIN_SELECTORS) {
    await terminal
      .question(
        "If login is needed, open the verified USTA login page. Press Enter to autofill credentials (or type skip). ",
      )
      .then(async (answer) => {
        if (answer.trim().toLowerCase() !== "skip")
          await fillLoginCredentials(
            page,
            JSON.parse(
              await readFile(config.TENNISLINK_LOGIN_SELECTORS, "utf8"),
            ),
          );
      });
  }
  await terminal.question(
    "Complete login/MFA/CAPTCHA if required. Press Enter when ready to read the configured score listing. ",
  );
  await page.goto(url);
  const snapshot = await readAcademyScores(
    page,
    selectors,
    config.academy,
    config.TENNISLINK_MAX_SCORE_PAGES,
  );
  await mkdir("var/scores", { recursive: true, mode: 0o700 });
  const file = `var/scores/${Date.now()}-${randomUUID()}.json`;
  await writeFile(file, JSON.stringify(snapshot, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    `Read ${snapshot.matches.length} relevant matches across ${snapshot.pages_read} pages. Saved ${file}${snapshot.truncated ? " (page limit reached)" : ""}`,
  );
} finally {
  terminal.close();
  await browser.close();
}
