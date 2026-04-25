import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode";

type WAStatus = "disconnected" | "qr_pending" | "connected";

interface WAState {
  status: WAStatus;
  qrDataUrl: string | null;
  initializing: boolean;
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
  var __waState: WAState;
}

// Shared state — works across HMR reloads in dev
if (!global.__waState) {
  global.__waState = { status: "disconnected", qrDataUrl: null, initializing: false };
}
const waState = global.__waState;

// Prevent any WhatsApp error from ever crashing the process
process.on("unhandledRejection", (reason) => {
  if (String(reason).includes("whatsapp") || String(reason).includes("puppeteer")) {
    console.error("[whatsapp] suppressed unhandled rejection:", reason);
  }
});

// Call this from the setup page action — safe to call multiple times
export function initWhatsApp(): void {
  if (waState.initializing || waState.status === "connected") return;
  if (global.__waClient) return; // already exists

  waState.initializing = true;

  try {
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

    client.on("qr", async (qr: string) => {
      try {
        waState.status = "qr_pending";
        waState.qrDataUrl = await qrcode.toDataURL(qr);
      } catch (err) {
        console.error("[whatsapp] QR error:", err);
      }
    });

    client.on("ready", () => {
      waState.status = "connected";
      waState.qrDataUrl = null;
      waState.initializing = false;
      console.log("[whatsapp] Connected");
    });

    client.on("auth_failure", (msg) => {
      console.error("[whatsapp] Auth failure:", msg);
      waState.status = "disconnected";
      waState.initializing = false;
    });

    client.on("disconnected", (reason) => {
      console.warn("[whatsapp] Disconnected:", reason);
      waState.status = "disconnected";
      waState.qrDataUrl = null;
      waState.initializing = false;
      global.__waClient = undefined;
    });

    client.initialize().catch((err) => {
      console.error("[whatsapp] initialize() failed:", err);
      waState.status = "disconnected";
      waState.initializing = false;
      global.__waClient = undefined;
    });

    global.__waClient = client;
  } catch (err) {
    console.error("[whatsapp] createClient() failed:", err);
    waState.status = "disconnected";
    waState.initializing = false;
  }
}

export function getWAStatus(): WAStatus {
  return waState.status;
}

export function getWAInitializing(): boolean {
  return waState.initializing;
}

export function getWAQRDataUrl(): string | null {
  return waState.qrDataUrl;
}

export async function getWAGroups(): Promise<Array<{ id: string; name: string }>> {
  if (waState.status !== "connected" || !global.__waClient) return [];
  try {
    const chats = await global.__waClient.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }));
  } catch {
    return [];
  }
}

export async function sendOrderToGroup(groupId: string, order: OrderData): Promise<void> {
  if (waState.status !== "connected" || !global.__waClient) {
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

  await global.__waClient.sendMessage(groupId, message);

  for (const item of order.lineItems) {
    if (item.imageUrl) {
      try {
        const media = await MessageMedia.fromUrl(item.imageUrl, { unsafeMime: true });
        const variant =
          item.variantTitle && item.variantTitle !== "Default Title"
            ? ` (${item.variantTitle})`
            : "";
        await global.__waClient.sendMessage(groupId, media, {
          caption: `${item.title}${variant} × ${item.quantity}`,
        });
      } catch {
        // skip failed images silently
      }
    }
  }
}
