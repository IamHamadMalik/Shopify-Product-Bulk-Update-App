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
  Collapsible,
  Icon,
} from "@shopify/polaris";
import {
  XIcon,
  ExternalIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@shopify/polaris-icons';
import { useState, useEffect, useRef, useCallback } from "react";
import { Spinner } from "@shopify/polaris";
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
function FilterBar({ query, onQueryChange, filters, appliedFilters, onFilterChange }) {
  const [selectedProductType, setSelectedProductType] = useState(appliedFilters.productType || "");
  const [selectedVendor, setSelectedVendor] = useState(appliedFilters.vendor || "");
  const [selectedCollection, setSelectedCollection] = useState(appliedFilters.collectionId || "");
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
    onFilterChange({ productType: "", vendor: "", collectionId: "", tag: "" });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <div style={{ padding: "var(--p-space-400)" }}>
          <TextField
            label="Search products by title"
            labelHidden
            value={query}
            onChange={onQueryChange}
            autoComplete="off"
            placeholder="Search by product title"
          />
        </div>
        <div style={{ padding: "0 var(--p-space-400) var(--p-space-200)" }}>
          <InlineStack gap="400" wrap={true} align="start">
            <Select
              label="Product Type"
              options={[{ label: "All types", value: "" }, ...filters.productTypes.map((type) => ({ label: type, value: type }))]}
              value={selectedProductType}
              onChange={setSelectedProductType}
            />
            <Select
              label="Vendor"
              options={[{ label: "All vendors", value: "" }, ...filters.vendors.map((vendor) => ({ label: vendor, value: vendor }))]}
              value={selectedVendor}
              onChange={setSelectedVendor}
            />
            <Select
              label="Collection"
              options={[{ label: "All collections", value: "" }, ...filters.collections.map((c) => ({ label: c.title, value: c.id }))]}
              value={selectedCollection}
              onChange={setSelectedCollection}
            />
            <Select
              label="Tag"
              options={[{ label: "All tags", value: "" }, ...filters.tags.map((tag) => ({ label: tag, value: tag }))]}
              value={tagInput}
              onChange={setTagInput}
            />
          </InlineStack>
        </div>
        <div style={{ padding: "0 var(--p-space-400) var(--p-space-400)" }}>
          <InlineStack gap="200">
            <Button onClick={handleApplyFilters} variant="primary">Apply Filters</Button>
            <Button onClick={handleClearFilters}>Clear all</Button>
          </InlineStack>
        </div>
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
  const [showSummary, setShowSummary] = useState(success && editedProducts && editedProducts.length > 0);
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
  const [tagsRefreshError, setTagsRefreshError] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const maxVisibleCount = 7;
  const isFetchingRef = useRef(false);
  const isSubmitting = navigation.state === "submitting";
  const isLoading = navigation.state === "loading" || fetcher.state === "loading";

  useEffect(() => {
    isFetchingRef.current = fetcher.state !== "idle";
  }, [fetcher.state]);

  useEffect(() => {
    setProducts(initialProducts);
    setPageInfo(initialPageInfo);
  }, [initialProducts, initialPageInfo]);

  useEffect(() => {
    if (fetcher.data?.products) {
      setProducts((prev) => [...prev, ...fetcher.data.products]);
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

  const handleFilterChange = (newFilters) => updateFilters({ ...newFilters, query });
  const handleQueryChange = useCallback((value) => setQuery(value), []);

  useEffect(() => {
    if (initialQuery === query) return;
    const handler = setTimeout(() => {
      updateFilters({ ...appliedFilters, query });
    }, 500);
    return () => clearTimeout(handler);
  }, [query]);

  const handleLoadMore = () => {
    if (!pageInfo.hasNextPage || fetcher.state !== "idle") return;

    const params = new URLSearchParams();
    params.set("cursor", pageInfo.endCursor);
    if (query) params.set("query", query);
    if (appliedFilters.productType) params.set("productType", appliedFilters.productType);
    if (appliedFilters.vendor) params.set("vendor", appliedFilters.vendor);
    if (appliedFilters.collectionId) params.set("collectionId", appliedFilters.collectionId);
    if (appliedFilters.tag) params.set("tag", appliedFilters.tag);

    fetcher.load(`/app/bulk-products?${params.toString()}`);
  };

  const handleTabClick = (tabName) => setActiveTab((prev) => (prev === tabName ? null : tabName));

  const toggleField = (field) => {
    setFieldsToEdit((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  const toggleSelectAllFields = () => {
    if (fieldsToEdit.length === FIELD_OPTIONS.length) {
      setFieldsToEdit([]);
    } else {
      setFieldsToEdit(FIELD_OPTIONS.map((f) => f.value));
    }
  };

  const getAdminUrl = (productId) => {
    const numericId = productId.split('/').pop();
    return `https://${shop}/admin/products/${numericId}`;
  };

  const handleRefreshTags = async () => {
    setIsRefreshingTags(true);
    setTagsRefreshError(null);
    try {
      const res = await fetch(`/api/reindex-tags?shop=${shop}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setShowTagsRefreshSuccess(true);
        submit(new URLSearchParams(window.location.search), { replace: true });
      } else {
        setTagsRefreshError(data.error || "Failed to refresh tags");
      }
    } catch (error) {
      setTagsRefreshError(error.message || "Failed to refresh tags");
    } finally {
      setIsRefreshingTags(false);
    }
  };

  const handleDismissSuccess = () => {
    setShowSummary(false);
    const params = new URLSearchParams(window.location.search);
    params.delete("success");
    params.delete("edited_ids");
    submit(params, { replace: true });
  };

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          :root {
            --font-family-sans: 'Inter', sans-serif;
            --p-font-family-sans: var(--font-family-sans);
          }
          .Polaris-Page {
            font-family: var(--font-family-sans);
          }
          .tab-header {
            cursor: pointer;
            padding: var(--p-space-400);
            transition: background-color 0.2s ease;
            display: flex;
            align-items: center;
          }
          .tab-header:hover {
            background-color: var(--p-color-bg-surface-hover);
          }
          .tab-header-title {
            flex-grow: 1;
          }
          .collapsible-content {
            padding: var(--p-space-400);
            border-top: 1px solid var(--p-color-border);
            animation: fadeIn 0.5s ease-in-out;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>

      <Page title="Bulk Update Products">
        <Form method="post" id="bulk-edit-form">
          <BlockStack gap="500">
            {showSummary && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <div style={{ padding: "1rem" }}>
                      <Text as="h2" variant="headingMd">✅ Products Updated Successfully</Text>
                      <Text as="p" variant="bodyMd">
                        The following {editedProducts.length} products were updated.<br />
                      </Text>
                    </div>
                    <div style={{ paddingRight: "1rem" }}>
                      <Button
                        variant="plain"
                        icon={XIcon}
                        onClick={handleDismissSuccess}
                        accessibilityLabel="Dismiss summary"
                      />
                    </div>
                  </InlineStack>

                  <div style={{ maxHeight: "240px", overflowY: "auto", borderTop: "1px solid var(--p-color-border)" }}>
                    <ResourceList
                      resourceName={{ singular: "product", plural: "products" }}
                      items={editedProducts}
                      renderItem={(product) => (
                        <ResourceItem
                          id={product.id}
                          shortcutActions={[{
                            content: "View",
                            icon: ExternalIcon,
                            onAction: () => window.open(getAdminUrl(product.id), "_blank"),
                          }]}
                          persistActions
                        >
                          <InlineStack gap="400" wrap={false} blockAlign="center">
                            <Thumbnail
                              source={product.featuredImage?.url || ""}
                              alt={product.featuredImage?.altText || product.title}
                              size="small"
                            />
                            <Text variant="bodyMd" fontWeight="bold" as="h3">{product.title}</Text>
                          </InlineStack>
                        </ResourceItem>
                      )}
                    />
                  </div>
                </BlockStack>
              </Card>
            )}

            {(() => {
              const tabOrder = ['tags', 'products', 'fields'];
              const goToNextTab = (currentTab) => {
                const currentIndex = tabOrder.indexOf(currentTab);
                if (currentIndex < tabOrder.length - 1) {
                  setActiveTab(tabOrder[currentIndex + 1]);
                }
              };

              return (
                <>
                  <Card>
                    <div className="tab-header" onClick={() => handleTabClick('tags')}>
                      <div className="tab-header-title">
                        <Text variant="headingMd" as="h3">Refresh Products Tags For Filtering</Text>
                      </div>
                      <Icon source={activeTab === 'tags' ? ChevronUpIcon : ChevronDownIcon} />
                    </div>
                    <Collapsible open={activeTab === 'tags'}>
                      <div className="collapsible-content">
                        <BlockStack gap="400">
                          <Text variant="bodyMd">
                            If you recently updated product tags outside this app, click here to refresh the tag list used in the filters.
                          </Text>
                          <Button onClick={handleRefreshTags} loading={isRefreshingTags} disabled={isRefreshingTags}>
                            Refresh Tags
                          </Button>
                          {showTagsRefreshSuccess && <Text tone="success">Tags refreshed successfully for filter.</Text>}
                          {tagsRefreshError && <Text tone="critical">{tagsRefreshError}</Text>}

                          <div style={{ textAlign: "right" }}>
                            <Button onClick={() => goToNextTab('tags')}>Next</Button>
                          </div>
                        </BlockStack>
                      </div>
                    </Collapsible>
                  </Card>

                  <Card>
                    <div className="tab-header" onClick={() => handleTabClick('products')}>
                      <div className="tab-header-title">
                        <Text variant="headingMd" as="h3">Select Products For Bulk Editing</Text>
                      </div>
                      <Icon source={activeTab === 'products' ? ChevronUpIcon : ChevronDownIcon} />
                    </div>

                    <Collapsible open={activeTab === 'products'}>
                      <div className="collapsible-content">
                        <BlockStack gap="400">
                          <FilterBar
                            query={query}
                            onQueryChange={handleQueryChange}
                            filters={filters}
                            appliedFilters={appliedFilters}
                            onFilterChange={handleFilterChange}
                          />

                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="bodyMd">
                              {products.length} product{products.length !== 1 && 's'} showing
                            </Text>
                            <InlineStack gap="200">
                              <Button
                                onClick={() => {
                                  const allProductIds = products.map(p => p.node.id);
                                  setSelectedItems(prev => Array.from(new Set([...prev, ...allProductIds])));
                                }}
                              >
                                Select All
                              </Button>
                              <Button onClick={() => setSelectedItems([])}>Deselect All</Button>
                              <Text variant="bodyMd">{selectedItems.length} selected</Text>
                            </InlineStack>
                          </InlineStack>

                          <div style={{ position: 'relative' }}>
                            <div style={{
                              opacity: (fetcher.state === "loading" || navigation.state === "loading") ? 0.5 : 1,
                              transition: "opacity 0.3s ease"
                            }}>
                              <div style={{
                                maxHeight: products.length > maxVisibleCount ? "500px" : "auto",
                                overflowY: products.length > maxVisibleCount ? "auto" : "visible",
                                transition: "max-height 0.3s ease",
                                border: "1px solid var(--p-color-border-subdued)",
                                borderRadius: "var(--p-border-radius-200)",
                                padding: "var(--p-space-200)"
                              }}>
                                {products.map((item) => {
                                  const { node } = item;
                                  const image = node.images.edges[0]?.node?.originalSrc;
                                  const isSelected = selectedItems.includes(node.id);

                                  const handleRowClick = (e) => {
                                    // Only trigger row click if the target is not the checkbox
                                    if (!e.target.closest('.Polaris-Checkbox')) {
                                      setSelectedItems(prev => {
                                        if (prev.includes(node.id)) {
                                          return prev.filter(id => id !== node.id);
                                        } else {
                                          return [...prev, node.id];
                                        }
                                      });
                                    }
                                  };

                                  return (
                                    <div
                                      key={node.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        padding: "0.5rem",
                                        borderBottom: "1px solid #eee",
                                        backgroundColor: isSelected ? "#F0F7FF" : "white",
                                        cursor: "pointer"
                                      }}
                                      onClick={handleRowClick}
                                    >
                                      <Checkbox
                                        checked={isSelected}
                                        onChange={(value, id) => {
                                          setSelectedItems(prev => {
                                            if (prev.includes(node.id)) {
                                              return prev.filter(id => id !== node.id);
                                            } else {
                                              return [...prev, node.id];
                                            }
                                          });
                                          // Stop event propagation to prevent row click
                                          event.stopPropagation();
                                        }}
                                      />
                                      <Thumbnail source={image || ""} alt={node.title} size="small" />
                                      <Text as="span" variant="bodyMd" style={{ marginLeft: "1rem" }}>{node.title}</Text>
                                    </div>
                                  );
                                })}

                                {products.length === 0 && !isLoading && (
                                  <div style={{ textAlign: "center", padding: "2rem" }}>
                                    <Text variant="bodyMd" tone="subdued">No products found matching your criteria.</Text>
                                  </div>
                                )}

                                <div style={{ textAlign: 'center', padding: '1rem' }}>
                                  {pageInfo.hasNextPage && (
                                    <Button onClick={handleLoadMore} loading={fetcher.state === "loading"}>
                                      Load More Products
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>

                            {(fetcher.state === "loading" || navigation.state === "loading") && (
                              <div style={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: 'rgba(255, 255, 255, 0.6)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 100
                              }}>
                                <Spinner size="large" accessibilityLabel="Loading" />
                              </div>
                            )}
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <Button onClick={() => goToNextTab('products')}>Next</Button>
                          </div>
                        </BlockStack>
                      </div>
                    </Collapsible>
                  </Card>

                  <Card>
                    <div className="tab-header" onClick={() => handleTabClick('fields')}>
                      <div className="tab-header-title">
                        <Text variant="headingMd" as="h3">Select Fields To Edit</Text>
                      </div>
                      <Icon source={activeTab === 'fields' ? ChevronUpIcon : ChevronDownIcon} />
                    </div>
                    <Collapsible open={activeTab === 'fields'}>
                      <div className="collapsible-content">
                        <BlockStack gap="400">
                          <Checkbox
                            label="Select all fields"
                            checked={fieldsToEdit.length === FIELD_OPTIONS.length}
                            onChange={toggleSelectAllFields}
                          />
                          <Divider />
                          <InlineStack gap="500" wrap>
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
                      </div>
                    </Collapsible>
                  </Card>
                </>
              );
            })()}

            <div style={{ marginBottom: '3rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div style={{ width: '23%' }}>
                  <button
                    type="submit"
                    disabled={selectedItems.length === 0 || fieldsToEdit.length === 0 || isSubmitting}
                    style={{
                      background: "#000",
                      color: "white",
                      border: "none",
                      padding: "0.75rem 1.25rem",
                      borderRadius: "4px",
                      cursor: selectedItems.length === 0 || fieldsToEdit.length === 0 || isSubmitting ? "not-allowed" : "pointer",
                      opacity: selectedItems.length === 0 || fieldsToEdit.length === 0 || isSubmitting ? 0.4 : 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      width: '100%',
                      justifyContent: 'center',
                    }}
                  >
                    {isSubmitting && (
                      <svg
                        width="26"
                        height="26"
                        viewBox="0 0 38 38"
                        xmlns="http://www.w3.org/2000/svg"
                        stroke="#fff"
                        strokeWidth="3" 
                      >
                        <g fill="none" fillRule="evenodd">
                          <g transform="translate(1 1)" strokeWidth="2">
                            <circle strokeOpacity=".3" cx="18" cy="18" r="18" />
                            <path d="M36 18c0-9.94-8.06-18-18-18">
                              <animateTransform
                                attributeName="transform"
                                type="rotate"
                                from="0 18 18"
                                to="360 18 18"
                                dur="1s"
                                repeatCount="indefinite"
                              />
                            </path>
                          </g>
                        </g>
                      </svg>
                    )}
                    {isSubmitting ? 'Processing...' : `Next (${selectedItems.length} products selected)`}
                  </button>
                </div>

                {isSubmitting && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginTop: '1rem',
                    }}
                  >
                    <Text
                      style={{ display: 'flex', alignItems: 'center' }}
                      variant="bodyMd"
                    >
                      Please wait, your request are being processed…
                    </Text>
                  </div>
                )}
              </div>
            </div>

            <input type="hidden" name="selectedProductIds" value={JSON.stringify(selectedItems)} />
            <input type="hidden" name="fieldsToEdit" value={JSON.stringify(fieldsToEdit)} />
          </BlockStack>
        </Form>
      </Page>
    </>
  );
}