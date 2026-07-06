import type { FastifyInstance } from "fastify";
import {
  checkForUpdates,
  getUpdateProgress,
  isUpdateInProgress,
  prepareUpdateApply,
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
      try {
        const { releaseTag, installDir } = prepareUpdateApply(request.body?.releaseTag);
        triggerUpdate(releaseTag, installDir);

        return {
          success: true,
          message: "Update started. The server will restart when the update completes.",
          releaseTag,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start update";
        const statusCode =
          message === "An update is already in progress"
            ? 409
            : message === "You are already on the latest release" ||
                message === "No release available to install" ||
                message === "Invalid release tag" ||
                message === "In-app updates are not supported on this install"
              ? 400
              : 400;

        return reply.status(statusCode).send({ error: message });
      }
    },
  );
}
