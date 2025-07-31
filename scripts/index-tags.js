// scripts/index-tags.js
import { PrismaClient } from "@prisma/client";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

export async function indexAllTags() {
  const shop = process.env.SHOP;
  if (!shop) {
    console.error("❌ Missing SHOP in .env");
    process.exit(1);
  }

  const session = await prisma.session.findFirst({
    where: { shop },
  });

  if (!session?.accessToken) {
    console.error("❌ No access token found in DB for shop", shop);
    process.exit(1);
  }

  const SHOPIFY_ADMIN_API_URL = `https://${shop}/admin/api/2024-07/graphql.json`;
  const SHOPIFY_ADMIN_TOKEN = session.accessToken;

  const PAGE_SIZE = 250;
  let allTags = new Set();
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      query getTags($cursor: String) {
        products(first: ${PAGE_SIZE}, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              tags
            }
          }
        }
      }
    `;

    const variables = cursor ? { cursor } : {};

    const response = await fetch(SHOPIFY_ADMIN_API_URL, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error("❌ Shopify API errors:", data.errors);
      break;
    }

    const products = data.data.products.edges;
    products.forEach(edge => {
      edge.node.tags.forEach(tag => allTags.add(tag.trim()));
    });

    hasNextPage = data.data.products.pageInfo.hasNextPage;
    cursor = data.data.products.pageInfo.endCursor;
  }

  const uniqueTags = Array.from(allTags).filter(Boolean);
  console.log(`✅ [${new Date().toISOString()}] Collected ${uniqueTags.length} unique tags.`);

  const existing = await prisma.productTagsIndex.findFirst({
    where: { shop },
  });

  if (existing) {
    await prisma.productTagsIndex.update({
      where: { id: existing.id },
      data: { tags: uniqueTags },
    });
    console.log(`✅ [${new Date().toISOString()}] Updated existing tags index.`);
  } else {
    await prisma.productTagsIndex.create({
      data: { shop, tags: uniqueTags },
    });
    console.log(`✅ [${new Date().toISOString()}] Created new tags index.`);
  }

  await prisma.$disconnect();
}
