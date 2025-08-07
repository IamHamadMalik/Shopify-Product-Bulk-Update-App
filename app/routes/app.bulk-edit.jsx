import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Divider,
} from "@shopify/polaris";
import { useState, useMemo } from "react";
import { authenticate } from "../shopify.server";

const FIELD_OPTIONS = [
  { label: "Title", value: "title" },
  { label: "Description", value: "descriptionHtml" },
  { label: "Vendor", value: "vendor" },
  { label: "Product Type", value: "productType" },
  { label: "Tags", value: "tags" },
  { label: "Price", value: "price" },
  { label: "Compare At Price", value: "compareAtPrice" },
  { label: "Inventory Quantity", value: "inventoryQuantity" },
];

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const ids = url.searchParams.get("ids");
  const fields = url.searchParams.get("fields");

  if (!ids) throw new Response("No product IDs", { status: 400 });

  const { admin } = await authenticate.admin(request);

  const locRes = await admin.graphql(`
    query {
      locations(first: 1) {
        edges { node { id } }
      }
    }
  `);
  const locData = await locRes.json();
  const locationId = locData.data.locations.edges[0]?.node?.id;

  if (!locationId) throw new Response("No location", { status: 400 });

  const productsRes = await admin.graphql(`
    query ($ids: [ID!]!, $locationId: ID!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          featuredImage { url altText }
          variants(first: 50) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                inventoryItem {
                  id
                  inventoryLevel(locationId: $locationId) {
                    quantities(names: ["available"]) { name quantity }
                  }
                }
              }
            }
          }
        }
      }
    }
  `, { variables: { ids: ids.split(","), locationId } });

  const data = await productsRes.json();

  const products = data.data.nodes.map(p => ({
    ...p,
    tags: Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags || ""),
    variants: p.variants?.edges.map(edge => {
      const v = edge.node;
      const qty = v.inventoryItem?.inventoryLevel?.quantities?.find(q => q.name === "available")?.quantity ?? 0;
      return { ...v, inventoryQuantity: qty };
    }) || [],
  }));

  return json({
    products,
    locationId,
    fieldsToEdit: fields ? fields.split(",") : [],
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const updatesByProduct = {};
  for (const [key, value] of formData.entries()) {
    const [field, idx] = key.split(/_(.*)/s);
    if (!updatesByProduct[idx]) updatesByProduct[idx] = {};
    updatesByProduct[idx][field] = value;
  }
  const updates = Object.values(updatesByProduct);

  const invChanges = updates
    .filter(u =>
      u.inventoryItemId && u.locationId &&
      u.originalInventoryQuantity !== u.inventoryQuantity
    )
    .map(u => ({
      inventoryItemId: u.inventoryItemId,
      locationId: u.locationId,
      delta: parseInt(u.inventoryQuantity) - parseInt(u.originalInventoryQuantity),
    }));

  if (invChanges.length) {
    await admin.graphql(`
      mutation ($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup { id }
          userErrors { field message }
        }
      }
    `, { variables: { input: { reason: "correction", name: "available", changes: invChanges } } });
  }

  for (const update of updates) {
    if (update.productId) {
      const productInput = {
        id: update.productId,
        title: update.title,
        descriptionHtml: update.descriptionHtml,
        vendor: update.vendor,
        productType: update.productType,
        tags: typeof update.tags === 'string'
          ? update.tags.split(",").map(t => t.trim()).filter(Boolean)
          : undefined,
      };
      const cleanProductInput = Object.fromEntries(
        Object.entries(productInput).filter(([_, v]) => v !== undefined && v !== "")
      );

      if (Object.keys(cleanProductInput).length > 1) {
        await admin.graphql(`
          mutation ($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id }
              userErrors { field message }
            }
          }
        `, { variables: { input: cleanProductInput } });
      }
    }

    if (update.variantId) {
      const variantInput = {
        id: update.variantId,
        price: update.price ? parseFloat(update.price).toFixed(2) : undefined,
        compareAtPrice: update.compareAtPrice ? parseFloat(update.compareAtPrice).toFixed(2) : undefined,
      };
      const cleanVariantInput = Object.fromEntries(Object.entries(variantInput).filter(([_, v]) => v !== undefined));

      if (Object.keys(cleanVariantInput).length > 1) {
        await admin.graphql(`
          mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              product { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            productId: update.productId,
            variants: [cleanVariantInput],
          },
        });
      }
    }
  }

  const editedProductIds = [...new Set(
    updates.map(u => u.productId).filter(Boolean)
  )];

  const redirectUrl = new URL("/app/bulk-products", new URL(request.url).origin);
  redirectUrl.searchParams.set("success", "1");
  if (editedProductIds.length > 0) {
    redirectUrl.searchParams.set("edited_ids", editedProductIds.join(","));
  }

  return redirect(redirectUrl.toString());
};

export default function BulkEdit() {
  const { products, locationId, fieldsToEdit } = useLoaderData();
  const navigate = useNavigate();
  const [items, setItems] = useState(products);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetProducts, setResetProducts] = useState(new Set());

  const originals = useMemo(() => {
    const map = new Map();
    products.forEach((p, pi) =>
      p.variants.forEach((v, vi) => map.set(`${pi}_${vi}`, { inv: v.inventoryQuantity }))
    );
    return map;
  }, [products]);

  const handleChange = (pi, vi, field, val) => {
    setItems(items => items.map((p, pIdx) => {
      if (pIdx !== pi) return p;
      const cp = { ...p };
      if (vi === null) {
        cp[field] = val;
      } else {
        cp.variants = cp.variants.map((v, vIdx) => vIdx === vi ? { ...v, [field]: val } : v);
      }
      return cp;
    }));
    setResetProducts(prev => {
      const newSet = new Set(prev);
      newSet.delete(pi);
      return newSet;
    });
  };

  const handleResetProduct = (pi) => {
    setItems(items =>
      items.map((p, idx) => {
        if (idx !== pi) return p;
        const originalProduct = JSON.parse(JSON.stringify(products[pi]));
        return originalProduct;
      })
    );
    setResetProducts(prev => new Set(prev).add(pi));
  };

  return (
    <Page
      title="Bulk Edit Products"
      backAction={{ content: "Back", onAction: () => navigate("/app/bulk-products") }}
    >
      <Form method="post" onSubmit={() => setIsSubmitting(true)}>
        <BlockStack gap="400">
          {items.map((p, pi) => (
            <Card key={p.id}>
              <BlockStack>
                <div style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
                  {p.featuredImage?.url && (
                    <img src={p.featuredImage.url} alt={p.featuredImage.altText} style={{ width: 80, height: 80, borderRadius: 6 }} />
                  )}
                  <Text variant="headingMd">{p.title}</Text>
                </div>
                <Divider />
                <div style={{ padding: '1rem' }}>
                  <BlockStack gap="400">
                    <input type="hidden" name={`productId_${pi}`} value={p.id} />
                    {fieldsToEdit.includes("title") && (
                      <TextField label="Title" value={p.title} onChange={v => handleChange(pi, null, "title", v)} name={`title_${pi}`} />
                    )}
                    {fieldsToEdit.includes("descriptionHtml") && (
                      <TextField label="Description" value={p.descriptionHtml || ""} onChange={v => handleChange(pi, null, "descriptionHtml", v)} name={`descriptionHtml_${pi}`} multiline />
                    )}
                    {fieldsToEdit.includes("vendor") && (
                      <TextField label="Vendor" value={p.vendor || ""} onChange={v => handleChange(pi, null, "vendor", v)} name={`vendor_${pi}`} />
                    )}
                    {fieldsToEdit.includes("productType") && (
                      <TextField label="Product Type" value={p.productType || ""} onChange={v => handleChange(pi, null, "productType", v)} name={`productType_${pi}`} />
                    )}
                    {fieldsToEdit.includes("tags") && (
                      <TextField label="Tags" value={p.tags} onChange={v => handleChange(pi, null, "tags", v)} name={`tags_${pi}`} />
                    )}
                    {p.variants.map((v, vi) => {
                      const idx = `${pi}_${vi}`;
                      const origInv = originals.get(idx)?.inv ?? 0;
                      const showPrice = fieldsToEdit.includes("price");
                      const showCompareAt = fieldsToEdit.includes("compareAtPrice");
                      const showInventory = fieldsToEdit.includes("inventoryQuantity");
                      if (!showPrice && !showCompareAt && !showInventory) return null;

                      const variantFields = (
                        <>
                          {showPrice && (
                            <TextField label="Price" value={v.price || ""} onChange={val => handleChange(pi, vi, "price", val)} name={`price_${idx}`} type="number" prefix="$" />
                          )}
                          {showCompareAt && (
                            <TextField label="Compare At Price" value={v.compareAtPrice || ""} onChange={val => handleChange(pi, vi, "compareAtPrice", val)} name={`compareAtPrice_${idx}`} type="number" prefix="$" />
                          )}
                          {showInventory && (
                            <>
                              <TextField label="Inventory" value={v.inventoryQuantity} onChange={val => handleChange(pi, vi, "inventoryQuantity", val)} name={`inventoryQuantity_${idx}`} type="number" />
                              <input type="hidden" name={`inventoryItemId_${idx}`} value={v.inventoryItem?.id || ""} />
                              <input type="hidden" name={`locationId_${idx}`} value={locationId} />
                              <input type="hidden" name={`originalInventoryQuantity_${idx}`} value={origInv} />
                            </>
                          )}
                          <input type="hidden" name={`productId_${idx}`} value={p.id} />
                          <input type="hidden" name={`variantId_${idx}`} value={v.id} />
                        </>
                      );

                      if (p.variants.length === 1 && v.title === "Default Title") {
                        return <BlockStack key={v.id} gap="200" style={{ marginTop: '1rem' }}>{variantFields}</BlockStack>;
                      }

                      return (
                        <BlockStack key={v.id} style={{ border: '1px solid #ddd', borderRadius: 4, padding: '1rem', marginTop: '1rem' }}>
                          <Text variant="bodyMd"><b>Variant:</b> {v.title}</Text>
                          {variantFields}
                        </BlockStack>
                      );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <Button
                        onClick={() => handleResetProduct(pi)}
                        disabled={isSubmitting}
                        variant="secondary"
                      >
                        Reset This Product
                      </Button>
                    </div>
                  </BlockStack>
                </div>
              </BlockStack>
            </Card>
          ))}
          <div style={{ marginBottom: '3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{
              color: 'red',
              fontWeight: 'bold',
              margin: 0,
              maxWidth: '70%',
            }}>
              ⚠️ Note: Make sure your changes are correct, because once saved, they cannot be reverted.
            </p>

            <div style={{ width: '20%' }}>
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  background: "#000",
                  color: "white",
                  border: "none",
                  padding: "0.75rem 1.25rem",
                  borderRadius: "4px",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  opacity: isSubmitting ? 0.4 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                {isSubmitting ? 'Saving…' : 'Save All Changes'}
              </button>
            </div>
          </div>
        </BlockStack>
      </Form>
    </Page>
  );
}