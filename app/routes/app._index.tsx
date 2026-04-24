import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getWAStatus } from "../whatsapp.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const waStatus = getWAStatus();

  const [config, sentCount] = await Promise.all([
    prisma.whatsappConfig.findUnique({
      where: { shop: session.shop },
      select: { groupName: true, groupId: true },
    }),
    prisma.sentOrder.count({ where: { shop: session.shop } }),
  ]);

  return { waStatus, config, sentCount };
};

export default function HomePage() {
  const { waStatus, config, sentCount } = useLoaderData<typeof loader>();

  const statusColor: Record<string, string> = {
    connected: "#008060",
    qr_pending: "#ffc453",
    disconnected: "#d82c0d",
  };

  const statusLabel: Record<string, string> = {
    connected: "Connected",
    qr_pending: "Waiting for QR scan",
    disconnected: "Disconnected",
  };

  const statusDot = (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: statusColor[waStatus] ?? "#6d7175",
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );

  return (
    <s-page heading="WhatsApp Orders">
      {/* Status cards row */}
      <s-section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {/* WhatsApp status */}
          <div
            style={{
              background: "white",
              border: "1px solid #e1e3e5",
              borderRadius: 8,
              padding: "20px 24px",
            }}
          >
            <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 8 }}>
              WhatsApp Status
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {statusDot}
              {statusLabel[waStatus] ?? waStatus}
            </div>
            {waStatus !== "connected" && (
              <div style={{ marginTop: 10 }}>
                <s-link href="/app/whatsapp-setup">Go to setup →</s-link>
              </div>
            )}
          </div>

          {/* Active group */}
          <div
            style={{
              background: "white",
              border: "1px solid #e1e3e5",
              borderRadius: 8,
              padding: "20px 24px",
            }}
          >
            <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 8 }}>
              Orders Group
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {config?.groupName ?? "—"}
            </div>
            {!config?.groupId && (
              <div style={{ marginTop: 10 }}>
                <s-link href="/app/whatsapp-setup">Select group →</s-link>
              </div>
            )}
          </div>

          {/* Orders sent */}
          <div
            style={{
              background: "white",
              border: "1px solid #e1e3e5",
              borderRadius: 8,
              padding: "20px 24px",
            }}
          >
            <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 8 }}>
              Orders Sent
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#1a1a1a" }}>
              {sentCount}
            </div>
          </div>
        </div>
      </s-section>

      {/* How it works */}
      <s-section heading="How it works">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            {
              step: "1",
              title: "Connect WhatsApp",
              desc: "Link a dedicated phone number by scanning a QR code. The session is saved — you only do this once.",
              href: "/app/whatsapp-setup",
              link: "Go to WhatsApp Setup",
              done: waStatus === "connected",
            },
            {
              step: "2",
              title: "Select your pickup group",
              desc: "Choose the WhatsApp group where your pickup team receives orders.",
              href: "/app/whatsapp-setup",
              link: "Select group",
              done: !!config?.groupId,
            },
            {
              step: "3",
              title: "Send orders",
              desc: "Browse your latest Shopify orders, pick the ones that are ready, and send them to the group with one click. Each product image is sent separately.",
              href: "/app/orders",
              link: "View orders",
              done: sentCount > 0,
            },
          ].map(({ step, title, desc, href, link, done }) => (
            <div
              key={step}
              style={{
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
                padding: "16px",
                background: done ? "#f1faf5" : "#fafafa",
                borderRadius: 8,
                border: `1px solid ${done ? "#b5e3d0" : "#e1e3e5"}`,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: done ? "#008060" : "#1a1a1a",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {done ? "✓" : step}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
                <div style={{ color: "#6d7175", fontSize: 14, marginBottom: 8 }}>
                  {desc}
                </div>
                <s-link href={href}>{link} →</s-link>
              </div>
            </div>
          ))}
        </div>
      </s-section>

      {/* What the group receives */}
      <s-section heading="What the pickup team receives">
        <div
          style={{
            background: "#f0f8ef",
            border: "1px solid #c9e8c4",
            borderRadius: 8,
            padding: "16px 20px",
            fontFamily: "monospace",
            fontSize: 13,
            lineHeight: 1.7,
            color: "#1a1a1a",
            maxWidth: 420,
          }}
        >
          <div>🛍️ <strong>New Order #3357</strong></div>
          <div style={{ marginTop: 4 }}>
            👤 <strong>Customer:</strong> Aya Waleed<br />
            📱 <strong>Phone:</strong> 01015947940
          </div>
          <div style={{ marginTop: 4 }}>
            📦 <strong>Items:</strong><br />
            &nbsp;&nbsp;1. Blue Dress (Size M) × 2<br />
            &nbsp;&nbsp;2. White Blouse × 1
          </div>
          <div style={{ marginTop: 4 }}>
            💰 <strong>Total:</strong> EGP 850.00<br />
            📍 <strong>Status:</strong> UNFULFILLED
          </div>
          <div style={{ marginTop: 8, color: "#6d7175" }}>
            ↳ [product image 1]<br />
            ↳ [product image 2]
          </div>
        </div>
        <s-paragraph>
          Each order is sent as a text message followed by one image per product,
          so the pickup team knows exactly what to prepare.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
