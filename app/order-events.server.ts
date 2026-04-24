// Manages SSE connections for real-time order update notifications.
// Uses a global singleton so HMR doesn't lose existing connections in dev.

type Controller = ReadableStreamDefaultController;

declare global {
  // eslint-disable-next-line no-var
  var __orderEventControllers: Set<Controller> | undefined;
}

if (!global.__orderEventControllers) {
  global.__orderEventControllers = new Set();
}

const controllers = global.__orderEventControllers;

export function addController(controller: Controller) {
  controllers.add(controller);
}

export function removeController(controller: Controller) {
  controllers.delete(controller);
}

export function notifyOrderUpdate() {
  const encoder = new TextEncoder();
  for (const ctrl of [...controllers]) {
    try {
      ctrl.enqueue(encoder.encode("data: order_updated\n\n"));
    } catch {
      controllers.delete(ctrl);
    }
  }
}
