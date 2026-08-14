import { channel } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";

interface ServerRequestStartMessage {
  request: IncomingMessage;
  response: ServerResponse;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

channel("http.server.request.start").subscribe((message) => {
  const { request, response } = message as ServerRequestStartMessage;
  const startedAt = performance.now();
  let logged = false;

  const log = () => {
    if (logged) return;
    logged = true;

    const forwardedFor = header(request, "x-forwarded-for")?.split(",", 1)[0]?.trim();
    const path = request.url?.split("?", 1)[0] ?? "/";

    console.info(
      JSON.stringify({
        type: "http_access",
        timestamp: new Date().toISOString(),
        method: request.method ?? null,
        path,
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        completed: response.writableFinished,
        clientIp:
          header(request, "cf-connecting-ip") ??
          forwardedFor ??
          request.socket.remoteAddress ??
          null,
        userAgent: header(request, "user-agent") ?? null,
        cfRay: header(request, "cf-ray") ?? null,
      }),
    );
  };

  response.once("finish", log);
  response.once("close", log);
});
