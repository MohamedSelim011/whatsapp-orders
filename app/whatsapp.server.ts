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

function createClient(): { client: Client; state: WAState } {
  const state: WAState = { status: "disconnected", qrDataUrl: null };

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
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
    state.status = "qr_pending";
    state.qrDataUrl = await qrcode.toDataURL(qr);
  });

  client.on("ready", () => {
    state.status = "connected";
    state.qrDataUrl = null;
  });

  client.on("auth_failure", () => {
    state.status = "disconnected";
    state.qrDataUrl = null;
  });

  client.on("disconnected", () => {
    state.status = "disconnected";
    state.qrDataUrl = null;
  });

  client.initialize().catch(console.error);

  return { client, state };
}

let waClient: Client;
let waState: WAState;

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

export function getWAStatus(): WAStatus {
  return waState.status;
}

export function getWAQRDataUrl(): string | null {
  return waState.qrDataUrl;
}

export async function getWAGroups(): Promise<Array<{ id: string; name: string }>> {
  if (waState.status !== "connected") return [];
  const chats = await waClient.getChats();
  return chats
    .filter((chat) => chat.isGroup)
    .map((chat) => ({ id: chat.id._serialized, name: chat.name }));
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
