// app/routes/app.bulk-status.jsx

import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";

export const loader = async ({ request }) => {
  console.log("🔍 [bulk-status] Loader called");

  const { session, admin } = await authenticate.admin(request);
  console.log("✅ [bulk-status] Authenticated session:", session);

  const query = `
    {
      currentBulkOperation {
        id
        status
        errorCode
        objectCount
        url
        partialDataUrl
      }
    }
  `;

  console.log("📡 [bulk-status] Sending GraphQL query to check BulkOperation status");

  const result = await admin.graphql(query);
  const jsonResult = await result.json();

  console.log("✅ [bulk-status] BulkOperation status response:", JSON.stringify(jsonResult, null, 2));

  return json(jsonResult);
};
