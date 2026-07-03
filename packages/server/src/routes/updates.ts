import type { FastifyInstance } from "fastify";
import {
  checkForUpdates,
  getUpdateProgress,
  isUpdateInProgress,
  triggerUpdate,
} from "../services/updates.js";

export async function updateRoutes(app: FastifyInstance) {
  app.get("/api/updates/progress", async () => ({
    updateInProgress: isUpdateInProgress(),
    progress: isUpdateInProgress() ? getUpdateProgress() : null,
  }));

  app.get<{ Querystring: { force?: string } }>("/api/updates/check", async (request) => {
    const force = request.query.force === "1";
    return checkForUpdates(force);
  });

  app.post<{ Body: { releaseTag?: string } }>(
    "/api/updates/apply",
    async (request, reply) => {
      const status = await checkForUpdates(true);

      if (!status.updateSupported) {
        return reply
          .status(400)
          .send({ error: "In-app updates are not supported on this install" });
      }

      if (status.updateInProgress) {
        return reply.status(409).send({ error: "An update is already in progress" });
      }

      const releaseTag =
        request.body?.releaseTag?.trim() ||
        (status.latestVersion ? `v${status.latestVersion}` : null);

      if (!releaseTag) {
        return reply.status(400).send({ error: "No release available to install" });
      }

      if (!status.updateAvailable) {
        return reply.status(400).send({ error: "You are already on the latest release" });
      }

      try {
        triggerUpdate(releaseTag, status.installDir);
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Failed to start update",
        });
      }

      return {
        success: true,
        message: "Update started. The server will restart when the update completes.",
        releaseTag,
      };
    },
  );
}
