import { readFile } from "node:fs/promises";
import { loadLocalEnv } from "../env.js";
import { Store } from "../storage/database.js";
import { RuleBookSchema } from "../tennis/scoring-rules.js";
import { ReviewersSchema } from "../web/auth.js";
import { loadWebConfig } from "../web/config.js";
import { FormatRulesSchema } from "../web/context.js";
import { createApp } from "../web/server.js";
import { pythonExtractor } from "../web/upload.js";

loadLocalEnv();
const config = loadWebConfig();
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const store = new Store(config.DATABASE_PATH);
const app = createApp({
  store,
  reviewers: ReviewersSchema.parse(await json(config.WEB_REVIEWERS)),
  sessionSecret: config.WEB_SESSION_SECRET,
  publicUrl: config.WEB_PUBLIC_URL,
  uploadDir: config.UPLOAD_DIR,
  extractor: pythonExtractor(config.PYTHON_BIN),
  scoringRules: RuleBookSchema.parse(await json(config.SCORING_RULES)),
  formatRules: FormatRulesSchema.parse(await json(config.FORMAT_RULES)),
  fillScript: await readFile("public/fill.js", "utf8"),
});
// Bind to loopback only; cloudflared (or another https front) forwards WEB_PUBLIC_URL here.
app.listen(config.WEB_PORT, "127.0.0.1", () =>
  console.log(`Score entry on http://127.0.0.1:${config.WEB_PORT}; public address ${config.WEB_PUBLIC_URL}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    app.close();
    store.close();
    process.exit(0);
  });
