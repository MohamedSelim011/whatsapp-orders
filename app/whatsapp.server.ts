import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode";

type WAStatus = "disconnected" | "qr_pending" | "connected";

interface WAState {
  status: WAStatus;
  qrDataUrl: string | null;
}

export interface OrderData {
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  total: string;
  currency: string;
  fulfillmentStatus: string;
  lineItems: Array<{
    title: string;
    quantity: number;
    variantTitle: string | null;
    imageUrl: string | null;
  }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __waClient: Client | undefined;
  // eslint-disable-next-line no-var
  var __waState: WAState | undefined;
}

// Prevent WhatsApp errors from ever crashing the Node.js process
process.on("unhandledRejection", (reason) => {
  console.error("[whatsapp] unhandled rejection (ignored):", reason);
});

function createClient(): { client: Client; state: WAState } {
  const state: WAState = { status: "disconnected", qrDataUrl: null };

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
      ],
    },
  });

  // Wrap async handlers so a throw never becomes an unhandled rejection
  client.on("qr", async (qr: string) => {
    try {
      state.status = "qr_pending";
      state.qrDataUrl = await qrcode.toDataURL(qr);
    } catch (err) {
      console.error("[whatsapp] QR generation failed:", err);
    }
  });

  client.on("ready", () => {
    state.status = "connected";
    state.qrDataUrl = null;
    console.log("[whatsapp] Client ready");
  });

  client.on("auth_failure", (msg) => {
    console.error("[whatsapp] Auth failure:", msg);
    state.status = "disconnected";
    state.qrDataUrl = null;
  });

  client.on("disconnected", (reason) => {
    console.warn("[whatsapp] Disconnected:", reason);
    state.status = "disconnected";
    state.qrDataUrl = null;
  });

  // Delay init so the HTTP server starts first, then Chrome launches in background
  setTimeout(() => {
    client.initialize().catch((err) => {
      console.error("[whatsapp] initialize() failed:", err);
      state.status = "disconnected";
    });
  }, 3000);

  return { client, state };
}

let waClient: Client;
let waState: WAState;

try {
  if (process.env.NODE_ENV === "production") {
    const result = createClient();
    waClient = result.client;
    waState = result.state;
  } else {
    if (!global.__waClient || !global.__waState) {
      const result = createClient();
      global.__waClient = result.client;
      global.__waState = result.state;
    }
    waClient = global.__waClient;
    waState = global.__waState;
  }
} catch (err) {
  console.error("[whatsapp] Failed to create client:", err);
  // Provide a dummy state so the rest of the app still works
  waState = { status: "disconnected", qrDataUrl: null };
  waClient = null as unknown as Client;
}

export function getWAStatus(): WAStatus {
  return waState.status;
}

export function getWAQRDataUrl(): string | null {
  return waState.qrDataUrl;
}

export async function getWAGroups(): Promise<Array<{ id: string; name: string }>> {
  if (waState.status !== "connected") return [];
  try {
    const chats = await waClient.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }));
  } catch {
    return [];
  }
}

export async function sendOrderToGroup(groupId: string, order: OrderData): Promise<void> {
  if (waState.status !== "connected") {
    throw new Error("WhatsApp is not connected");
  }

  const itemsText = order.lineItems
    .map((item, i) => {
      const variant =
        item.variantTitle && item.variantTitle !== "Default Title"
          ? ` (${item.variantTitle})`
          : "";
      return `${i + 1}. *${item.title}*${variant} × ${item.quantity}`;
    })
    .join("\n");

  const phoneText = order.customerPhone
    ? `\n📱 *Phone:* ${order.customerPhone}`
    : "";

  const message =
    `🛍️ *New Order #${order.orderNumber}*\n\n` +
    `👤 *Customer:* ${order.customerName}${phoneText}\n\n` +
    `📦 *Items:*\n${itemsText}\n\n` +
    `💰 *Total:* ${order.currency} ${order.total}\n` +
    `📍 *Status:* ${order.fulfillmentStatus}`;

  await waClient.sendMessage(groupId, message);

  for (const item of order.lineItems) {
    if (item.imageUrl) {
      try {
        const media = await MessageMedia.fromUrl(item.imageUrl, { unsafeMime: true });
        const variant =
          item.variantTitle && item.variantTitle !== "Default Title"
            ? ` (${item.variantTitle})`
            : "";
        await waClient.sendMessage(groupId, media, {
          caption: `${item.title}${variant} × ${item.quantity}`,
        });
      } catch {
        // skip failed images silently
      }
    }
  }
}
