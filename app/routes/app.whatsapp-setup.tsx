import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getWAQRDataUrl, getWAStatus, getWAGroups } from "../whatsapp.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const status = getWAStatus();
  const qrDataUrl = getWAQRDataUrl();
  const groups = status === "connected" ? await getWAGroups() : [];
  const config = await prisma.whatsappConfig.findUnique({
    where: { shop: session.shop },
  });

  return { status, qrDataUrl, groups, config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const form = await request.formData();
  const groupId = form.get("groupId") as string;
  const groupName = form.get("groupName") as string;

  await prisma.whatsappConfig.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, groupId, groupName },
    update: { groupId, groupName },
  });

  return { success: true };
};

export default function WhatsappSetup() {
  const { status, qrDataUrl, groups, config } =
    useLoaderData<typeof loader>();

  const saveFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher<{ status: string; qrDataUrl: string | null }>();

  const [liveStatus, setLiveStatus] = useState(status);
  const [liveQR, setLiveQR] = useState(qrDataUrl);
  const [liveGroups, setLiveGroups] = useState(groups);
  const [selectedGroupId, setSelectedGroupId] = useState(config?.groupId ?? "");
  const [selectedGroupName, setSelectedGroupName] = useState(config?.groupName ?? "");
  const saved = saveFetcher.data?.success;

  // Poll status every 3 seconds until connected
  useEffect(() => {
    if (liveStatus === "connected") return;
    const interval = setInterval(() => {
      if (statusFetcher.state === "idle") {
        statusFetcher.load("/api/whatsapp-status");
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [liveStatus]);

  useEffect(() => {
    if (!statusFetcher.data) return;
    setLiveStatus(statusFetcher.data.status);
    setLiveQR(statusFetcher.data.qrDataUrl);
    // Once connected, reload to get groups list
    if (statusFetcher.data.status === "connected" && liveGroups.length === 0) {
      window.location.reload();
    }
  }, [statusFetcher.data]);

  const statusLabel: Record<string, string> = {
    disconnected: "⚫  Disconnected — waiting for WhatsApp...",
    qr_pending: "🟡  Scan the QR code below with your phone",
    connected: "🟢  Connected and ready",
  };

  return (
    <s-page heading="WhatsApp Setup">
      <s-section heading="Connection Status">
        <s-paragraph>
          <strong>{statusLabel[liveStatus] ?? liveStatus}</strong>
        </s-paragraph>

        {liveStatus === "disconnected" && (
          <s-paragraph>
            The server is starting WhatsApp. A QR code will appear in a few
            seconds — keep this page open.
          </s-paragraph>
        )}

        {liveStatus === "qr_pending" && liveQR && (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              On your dedicated phone, open WhatsApp →{" "}
              <strong>Settings → Linked Devices → Link a Device</strong> and
              scan this code.
            </s-paragraph>
            <img
              src={liveQR}
              alt="WhatsApp QR Code"
              style={{ width: 240, height: 240, display: "block" }}
            />
            <s-paragraph>
              <em>Refreshes automatically every few seconds...</em>
            </s-paragraph>
          </s-stack>
        )}

        {liveStatus === "connected" && (
          <s-paragraph>
            WhatsApp is linked. You can now select the group below.
          </s-paragraph>
        )}
      </s-section>

      {liveStatus === "connected" && (
        <s-section heading="Orders Group">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Choose the WhatsApp group where new orders will be sent.
            </s-paragraph>

            <select
              value={selectedGroupId}
              onChange={(e) => {
                const opt = e.currentTarget.options[e.currentTarget.selectedIndex];
                setSelectedGroupId(e.currentTarget.value);
                setSelectedGroupName(opt?.text ?? "");
              }}
              style={{
                padding: "8px 12px",
                fontSize: "14px",
                width: "100%",
                maxWidth: 420,
                borderRadius: 6,
                border: "1px solid #c9cccf",
              }}
            >
              <option value="">— Select a group —</option>
              {liveGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <s-stack direction="inline" gap="base">
              <s-button
                variant="primary"
                onClick={() => {
                  if (!selectedGroupId) return;
                  saveFetcher.submit(
                    { groupId: selectedGroupId, groupName: selectedGroupName },
                    { method: "post" },
                  );
                }}
              >
                Save Group
              </s-button>
              {saved && (
                <s-badge tone="success">
                  Saved — {selectedGroupName}
                </s-badge>
              )}
              {!saved && config?.groupName && (
                <s-paragraph>
                  Current: <strong>{config.groupName}</strong>
                </s-paragraph>
              )}
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
