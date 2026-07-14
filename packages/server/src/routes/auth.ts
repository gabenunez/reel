import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth.js";
import type { ConfigManager } from "../config.js";

export async function authRoutes(
  app: FastifyInstance,
  auth: AuthService,
  configManager: ConfigManager,
) {
  app.get("/api/auth/status", async (request) => {
    const required = auth.isPasswordRequired();
    const publicPrefix = configManager.get().server.public_prefix ?? "";
    return {
      required,
      authenticated: auth.isAuthenticated(request),
      // Android TV uses this to persist a server URL that includes basePath.
      publicPrefix,
    };
  });

  app.post<{ Body: { password?: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      if (!auth.isPasswordRequired()) {
        return { success: true };
      }

      const password = (request.body?.password ?? "").trim();
      if (!password || !auth.verifyPassword(password)) {
        return reply.status(401).send({ error: "Invalid password" });
      }

      const token = auth.createSessionToken();
      reply.header("Set-Cookie", auth.allSessionCookies(token));
      // Native TV pairing reads this when HttpURLConnection drops Set-Cookie headers.
      return { success: true, token };
    },
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("Set-Cookie", auth.clearAllSessionCookies());
    return { success: true };
  });

  app.put<{
    Body: { password?: string; currentPassword?: string; remove?: boolean };
  }>("/api/settings/password", async (request, reply) => {
    const required = auth.isPasswordRequired();
    const { password = "", currentPassword = "", remove = false } =
      request.body ?? {};

    if (required) {
      if (!auth.isAuthenticated(request)) {
        return reply.status(401).send({ error: "Authentication required" });
      }
      if (!currentPassword || !auth.verifyPassword(currentPassword)) {
        return reply.status(401).send({ error: "Current password is incorrect" });
      }
    }

    if (remove) {
      auth.clearPassword();
      reply.header("Set-Cookie", auth.clearAllSessionCookies());
      return { success: true, passwordConfigured: false };
    }

    if (!password.trim()) {
      return reply.status(400).send({ error: "Password is required" });
    }
    if (password.length < 4) {
      return reply.status(400).send({ error: "Password must be at least 4 characters" });
    }

    auth.setPassword(password);
    const token = auth.createSessionToken();
    reply.header("Set-Cookie", auth.allSessionCookies(token));

    return { success: true, passwordConfigured: true };
  });
}
