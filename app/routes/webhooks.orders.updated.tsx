import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { notifyOrderUpdate } from "../order-events.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  notifyOrderUpdate();
  return new Response();
};
