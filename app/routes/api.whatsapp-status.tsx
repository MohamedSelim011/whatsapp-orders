import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getWAStatus, getWAQRDataUrl } from "../whatsapp.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return Response.json({
    status: getWAStatus(),
    qrDataUrl: getWAQRDataUrl(),
  });
};
