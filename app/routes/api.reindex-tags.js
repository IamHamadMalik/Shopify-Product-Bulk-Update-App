import { json } from "@remix-run/node";
import { indexAllTags } from "../../scripts/index-tags";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const action = async ({ request }) => {
  try {
    // Get shop from request headers or query params
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || process.env.SHOP;

    if (!shop) {
      return json({ success: false, error: "Shop URL not provided" }, { status: 400 });
    }

    // Check for session in database
    const session = await prisma.session.findFirst({
      where: { shop },
    });

    if (!session?.accessToken) {
      return json({ success: false, error: "No valid session found for shop" }, { status: 401 });
    }

    // Run the tag indexing
    await indexAllTags(shop, session.accessToken);
    return json({ success: true });
  } catch (error) {
    console.error("❌ Failed to index tags:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
};