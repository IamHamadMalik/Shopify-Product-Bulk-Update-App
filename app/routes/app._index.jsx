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
                  Follow these simple steps to use the bulk product editor
                  smoothly.
                </Text>
                <List type="number" spacing="loose">
                  <List.Item>
                    Open the <strong>Bulk Product Update</strong> page.
                  </List.Item>
                  <List.Item>
                    At the top, click the <strong>Refresh Tag</strong> button.
                    Run this once to fetch the latest tags for smooth filtering.
                  </List.Item>
                  <List.Item>
                    Click <strong>Edit Fields</strong> and select which product
                    fields you want to edit: title, description, vendor,
                    product type, tags, price, compare-at price, or inventory
                    quantity.
                  </List.Item>
                  <List.Item>
                    Use the search and filters to find products by product type,
                    vendor, collection, or tag.
                  </List.Item>
                  <List.Item>
                    The list shows 50 products initially — scroll down to load
                    more automatically.
                  </List.Item>
                  <List.Item>
                    Select the products you want to edit, then click{" "}
                    <strong>Next</strong> to open the bulk edit page.
                  </List.Item>
                  <List.Item>Make your bulk edits and save the changes.</List.Item>
                  <List.Item>
                    After saving, you’ll return to the bulk product page with a
                    success message and a log of all edited products. Click a
                    product in the log to open it in the admin in a new tab.
                  </List.Item>
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
