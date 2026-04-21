import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { sendOrderToGroup, type OrderData } from "../whatsapp.server";

const GET_ORDERS = `#graphql
  query GetOrders {
    orders(first: 50, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            displayName
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
                }
                image { url }
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
  const sentIds = new Set(sent.map((s) => s.orderId));

  const config = await prisma.whatsappConfig.findUnique({
    where: { shop: session.shop },
    select: { groupId: true, groupName: true },
  });

  return { orders, sentIds: [...sentIds], config };
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
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        customer { displayName phone }
        lineItems(first: 20) {
          edges {
            node {
              title
              quantity
              variant {
                title
                image { url }
              }
              image { url }
            }
          }
        }
      }
    }`,
    { variables: { id: orderId } },
  );

  const orderJson = await orderRes.json();
  const o = orderJson.data?.order;

  if (!o) {
    return { error: "Order not found." };
  }

  const payload: OrderData = {
    orderNumber: o.name.replace("#", ""),
    customerName: o.customer?.displayName ?? "Guest",
    customerPhone: o.customer?.phone ?? null,
    total: o.totalPriceSet.shopMoney.amount,
    currency: o.totalPriceSet.shopMoney.currencyCode,
    fulfillmentStatus: o.displayFulfillmentStatus,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineItems: o.lineItems.edges.map((e: any) => ({
      title: e.node.title,
      quantity: e.node.quantity,
      variantTitle: e.node.variant?.title ?? null,
      imageUrl: e.node.image?.url ?? e.node.variant?.image?.url ?? null,
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

export default function OrdersPage() {
  const { orders, sentIds, config } = useLoaderData<typeof loader>();
  const sendFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const sentSet = new Set(sentIds);
  const submittingId =
    sendFetcher.state !== "idle"
      ? (sendFetcher.formData?.get("orderId") as string | null)
      : null;

  useEffect(() => {
    if (sendFetcher.data && "success" in sendFetcher.data) {
      shopify.toast.show(`${sendFetcher.data.orderName} sent to WhatsApp ✓`);
    }
    if (sendFetcher.data && "error" in sendFetcher.data) {
      shopify.toast.show(sendFetcher.data.error as string, { isError: true });
    }
  }, [sendFetcher.data]);

  return (
    <s-page heading="Orders">
      {!config?.groupId && (
        <s-section heading="Setup required">
          <s-paragraph>
            Please configure your WhatsApp group in{" "}
            <s-link href="/app/whatsapp-setup">WhatsApp Setup</s-link> before
            sending orders.
          </s-paragraph>
        </s-section>
      )}

      <s-section heading={`Recent orders (${orders.length})`}>
        {orders.length === 0 && (
          <s-paragraph>No orders found in your store.</s-paragraph>
        )}

        <s-stack direction="block" gap="base">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {orders.map((order: any) => {
            const isSent = sentSet.has(order.id);
            const isSending = submittingId === order.id;
            const items = order.lineItems.edges.map((e: any) => e.node);
            const date = new Date(order.createdAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });

            return (
              <s-box
                key={order.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack direction="inline" gap="loose" align="start">
                  {/* Order info */}
                  <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
                    <s-stack direction="inline" gap="tight" align="center">
                      <s-heading>{order.name}</s-heading>
                      {isSent && <s-badge tone="success">Sent</s-badge>}
                    </s-stack>

                    <s-text subdued>
                      {date} · {order.customer?.displayName ?? "Guest"}
                      {order.customer?.phone
                        ? ` · ${order.customer.phone}`
                        : ""}
                    </s-text>

                    <s-text subdued>
                      {order.displayFulfillmentStatus} ·{" "}
                      {order.totalPriceSet.shopMoney.currencyCode}{" "}
                      {order.totalPriceSet.shopMoney.amount}
                    </s-text>

                    {/* Line items with thumbnails */}
                    <s-stack direction="block" gap="tight">
                      {items.map((item: any, idx: number) => {
                        const imgUrl =
                          item.image?.url ?? item.variant?.image?.url ?? null;
                        const variant =
                          item.variant?.title &&
                          item.variant.title !== "Default Title"
                            ? ` (${item.variant.title})`
                            : "";
                        return (
                          <s-stack
                            key={idx}
                            direction="inline"
                            gap="tight"
                            align="center"
                          >
                            {imgUrl ? (
                              <img
                                src={imgUrl}
                                alt={item.title}
                                style={{
                                  width: 48,
                                  height: 48,
                                  objectFit: "cover",
                                  borderRadius: 4,
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 4,
                                  background: "#e4e5e7",
                                  flexShrink: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 20,
                                }}
                              >
                                📦
                              </div>
                            )}
                            <s-text>
                              {item.title}
                              {variant} × {item.quantity}
                            </s-text>
                          </s-stack>
                        );
                      })}
                    </s-stack>
                  </s-stack>

                  {/* Send button */}
                  <div style={{ flexShrink: 0 }}>
                    <s-button
                      variant={isSent ? "tertiary" : "primary"}
                      {...(isSending ? { loading: true } : {})}
                      {...(isSending ? { disabled: true } : {})}
                      onClick={() => {
                        sendFetcher.submit(
                          { orderId: order.id },
                          { method: "post" },
                        );
                      }}
                    >
                      {isSent ? "Resend" : "Send to WhatsApp"}
                    </s-button>
                  </div>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
