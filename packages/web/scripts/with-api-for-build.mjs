import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "../..");
const apiPort = process.env.MEDIA_PRERENDER_API_PORT ?? "18197";
const serverEntry = path.join(repoRoot, "packages/server/dist/index.js");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function waitForApi(maxMs = 30_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const status = await fetch(`http://127.0.0.1:${apiPort}/api/status`);
      const ids = await fetch(`http://127.0.0.1:${apiPort}/api/media/ids`);
      if (status.ok && ids.ok) return true;
    } catch {
      // API still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 2_000).unref();
}

let apiProcess = null;

try {
  let apiReady = false;

  if (fs.existsSync(serverEntry)) {
    apiProcess = spawn("node", [serverEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MEDIA_API_ONLY: "1",
        MEDIA_INTERNAL_API_PORT: apiPort,
        MEDIA_PRERENDER_BUILD: "1",
      },
      stdio: "pipe",
    });

    apiReady = await waitForApi();
    if (apiReady) {
      console.log(`MEDIA! API ready for build-time prerender (port ${apiPort})`);
    } else {
      console.warn(
        "MEDIA! API did not start in time — media pages will use on-demand ISR only.",
      );
    }
  } else {
    console.warn(
      "Server build missing — media pages will use on-demand ISR only.",
    );
  }

  const buildEnv = {
    ...process.env,
    MEDIA_INTERNAL_API_URL: `http://127.0.0.1:${apiPort}`,
    MEDIA_INTERNAL_API_PORT: apiPort,
    ...(apiReady ? { MEDIA_PRERENDER_BUILD: "1" } : {}),
  };

  await run("pnpm", ["exec", "next", "build"], { cwd: webRoot, env: buildEnv });
  await run("node", ["scripts/copy-standalone-assets.mjs"], { cwd: webRoot });
} finally {
  stopProcess(apiProcess);
}
