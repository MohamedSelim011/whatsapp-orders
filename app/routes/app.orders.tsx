import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendOrderToGroup, type OrderData } from "../whatsapp.server";

const GET_ORDERS = `#graphql
  query GetOrders {
    orders(first: 200, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          customer {
            displayName
            phone
          }
          shippingAddress {
            address1
            address2
            city
            province
            country
          }
          lineItems(first: 20) {
            edges {
              node {
                title
                quantity
                variant {
                  title
                  product {
                    images(first: 1) {
                      edges { node { url } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const res = await admin.graphql(GET_ORDERS);
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders = (json.data?.orders?.edges ?? []).map((e: any) => e.node);

  const sent = await prisma.sentOrder.findMany({
    where: { shop: session.shop },
    select: { orderId: true },
  });

  const config = await prisma.whatsappConfig.findUnique({
    where: { shop: session.shop },
    select: { groupId: true, groupName: true },
  });

  return { orders, sentIds: sent.map((s) => s.orderId), config };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const orderId = form.get("orderId") as string;

  const config = await prisma.whatsappConfig.findUnique({
    where: { shop: session.shop },
  });

  if (!config?.groupId) {
    return { error: "No WhatsApp group configured. Go to WhatsApp Setup first." };
  }

  const orderRes = await admin.graphql(
    `#graphql
    query GetOrder($id: ID!) {
      order(id: $id) {
        id
        name
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { displayName phone }
        shippingAddress {
          address1
          address2
          city
          province
          country
          phone
        }
        lineItems(first: 20) {
          edges {
            node {
              title
              quantity
              variant {
                title
                image { url }
                product {
                  images(first: 1) {
                    edges { node { url } }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: orderId } },
  );

  const orderJson = await orderRes.json();
  const o = orderJson.data?.order;
  if (!o) return { error: "Order not found." };

  const addr = o.shippingAddress;
  const shippingAddress = addr
    ? [addr.address1, addr.address2, addr.city, addr.province, addr.country]
        .filter(Boolean)
        .join(", ")
    : null;

  const payload: OrderData = {
    orderNumber: o.name.replace("#", ""),
    customerName: o.customer?.displayName ?? "Guest",
    customerPhone: o.customer?.phone ?? o.shippingAddress?.phone ?? null,
    shippingAddress,
    total: o.totalPriceSet.shopMoney.amount,
    currency: o.totalPriceSet.shopMoney.currencyCode,
    fulfillmentStatus: o.displayFulfillmentStatus,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineItems: o.lineItems.edges.map((e: any) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      variantTitle: e.node.variant?.title ?? null,
      imageUrl:
        e.node.variant?.image?.url ??
        e.node.variant?.product?.images?.edges?.[0]?.node?.url ??
        null,
    })),
  };

  await sendOrderToGroup(config.groupId, payload);

  await prisma.sentOrder.upsert({
    where: { shop_orderId: { shop: session.shop, orderId } },
    create: { shop: session.shop, orderId, orderNumber: o.name },
    update: { sentAt: new Date() },
  });

  return { success: true, orderName: o.name };
};

// ─── helpers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatAddress(addr: any): string {
  if (!addr) return "—";
  return [addr.address1, addr.address2, addr.city, addr.country]
    .filter(Boolean)
    .join(", ");
}

const th: React.CSSProperties = {
  padding: "12px 10px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 13,
  color: "#6d7175",
  borderBottom: "2px solid #e1e3e5",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "12px 10px",
  verticalAlign: "middle",
  borderBottom: "1px solid #e1e3e5",
};

// ─── component ──────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { orders, sentIds, config } = useLoaderData<typeof loader>();
  const sendFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendQueue, setSendQueue] = useState<string[]>([]);
  const [bulkTotal, setBulkTotal] = useState(0);

  const sentSet = new Set(sentIds);
  const submittingId =
    sendFetcher.state !== "idle"
      ? (sendFetcher.formData?.get("orderId") as string | null)
      : null;

  // Real-time updates via SSE — when Shopify fires orders/updated webhook
  // the server pokes this stream and we revalidate immediately
  useEffect(() => {
    const es = new EventSource("/api/orders-sse");
    es.onmessage = () => {
      if (revalidatorRef.current.state === "idle") {
        revalidatorRef.current.revalidate();
      }
    };
    return () => es.close();
  }, []);

  // Process bulk send queue: whenever the fetcher goes idle and there are
  // queued orders, submit the next one automatically.
  useEffect(() => {
    if (sendFetcher.state !== "idle") return;
    if (sendQueue.length === 0) return;
    const [next, ...rest] = sendQueue;
    setSendQueue(rest);
    sendFetcher.submit({ orderId: next }, { method: "post" });
  }, [sendFetcher.state, sendQueue]);

  // Toast feedback
  useEffect(() => {
    if (!sendFetcher.data) return;
    if ("success" in sendFetcher.data) {
      if (sendQueue.length === 0 && bulkTotal > 1) {
        shopify.toast.show(`${bulkTotal} orders sent to WhatsApp ✓`);
        setBulkTotal(0);
      } else if (bulkTotal <= 1) {
        shopify.toast.show(`${sendFetcher.data.orderName} sent to WhatsApp ✓`);
      }
    } else if ("error" in sendFetcher.data) {
      shopify.toast.show(sendFetcher.data.error as string, { isError: true });
    }
  }, [sendFetcher.data]);

  const filtered = orders.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (o: any) =>
      !search.trim() ||
      o.name
        .toLowerCase()
        .includes(search.trim().toLowerCase().replace(/^#/, "")),
  );

  const allSelected =
    filtered.length > 0 &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filtered.every((o: any) => selected.has(o.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setSelected(new Set(filtered.map((o: any) => o.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = (orderId: string) => {
    sendFetcher.submit({ orderId }, { method: "post" });
  };

  const sendAll = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkTotal(ids.length);
    setSelected(new Set());
    const [first, ...rest] = ids;
    setSendQueue(rest);
    sendFetcher.submit({ orderId: first }, { method: "post" });
  };

  const isBulkSending = sendQueue.length > 0 || (bulkTotal > 1 && sendFetcher.state !== "idle");

  return (
    <s-page heading={`${orders.length} Orders`}>
      {!config?.groupId && (
        <s-section heading="Setup required">
          <s-paragraph>
            Configure your WhatsApp group in{" "}
            <s-link href="/app/whatsapp-setup">WhatsApp Setup</s-link> before
            sending orders.
          </s-paragraph>
        </s-section>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          {/* Search */}
          <s-text>Search orders</s-text>
          <div style={{ display: "flex", gap: 8, maxWidth: 560 }}>
            <input
              type="text"
              placeholder="e.g. #1001, #1002 or 1001 1002"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 14,
                border: "1px solid #c9cccf",
                borderRadius: 6,
                outline: "none",
              }}
            />
            <button
              onClick={() => setSearch("")}
              style={{
                padding: "8px 16px",
                fontSize: 14,
                border: "1px solid #c9cccf",
                borderRadius: 6,
                background: "white",
                cursor: "pointer",
              }}
            >
              {search ? "Clear" : "Search"}
            </button>
          </div>

          {/* Bulk action bar */}
          {selected.size > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 14, color: "#6d7175" }}>
                {selected.size} orders selected
              </span>
              <button
                onClick={sendAll}
                disabled={isBulkSending}
                style={{
                  background: isBulkSending ? "#6d7175" : "#008060",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isBulkSending ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {isBulkSending
                  ? `Sending… (${sendQueue.length + 1} left)`
                  : `Send All (${selected.size})`}
              </button>
            </div>
          )}

          {/* Table */}
          <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #e1e3e5" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead style={{ background: "#f6f6f7" }}>
                <tr>
                  <th style={{ ...th, width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={th}>Order</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Address</th>
                  <th style={th}>Payment</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {filtered.map((order: any) => {
                  const isSent = sentSet.has(order.id);
                  const isSending = submittingId === order.id;
                  const isSelected = selected.has(order.id);

                  return (
                    <tr
                      key={order.id}
                      style={{ background: isSelected ? "#f0f7ff" : "white" }}
                    >
                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(order.id)}
                        />
                      </td>

                      <td style={td}>
                        <div
                          style={{ color: "#2c6ecb", fontWeight: 600, fontSize: 14 }}
                        >
                          {order.name}
                        </div>
                        {isSent && (
                          <div style={{ color: "#008060", fontSize: 12, marginTop: 2 }}>
                            ✓ Sent
                          </div>
                        )}
                      </td>

                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>
                          {order.customer?.displayName ?? "Guest"}
                        </div>
                        {order.customer?.phone && (
                          <div style={{ color: "#6d7175", fontSize: 13, marginTop: 2 }}>
                            {order.customer.phone}
                          </div>
                        )}
                      </td>

                      <td style={{ ...td, color: "#6d7175", maxWidth: 220 }}>
                        {formatAddress(order.shippingAddress)}
                      </td>

                      <td style={{ ...td, fontWeight: 500 }}>
                        {order.totalPriceSet.shopMoney.currencyCode}{" "}
                        {Number(order.totalPriceSet.shopMoney.amount).toLocaleString()}
                      </td>

                      <td style={td}>
                        <button
                          onClick={() => send(order.id)}
                          disabled={isSending}
                          style={{
                            background: isSending ? "#6d7175" : "#1a1a1a",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            padding: "8px 18px",
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: isSending ? "not-allowed" : "pointer",
                            whiteSpace: "nowrap",
                            minWidth: 70,
                          }}
                        >
                          {isSending ? "Sending…" : isSent ? "Resend" : "Send"}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ ...td, textAlign: "center", color: "#6d7175", padding: 32 }}
                    >
                      No orders found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
