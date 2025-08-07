import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    }
  );
  const responseJson = await response.json();
  const product = responseJson.data.productCreate.product;
  const variantId = product.variants.edges[0].node.id;
  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    }
  );
  const variantResponseJson = await variantResponse.json();

  return {
    product: responseJson.data.productCreate.product,
    variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
  };
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const productId = fetcher.data?.product?.id.replace(
    "gid://shopify/Product/",
    ""
  );

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <Page>
      <TitleBar title="Remix app template">
        <Button onClick={generateProduct} variant="primary" loading={isLoading}>
          Generate a product
        </Button>
      </TitleBar>

      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card padding="500" background="bg-surface-secondary">
              <BlockStack gap="400">
                <Text variant="headingLg" as="h1">
                  📋 Bulk Product Update — Instructions
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Follow these simple steps to use the bulk product editor smoothly.
                </Text>

                <BlockStack gap="300">
                  <Text as="p"><strong>Step 1:</strong> Open the <strong>Bulk Product Update</strong> page.</Text>

                  <Text as="p">
                    <strong>Step 2:</strong> Open the <strong>Refresh Products Tags For Filtering</strong> tab and click on <strong>Refresh Tags</strong>.
                    This is useful especially if the app was just installed or product tags were recently updated — it fetches all tags to use them in the filters. After that, click <strong>Next</strong>.
                  </Text>

                  <Text as="p">
                    <strong>Step 3:</strong> The <strong>Product Selection</strong> tab will open. Here you can:
                  </Text>
                  <ul style={{ paddingLeft: "1.5rem", marginTop: "-0.5rem", marginBottom: "1rem" }}>
                    <li>Search for specific products</li>
                    <li>Filter by product type, vendor, collections, or tags</li>
                    <li>Initially, 50 products are shown. When you scroll to the bottom, you'll see a "Load More Products" button — click it to display more products. Select desired products and click <strong>Next</strong></li>
                  </ul>

                  <Text as="p">
                    <strong>Step 4:</strong> The <strong>Select Fields</strong> tab opens.
                    Choose which product fields you want to bulk edit — either select all or choose specific ones like title, description, vendor, product type, tags, price, compare-at price, or inventory quantity.
                    After selecting, click <strong>Next</strong>.
                  </Text>

                  <Text as="p" >
                    <strong>Step 5:</strong> The <strong>Edit Products</strong> page will open.
                    Make the desired edits to your selected products:
                  </Text>
                  <ul style={{ paddingLeft: "1.5rem", marginTop: "-0.5rem"}}>
                    <li>You can edit each product individually with your desired values.</li>
                    <li>If the entries for a product are not correct, you can revert them back to their original values using the <strong>Reset This Product</strong> button.</li>
                    <li>When done, click <strong>Save All Changes</strong>. You will be redirected back to the main bulk update page.</li>
                  </ul>

                  <Text as="p">
                    <strong>Step 6:</strong> You’ll now see a <strong>Log</strong> of all edited products at the top of the page.
                    You can click the <strong>View</strong> button for any product to open its Shopify admin page and confirm the changes.
                  </Text>

                  <Text variant="bodyMd" tone="success">
                    🎉 Hurrah! You’re done. Happy bulk editing your products!
                  </Text>
                </BlockStack>
              </BlockStack>

            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
