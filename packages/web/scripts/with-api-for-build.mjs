import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "../..");
const nextDir = path.join(webRoot, ".next");
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
      const status = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
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
  if (!child || child.pid == null) return;
  try {
    // Kill the whole prerender API group (node + ffprobe/youtube-dl children).
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }
}

let apiProcess = null;

function assertNoMediaLoadingShell(html, sampleName) {
  const mainStart = html.indexOf("<main>");
  const mainEnd = html.indexOf("</main>");
  if (mainStart === -1 || mainEnd === -1) {
    throw new Error(`[media] ${sampleName} is missing <main> — build output looks broken`);
  }

  const main = html.slice(mainStart, mainEnd);
  const issues = [];
  if (main.includes("animate-pulse")) issues.push("animate-pulse skeleton");
  if (main.includes("h-80 w-full")) issues.push("media page skeleton (h-80)");
  if (main.includes("h-96 w-full")) issues.push("home loading skeleton (h-96)");
  if (!main.includes("font-black") && !main.includes("<h1")) {
    issues.push("missing hero heading");
  }

  if (issues.length > 0) {
    throw new Error(
      `[media] ${sampleName} still ships a loading shell (${issues.join(", ")}). ` +
        "Remove route loading.tsx from static ISR pages and rebuild clean.",
    );
  }
}

try {
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    console.log("[media] Cleared previous .next output for a clean prerender");
  }

  let apiReady = false;

  if (fs.existsSync(serverEntry)) {
    apiProcess = spawn("node", [serverEntry], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        MEDIA_API_ONLY: "1",
        MEDIA_INTERNAL_API_PORT: apiPort,
        MEDIA_PRERENDER_BUILD: "1",
      },
      stdio: "pipe",
    });
    apiProcess.unref();

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
    ...(apiReady ? { MEDIA_PRERENDER_BUILD: "1" } : {}),
  };
  delete buildEnv.MEDIA_INTERNAL_API_PORT;
  delete buildEnv.MEDIA_PRERENDER_API_PORT;

  await run("pnpm", ["exec", "next", "build"], { cwd: webRoot, env: buildEnv });
  await run("node", ["scripts/copy-standalone-assets.mjs"], { cwd: webRoot });

  const mediaHtmlDir = path.join(webRoot, ".next/server/app/media");
  const prerendered =
    fs.existsSync(mediaHtmlDir) &&
    fs.readdirSync(mediaHtmlDir).filter((name) => /^\d+\.html$/.test(name));

  if (apiReady && prerendered.length === 0) {
    console.warn(
      "[media] Build API was ready but no media pages were pre-rendered. Check data_dir and /api/media/ids.",
    );
  } else if (prerendered.length > 0) {
    console.log(`[media] Pre-rendered HTML for ${prerendered.length} media page(s)`);
    for (const name of prerendered.slice(0, 3)) {
      const html = fs.readFileSync(path.join(mediaHtmlDir, name), "utf8");
      assertNoMediaLoadingShell(html, name);
    }
    console.log("[media] Verified prerendered media HTML has hero markup and no loading shells");
  }
} finally {
  stopProcess(apiProcess);
}
