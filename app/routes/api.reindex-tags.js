// app/routes/api/reindex-tags.js
import { json } from "@remix-run/node";
import { indexAllTags } from "../../scripts/index-tags";

// Optionally, reuse your authenticate util to secure the route.
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  // ✅ Optional: require the request to be from an authenticated Shopify admin session
  const { session } = await authenticate.admin(request);

  try {
    await indexAllTags();
    return json({ success: true });
  } catch (error) {
    console.error("❌ Failed to index tags:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};
