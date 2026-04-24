import type { LoaderFunctionArgs } from "react-router";
import { addController, removeController } from "../order-events.server";

// Unauthenticated SSE stream — only pushes a "poke" string, no sensitive data.
// The client calls revalidator.revalidate() on receipt which fetches fresh data
// via the authenticated loader.
export const loader = ({ request }: LoaderFunctionArgs) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      addController(controller);

      // Heartbeat to keep the connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        removeController(controller);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
