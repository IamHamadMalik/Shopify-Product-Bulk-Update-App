import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  Form,
  useFetcher,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  Page,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Card,
  Text,
  Checkbox,
  BlockStack,
  InlineStack,
  Divider,
  TextField,
  Select,
  Button,
  Scrollable,
} from "@shopify/polaris";
import { XIcon, ExternalIcon } from '@shopify/polaris-icons';
import { useState, useEffect, useRef, useCallback } from "react";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PAGE_SIZE = 50;

/** ------------------ LOADER ------------------ **/
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const query = url.searchParams.get("query");
  const productType = url.searchParams.get("productType");
  const vendor = url.searchParams.get("vendor");
  const collectionId = url.searchParams.get("collectionId");
  const tag = url.searchParams.get("tag");
  const success = url.searchParams.get("success") === "1";
  const editedIdsParam = url.searchParams.get("edited_ids");

  let editedProducts = null;

  if (success && editedIdsParam) {
    const editedIds = editedIdsParam.split(',');
    if (editedIds.length > 0) {
      const nodesResponse = await admin.graphql(`
        query getEditedProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              featuredImage {
                url
                altText
              }
            }
          }
        }
      `, { variables: { ids: editedIds } });

      const nodesData = await nodesResponse.json();
      editedProducts = nodesData.data.nodes.filter(Boolean);
    }
  }

  let searchQueryParts = [];
  if (query) searchQueryParts.push(`title:*${query}*`);
  if (productType) searchQueryParts.push(`product_type:${productType}`);
  if (vendor) searchQueryParts.push(`vendor:${vendor}`);
  if (tag) searchQueryParts.push(`tag:${tag}`);
  const searchQuery =
    searchQueryParts.length > 0 ? searchQueryParts.join(" AND ") : null;

  let productsQuery;
  let variables = { cursor };
  if (collectionId) {
    productsQuery = `
      query GetProductsInCollection($cursor: String) {
        collection(id: "${collectionId}") {
          products(first: ${PAGE_SIZE}, after: $cursor) {
            edges {
              cursor
              node {
                id
                title
                productType
                vendor
                tags
                images(first: 1) { edges { node { originalSrc } } }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;
  } else {
    productsQuery = `
      query GetProducts($cursor: String, $searchQuery: String) {
        products(first: ${PAGE_SIZE}, after: $cursor, query: $searchQuery) {
          edges {
            cursor
            node {
              id
              title
              productType
              vendor
              tags
              images(first: 1) { edges { node { originalSrc } } }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    variables.searchQuery = searchQuery;
  }

  const response = await admin.graphql(productsQuery, { variables });
  const jsonResponse = await response.json();

  const FILTERS_QUERY = `
    {
      productTypes(first: 100) { edges { node } }
      productVendors(first: 100) { edges { node } }
      collections(first: 100, query: "collection_type:smart OR collection_type:custom") {
        edges { node { id title } }
      }
    }
  `;
  const filtersResponse = await admin.graphql(FILTERS_QUERY);
  const filtersData = await filtersResponse.json();

  const tagsRecord = await prisma.productTagsIndex.findFirst({
    where: { shop: process.env.SHOP },
  });
  const allTags = tagsRecord?.tags || [];

  return json({
    products: collectionId
      ? jsonResponse.data.collection?.products?.edges || []
      : jsonResponse.data.products.edges,
    pageInfo: collectionId
      ? jsonResponse.data.collection?.products?.pageInfo || {
          hasNextPage: false,
        }
      : jsonResponse.data.products.pageInfo,
    query: query || "",
    productType: productType || "",
    vendor: vendor || "",
    collectionId: collectionId || "",
    tag: tag || "",
    filters: {
      productTypes: filtersData.data.productTypes.edges.map((e) => e.node),
      vendors: filtersData.data.productVendors.edges.map((e) => e.node),
      collections: filtersData.data.collections.edges.map((e) => e.node),
      tags: allTags,
    },
    success,
    editedProducts,
    shop: session.shop,
  });
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const ids = JSON.parse(formData.get("selectedProductIds") || "[]");
  const fields = JSON.parse(formData.get("fieldsToEdit") || "[]");

  if (ids.length === 0 || fields.length === 0) {
    return redirect("/app/bulk-products");
  }

  return redirect(
    `/app/bulk-edit?ids=${ids.join(",")}&fields=${fields.join(",")}`
  );
};

// FilterBar component
function FilterBar({
  query,
  onQueryChange,
  filters,
  appliedFilters,
  onFilterChange,
}) {
  const [selectedProductType, setSelectedProductType] = useState(
    appliedFilters.productType || ""
  );
  const [selectedVendor, setSelectedVendor] = useState(
    appliedFilters.vendor || ""
  );
  const [selectedCollection, setSelectedCollection] = useState(
    appliedFilters.collectionId || ""
  );
  const [tagInput, setTagInput] = useState(appliedFilters.tag || "");

  useEffect(() => {
    setSelectedProductType(appliedFilters.productType || "");
    setSelectedVendor(appliedFilters.vendor || "");
    setSelectedCollection(appliedFilters.collectionId || "");
    setTagInput(appliedFilters.tag || "");
  }, [appliedFilters]);

  const handleApplyFilters = () => {
    onFilterChange({
      productType: selectedProductType,
      vendor: selectedVendor,
      collectionId: selectedCollection,
      tag: tagInput,
    });
  };

  const handleClearFilters = () => {
    setSelectedProductType("");
    setSelectedVendor("");
    setSelectedCollection("");
    setTagInput("");
    onFilterChange({
      productType: "",
      vendor: "",
      collectionId: "",
      tag: "",
    });
  };

  return (
    <Card sectioned>
      <style>
        {`
          .filter-select-container {
            max-width: 200px;
            overflow: hidden;
          }
          .filter-select-container .Polaris-Select__Content {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .filter-select-container .Polaris-Select__SelectedOption {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 100%;
          }
        `}
      </style>
      <BlockStack gap="400">
        <TextField
          label="Search products"
          value={query}
          onChange={onQueryChange}
          autoComplete="off"
          placeholder="Search by product title"
        />

        <InlineStack gap="400" wrap={false} align="start">
          <div className="filter-select-container">
            <Select
              label="Product Type"
              options={[{ label: "All types", value: "" }].concat(
                filters.productTypes.map((type) => ({
                  label: type,
                  value: type,
                }))
              )}
              value={selectedProductType}
              onChange={setSelectedProductType}
            />
          </div>
          <div className="filter-select-container">
            <Select
              label="Vendor"
              options={[{ label: "All vendors", value: "" }].concat(
                filters.vendors.map((vendor) => ({
                  label: vendor,
                  value: vendor,
                }))
              )}
              value={selectedVendor}
              onChange={setSelectedVendor}
            />
          </div>
          <div className="filter-select-container">
            <Select
              label="Collection"
              options={[{ label: "All collections", value: "" }].concat(
                filters.collections.map((collection) => ({
                  label: collection.title,
                  value: collection.id,
                }))
              )}
              value={selectedCollection}
              onChange={setSelectedCollection}
            />
          </div>
          <div className="filter-select-container">
            <Select
              label="Tag"
              options={[{ label: "All tags", value: "" }].concat(
                filters.tags.map((tag) => ({
                  label: tag,
                  value: tag,
                }))
              )}
              value={tagInput}
              onChange={setTagInput}
            />
          </div>
        </InlineStack>

        <InlineStack gap="200">
          <Button onClick={handleApplyFilters}>Apply Filters</Button>
          <Button variant="plain" onClick={handleClearFilters}>
            Clear all
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

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

/** ------------------ COMPONENT ------------------ **/
export default function BulkProducts() {
  const {
    products: initialProducts,
    pageInfo: initialPageInfo,
    query: initialQuery,
    productType: initialProductType,
    vendor: initialVendor,
    collectionId: initialCollectionId,
    tag: initialTag,
    filters,
    success,
    editedProducts,
    shop,
  } = useLoaderData();

  const fetcher = useFetcher();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [showSummary, setShowSummary] = useState(
    success && editedProducts && editedProducts.length > 0
  );
  const [products, setProducts] = useState(initialProducts);
  const [pageInfo, setPageInfo] = useState(initialPageInfo);
  const [selectedItems, setSelectedItems] = useState([]);
  const [fieldsToEdit, setFieldsToEdit] = useState([]);
  const [query, setQuery] = useState(initialQuery);
  const [appliedFilters, setAppliedFilters] = useState({
    productType: initialProductType,
    vendor: initialVendor,
    collectionId: initialCollectionId,
    tag: initialTag,
  });
  const [isRefreshingTags, setIsRefreshingTags] = useState(false);
  const [showTagsRefreshSuccess, setShowTagsRefreshSuccess] = useState(false);
  const loadMoreRef = useRef(null);
  const isLoading = navigation.state === "loading" || fetcher.state === "loading";
  const [isAllSelected, setIsAllSelected] = useState(false);

  // Check for tags refresh success on mount
  useEffect(() => {
    const tagsRefreshSuccess = localStorage.getItem('tagsRefreshSuccess');
    if (tagsRefreshSuccess === 'true') {
      setShowTagsRefreshSuccess(true);
      localStorage.removeItem('tagsRefreshSuccess'); // Clear after showing
    }
  }, []);

  useEffect(() => {
    if (initialQuery === query) return;
    const handler = setTimeout(() => {
      updateFilters({ ...appliedFilters, query });
    }, 500);
    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    setProducts(initialProducts);
    setPageInfo(initialPageInfo);
  }, [initialProducts]);

  useEffect(() => {
    if (fetcher.data?.products) {
      const newProducts = fetcher.data.products;
      setProducts((prev) => [...prev, ...newProducts]);
      setPageInfo(fetcher.data.pageInfo);
    }
  }, [fetcher.data]);

  const updateFilters = (newFilters) => {
    const params = new URLSearchParams();
    if (newFilters.query) params.set("query", newFilters.query);
    if (newFilters.productType) params.set("productType", newFilters.productType);
    if (newFilters.vendor) params.set("vendor", newFilters.vendor);
    if (newFilters.collectionId) params.set("collectionId", newFilters.collectionId);
    if (newFilters.tag) params.set("tag", newFilters.tag);
    setAppliedFilters(newFilters);
    submit(params, { replace: true });
  };

  const handleFilterChange = (newFilters) => {
    updateFilters({ ...newFilters, query });
  };

  const handleQueryChange = useCallback((value) => setQuery(value), []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          pageInfo.hasNextPage &&
          fetcher.state === "idle"
        ) {
          const params = new URLSearchParams();
          params.set("cursor", pageInfo.endCursor);
          if (query) params.set("query", query);
          if (appliedFilters.productType)
            params.set("productType", appliedFilters.productType);
          if (appliedFilters.vendor) params.set("vendor", appliedFilters.vendor);
          if (appliedFilters.collectionId)
            params.set("collectionId", appliedFilters.collectionId);
          if (appliedFilters.tag) params.set("tag", appliedFilters.tag);
          fetcher.load(`?${params.toString()}`);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [pageInfo, fetcher, query, appliedFilters]);

  const toggleField = (field) => {
    setFieldsToEdit((prev) =>
      prev.includes(field)
        ? prev.filter((f) => f !== field)
        : [...prev, field]
    );
  };

  const toggleSelectAllFields = () => {
    if (fieldsToEdit.length === FIELD_OPTIONS.length) {
      setFieldsToEdit([]);
    } else {
      setFieldsToEdit(FIELD_OPTIONS.map((f) => f.value));
    }
  };

  const handleSelectionChange = (newSelected) => {
    // Handle "All" selection
    if (newSelected.includes("All")) {
      setIsAllSelected(true);
      const allProductIds = products.map((p) => p.node.id);
      setSelectedItems(allProductIds);
      return;
    }

    // Handle deselection of "All" or individual items
    if (newSelected.length === 0) {
      setIsAllSelected(false);
      setSelectedItems([]);
      return;
    }

    // Handle individual selections
    setIsAllSelected(false); // Reset "All" state since individual items are selected
    const visibleIds = new Set(products.map((p) => p.node.id));
    setSelectedItems((prevSelected) => {
      const selectionsFromOtherPages = prevSelected.filter(
        (id) => !visibleIds.has(id) && id !== "All"
      );
      const merged = [...selectionsFromOtherPages, ...newSelected];
      return Array.from(new Set(merged));
    });
  };

  // Update the ResourceList to reflect "All" selection
  const isAllCheckboxChecked = isAllSelected || selectedItems.length === products.length;

  const getAdminUrl = (productId) => {
    const numericId = productId.split('/').pop();
    return `https://${shop}/admin/products/${numericId}`;
  };

  const handleRefreshTags = async () => {
    setIsRefreshingTags(true);
    try {
      const res = await fetch("/api/reindex-tags", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        console.log("✅ Tags were refreshed successfully.");
        localStorage.setItem('tagsRefreshSuccess', 'true');
        window.location.reload();
      } else {
        console.error("❌ Failed to refresh tags:", data.error);
      }
    } catch (error) {
      console.error("❌ Failed to refresh tags:", error);
    } finally {
      setIsRefreshingTags(false);
    }
  };

  return (
    <Page
      title="Bulk Update Products"
      primaryAction={{
        content: `Next (${selectedItems.length} selected)`,
        disabled: selectedItems.length === 0 || fieldsToEdit.length === 0,
        onAction: () => {
          document.getElementById("bulk-edit-form").requestSubmit();
        },
      }}
    >
      <BlockStack gap="400">
        {showSummary ? (
          <Card>
            <BlockStack gap="400">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "1rem 1rem 0 1rem",
                }}
              >
                <Text as="h2" variant="headingMd">
                  ✅ Products Updated Successfully
                </Text>
                <Button
                  variant="plain"
                  icon={XIcon}
                  onClick={() => setShowSummary(false)}
                  accessibilityLabel="Dismiss summary"
                />
              </div>
              <div style={{ padding: "0 1rem" }}>
                <Text as="p" variant="bodyMd">
                  The following {editedProducts.length} products were updated:
                </Text>
              </div>

              <div
                style={{
                  height: "250px",
                  borderTop: "1px solid var(--p-color-border)",
                }}
              >
                <Scrollable shadow style={{ height: "100%" }} focusable>
                  <ResourceList
                    resourceName={{ singular: "product", plural: "products" }}
                    items={editedProducts}
                    renderItem={(product) => {
                      const { id, title, featuredImage } = product;
                      return (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            padding: "0.5rem 1rem",
                          }}
                        >
                          <Thumbnail
                            source={featuredImage?.url || ""}
                            alt={featuredImage?.altText || title}
                            size="small"
                            style={{ marginRight: "1rem" }}
                          />
                          <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" fontWeight="bold" as="h3">
                              {title}
                            </Text>
                          </div>
                          <Button
                            icon={ExternalIcon}
                            onClick={() => window.open(getAdminUrl(id), "_blank")}
                            accessibilityLabel={`View ${title} in admin`}
                            variant="plain"
                          />
                        </div>
                      );
                    }}
                  />
                </Scrollable>
              </div>
            </BlockStack>
          </Card>
        ) : (
          success && (
            <Card sectioned tone="success">
              <Text variant="bodyMd">
                Your products have been updated successfully.
              </Text>
            </Card>
          )
        )}

        {showTagsRefreshSuccess && (
          <Card sectioned tone="success">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="bodyMd">
                  Tags index has been refreshed successfully.
                </Text>
                <Button
                  variant="plain"
                  icon={XIcon}
                  onClick={() => setShowTagsRefreshSuccess(false)}
                  accessibilityLabel="Dismiss success message"
                />
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card sectioned>
          <BlockStack gap="200">
            <Text variant="headingSm" tone="subdued">
              Note
            </Text>
            <Text variant="bodyMd">
              If you have recently updated product tags outside this tool, please
              click “Refresh Tags Index” before editing. This ensures you are
              working with the most up-to-date tag list.
            </Text>
            <Button
              primary
              onClick={handleRefreshTags}
              loading={isRefreshingTags}
              disabled={false}
            >
              🔄 Refresh Tags Index
            </Button>
          </BlockStack>
        </Card>

        <Card sectioned>
          <BlockStack gap="200">
            <Text variant="headingMd">Select fields to edit</Text>
            <InlineStack gap="300" wrap={false}>
              <Checkbox
                label="Select all fields"
                checked={fieldsToEdit.length === FIELD_OPTIONS.length}
                onChange={toggleSelectAllFields}
              />
            </InlineStack>
            <InlineStack gap="300" wrap>
              {FIELD_OPTIONS.map((f) => (
                <Checkbox
                  key={f.value}
                  label={f.label}
                  checked={fieldsToEdit.includes(f.value)}
                  onChange={() => toggleField(f.value)}
                />
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        <FilterBar
          query={query}
          onQueryChange={handleQueryChange}
          filters={filters}
          appliedFilters={appliedFilters}
          onFilterChange={handleFilterChange}
        />

        <Divider />

        <Form method="post" id="bulk-edit-form">
          <input
            type="hidden"
            name="selectedProductIds"
            value={JSON.stringify(selectedItems)}
          />
          <input
            type="hidden"
            name="fieldsToEdit"
            value={JSON.stringify(fieldsToEdit)}
          />

          <Card>
            <ResourceList
              resourceName={{ singular: "product", plural: "products" }}
              items={products}
              selectedItems={selectedItems}
              onSelectionChange={handleSelectionChange}
              selectable
              loading={isLoading}
              showHeader={true}
              // Optional: Use bulkActions to customize the "Select All" behavior if needed
              bulkActions={[
                {
                  content: isAllCheckboxChecked ? "Deselect all" : "Select all",
                  onAction: () => {
                    if (isAllCheckboxChecked) {
                      setIsAllSelected(false);
                      setSelectedItems([]);
                    } else {
                      setIsAllSelected(true);
                      const allProductIds = products.map((p) => p.node.id);
                      setSelectedItems(allProductIds);
                    }
                  },
                },
              ]}
              renderItem={(item) => {
                const { node } = item;
                const image = node.images.edges[0]?.node?.originalSrc;
                return (
                  <ResourceItem id={node.id}>
                    <InlineStack align="start" gap="400" wrap={false}>
                      <Thumbnail
                        source={image || ""}
                        alt={node.title}
                        size="small"
                      />
                      <Text
                        as="span"
                        variant="bodyMd"
                        fontWeight="medium"
                        style={{
                          maxWidth: "200px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {node.title}
                      </Text>
                    </InlineStack>
                  </ResourceItem>
                );
              }}
            />
            {pageInfo.hasNextPage && (
              <div
                ref={loadMoreRef}
                style={{
                  textAlign: "center",
                  padding: "1rem",
                  color: "#666",
                  fontSize: "0.9rem",
                }}
              >
                {fetcher.state === "loading" ? "Loading more products..." : "Scroll to load more"}
              </div>
            )}
          </Card>
        </Form>
      </BlockStack>
    </Page>
  );
}