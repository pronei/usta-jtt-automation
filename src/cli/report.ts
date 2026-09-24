import { loadLocalEnv } from "../env.js";
import { loadConfig } from "../config.js";
import { Store } from "../storage/database.js";
import { renderReport, seasonReport } from "../measure/report.js";

loadLocalEnv();
const store = new Store(loadConfig().DATABASE_PATH);
try {
  process.stdout.write(renderReport(seasonReport(store), new Date()));
} finally {
  store.close();
}
