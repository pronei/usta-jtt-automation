import { loadEnvFile } from "node:process";
/** Call only at CLI startup. Exported runtime secrets take precedence over .env. */
export function loadLocalEnv(path = ".env"): void {
  try {
    loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Could not load environment file; inspect it locally.");
  }
}
/** Keep secrets out of general configuration, snapshots and audit artifacts. */
export function readCredentials(env: NodeJS.ProcessEnv = process.env) {
  const username = env.USTA_USERNAME,
    password = env.USTA_PASSWORD;
  if (!username && !password) return null;
  if (!username?.trim() || !password)
    throw new Error(
      "Set both USTA_USERNAME and USTA_PASSWORD, or leave both empty for manual login.",
    );
  return { username, password };
}
