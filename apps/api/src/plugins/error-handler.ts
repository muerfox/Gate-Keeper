import type { FastifyError, FastifyInstance } from "fastify";

/** Generic error responses everywhere: never leak stack traces, internal
 * error messages, or library-specific details to clients — these can
 * reveal implementation details useful to an attacker (docs/THREAT_MODEL.md
 * defense-in-depth stance). Full detail still goes to the server log. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    request.log.error({ err }, "unhandled request error");

    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.code ?? "bad_request", message: err.message });
    }

    return reply.code(500).send({ error: "internal_error" });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: "not_found" });
  });
}
