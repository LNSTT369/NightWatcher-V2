import type { Env } from "./env.d";
import { NightwatcherMcpAgent } from "./mcp/agent";
import { handleCronEvent } from "./jobs/cron";
import { handleStreamConnection } from "./stream/handler";
import { handleSignalPost, handleSignalGet } from "./api/signal";

export { SessionDO } from "./durable-objects/session";
export { NightwatcherMcpAgent };

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          environment: env.ENVIRONMENT,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "nightwatcher",
          version: "0.1.0",
          description: "Cloudflare Workers MCP server for autonomous stock trading",
          endpoints: {
            health: "/health",
            mcp: "/mcp (via Durable Object)",
            signal: "/api/signal",
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (url.pathname.startsWith("/mcp")) {
      return NightwatcherMcpAgent.mount("/mcp", { binding: "MCP_AGENT" }).fetch(request, env, ctx);
    }

    if (url.pathname === "/stream") {
      return handleStreamConnection(request, env);
    }

    if (url.pathname === "/api/signal" && request.method === "POST") {
      return handleSignalPost(request, env);
    }

    const signalMatch = url.pathname.match(/^\/api\/signal\/([a-f0-9]+)$/);
    if (signalMatch && request.method === "GET") {
      return handleSignalGet(request, env, signalMatch[1]!);
    }

    if (url.pathname.startsWith("/api/signal") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const cronId = event.cron;
    console.log(`Cron triggered: ${cronId} at ${new Date().toISOString()}`);
    ctx.waitUntil(handleCronEvent(cronId, env));
  },
};
