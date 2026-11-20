'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  ImagePlus,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl, uploadImage } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

interface MarketplaceProductRow {
  id: string;
  listing_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  price: number;
  unit: string;
  category: string;
  in_stock: boolean;
  thumbnail_url: string | null;
  is_active: boolean;
  created_at: string;
}

const MARKET_CATEGORY_OPTIONS: CustomSelectOption[] = [
  { value: 'Groceries', label: 'Groceries & Provisions' },
  { value: 'Electronics', label: 'Electronics & Accessories' },
  { value: 'Fashion', label: 'Fashion & Traditional Wear' },
  { value: 'Pharmacy', label: 'Pharmacy & Wellness' },
  { value: 'Hardware', label: 'Hardware & Construction' },
  { value: 'Printing', label: 'Printing & Stationery' },
  { value: 'Food', label: 'Bakery, Cafe & Fresh Food' },
  { value: 'General', label: 'General Merchandise' },
];

export interface MarketplaceCatalogueManagerProps {
  mode: 'owner' | 'staff';
  listings: Listing[];
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

export function MarketplaceCatalogueManager({
  mode,
  listings,
  onNotice,
}: MarketplaceCatalogueManagerProps) {
  const { user: authUser } = useAuth();
  const [products, setProducts] = useState<MarketplaceProductRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedShopKey, setCopiedShopKey] = useState<string | null>(null);
  const [editingPriceMap, setEditingPriceMap] = useState<Record<string, string>>(
    {}
  );
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Add / Edit product form state (Owner mode)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('piece');
  const [category, setCategory] = useState('General');
  const [description, setDescription] = useState('');
  const [inStock, setInStock] = useState(true);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);

  const listingOptions: CustomSelectOption[] = useMemo(
    () =>
      listings.map((l) => ({
        value: l.id,
        label: l.title,
        description: l.locality,
      })),
    [listings]
  );

  const listingIdsKey = useMemo(
    () => listings.map((l) => l.id).join(','),
    [listings]
  );

  const authUserId = authUser?.id || '';

  const loadProducts = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id || authUserId;
      const accessibleIds = listingIdsKey
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      let query = supabase
        .from('marketplace_products')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (mode === 'owner' && uid) {
        if (accessibleIds.length > 0) {
          query = query.or(
            `owner_id.eq.${uid},listing_id.in.(${accessibleIds.join(',')})`
          );
        } else {
          query = query.eq('owner_id', uid);
        }
      } else if (accessibleIds.length > 0) {
        query = query.in('listing_id', accessibleIds);
      } else {
        setProducts([]);
        setIsLoading(false);
        return;
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const hydrated = ((data || []) as MarketplaceProductRow[]).map((row) => ({
        ...row,
        price: Number(row.price),
      }));
      setProducts(hydrated);
    } catch (err) {
      setBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to load marketplace catalogue.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [authUserId, listingIdsKey, mode]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts();
    });
  }, [loadProducts]);

  const resetForm = () => {
    setEditingProductId(null);
    setListingId(listings[0]?.id || '');
    setTitle('');
    setPrice('');
    setUnit('piece');
    setCategory('General');
    setDescription('');
    setInStock(true);
    setThumbnailUrl('');
  };

  const openCreateForm = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEditForm = (item: MarketplaceProductRow) => {
    setEditingProductId(item.id);
    setListingId(item.listing_id);
    setTitle(item.title);
    setPrice(String(item.price));
    setUnit(item.unit || 'piece');
    setCategory(item.category || 'General');
    setDescription(item.description || '');
    setInStock(item.in_stock);
    setThumbnailUrl(item.thumbnail_url || '');
    setIsFormOpen(true);
  };

  const handleUploadThumbnail = async (file: File | null) => {
    if (!file) return;
    setIsUploadingThumb(true);
    setAppStatus('saving', 'Uploading product image…');
    try {
      const uploaded = await uploadImage(file, {
        folder: 'listings',
        listingId: listingId || undefined,
      });
      setThumbnailUrl(uploaded.publicUrl);
      setAppStatus('success', 'Thumbnail uploaded');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Thumbnail upload failed.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Upload failed');
    } finally {
      setIsUploadingThumb(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const numericPrice = Number(price);

    if (!listingId) {
      setBanner({
        type: 'error',
        text: 'Select a shop listing to link this product.',
      });
      return;
    }
    if (!trimmedTitle || !Number.isFinite(numericPrice) || numericPrice < 0) {
      setBanner({
        type: 'error',
        text: 'Provide a valid product title and non-negative price.',
      });
      return;
    }

    setIsSaving(true);
    setAppStatus('saving', 'Saving product…');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id || authUser?.id;
      if (!uid) throw new Error('Sign in required to manage products.');

      if (editingProductId) {
        const { error } = await supabase
          .from('marketplace_products')
          .update({
            listing_id: listingId,
            title: trimmedTitle,
            price: numericPrice,
            unit: unit.trim() || 'piece',
            category,
            description: description.trim() || null,
            in_stock: inStock,
            thumbnail_url: thumbnailUrl.trim() || null,
          })
          .eq('id', editingProductId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('marketplace_products').insert({
          listing_id: listingId,
          owner_id: uid,
          title: trimmedTitle,
          price: numericPrice,
          unit: unit.trim() || 'piece',
          category,
          description: description.trim() || null,
          in_stock: inStock,
          thumbnail_url: thumbnailUrl.trim() || null,
          is_active: true,
        });
        if (error) throw new Error(error.message);
      }

      const msg = editingProductId
        ? `Updated "${trimmedTitle}".`
        : `Added "${trimmedTitle}" to Marketplace.`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Product saved');
      setIsFormOpen(false);
      resetForm();
      await loadProducts();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save product.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStock = async (item: MarketplaceProductRow) => {
    setTogglingId(item.id);
    setAppStatus('saving', 'Updating stock…');
    try {
      const nextStock = !item.in_stock;
      const { error } = await supabase
        .from('marketplace_products')
        .update({ in_stock: nextStock })
        .eq('id', item.id);
      if (error) throw new Error(error.message);

      setProducts((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, in_stock: nextStock } : p))
      );
      setAppStatus('success', nextStock ? 'Marked In Stock' : 'Marked Out of Stock');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update stock.',
      });
      setAppStatus('error', 'Stock update failed');
    } finally {
      setTogglingId(null);
    }
  };

  const handleQuickPriceSave = async (item: MarketplaceProductRow) => {
    const raw = editingPriceMap[item.id];
    const nextPrice = Number(raw);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) return;
    setTogglingId(item.id);
    setAppStatus('saving', 'Updating price…');
    try {
      const { error } = await supabase
        .from('marketplace_products')
        .update({ price: nextPrice })
        .eq('id', item.id);
      if (error) throw new Error(error.message);

      setProducts((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, price: nextPrice } : p))
      );
      setEditingPriceMap((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setAppStatus('success', 'Price updated');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update price.',
      });
      setAppStatus('error', 'Price update failed');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteProduct = async (item: MarketplaceProductRow) => {
    setTogglingId(item.id);
    setAppStatus('saving', 'Removing product…');
    try {
      const { error } = await supabase
        .from('marketplace_products')
        .delete()
        .eq('id', item.id);
      if (error) throw new Error(error.message);

      setProducts((prev) => prev.filter((p) => p.id !== item.id));
      setBanner({ type: 'success', text: `Deleted "${item.title}".` });
      setAppStatus('success', 'Product deleted');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Delete failed.',
      });
      setAppStatus('error', 'Delete failed');
    } finally {
      setTogglingId(null);
    }
  };

  const handleCopyShopLink = async (item: MarketplaceProductRow) => {
    if (typeof window === 'undefined' || !item.listing_id) return;
    const url = `${window.location.origin}/listing/${encodeURIComponent(item.listing_id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShopKey(item.id);
      setAppStatus('success', 'Shop link copied');
      window.setTimeout(() => {
        setCopiedShopKey((curr) => (curr === item.id ? null : curr));
      }, 2000);
    } catch {
      setAppStatus('error', 'Unable to copy link');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div>
          <h2 className="text-sm font-bold text-[var(--ps-text)]">
            {mode === 'owner'
              ? `Marketplace Catalogue (${products.length})`
              : `Delegated Shop Stock (${products.length})`}
          </h2>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            {mode === 'owner'
              ? 'Manage live shop products shown on /marketplace with instant stock controls.'
              : 'Update real-time stock status and pricing on your assigned shop listings.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadProducts()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            aria-label="Refresh products"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {mode === 'owner' && (
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Product</span>
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            <span>{banner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Owner Add/Edit Form */}
      {mode === 'owner' && isFormOpen && (
        <form
          onSubmit={handleSaveProduct}
          className="space-y-3 rounded-2xl border border-[var(--ps-accent)]/40 bg-[var(--ps-surface)] p-4 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ps-accent)]">
              {editingProductId ? 'Edit Product' : 'New Marketplace Product'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setIsFormOpen(false);
                resetForm();
              }}
              className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Linked Shop Listing *
              </label>
              <CustomSelectModal
                placeholder="Select shop listing"
                options={listingOptions}
                value={listingId}
                onChange={setListingId}
                testId="market-product-listing-select"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Category *
              </label>
              <CustomSelectModal
                placeholder="Select category"
                options={MARKET_CATEGORY_OPTIONS}
                value={category}
                onChange={setCategory}
                testId="market-product-category-select"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Product Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Organic Black Rice (Chakhao) 1kg"
                className="h-9 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Price (₹) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="250"
                className="h-9 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs tabular-nums text-[var(--ps-text)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Unit
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="piece, kg, pack, dozen"
                className="h-9 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Short Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Fresh local stock, home delivery available"
                className="h-9 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)]">
                {isUploadingThumb ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                )}
                <span>
                  {thumbnailUrl ? 'Change Thumbnail' : 'Upload Thumbnail'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    void handleUploadThumbnail(e.target.files?.[0] ?? null)
                  }
                />
              </label>

              <button
                type="button"
                onClick={() => setInStock((prev) => !prev)}
                className={`h-8 rounded-lg border px-2.5 text-xs font-semibold ${
                  inStock
                    ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                }`}
              >
                {inStock ? 'In Stock' : 'Out of Stock'}
              </button>
            </div>

            <button
              type="submit"
              disabled={isSaving || isUploadingThumb}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] disabled:opacity-60"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{editingProductId ? 'Update Product' : 'Save Product'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Product List */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-10 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading marketplace items…
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <ShoppingBag className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
            No marketplace products yet
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            {mode === 'owner'
              ? 'Click "Add Product" to publish items from your shop onto /marketplace.'
              : 'No products are linked to your delegated shop listings yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {products.map((item) => {
            const matchedListing = listings.find((l) => l.id === item.listing_id);
            const thumb = item.thumbnail_url
              ? resolveRemoteMediaUrl(item.thumbnail_url)
              : '';
            const priceDraft = editingPriceMap[item.id];
            const busy = togglingId === item.id;

            return (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 shadow-xs"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)]">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Package className="h-5 w-5 text-[var(--ps-text-muted)]" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-[var(--ps-text)]">
                        {item.title}
                      </p>
                      <p className="truncate text-[10px] text-[var(--ps-text-muted)]">
                        {item.category}
                        {matchedListing ? ` • ${matchedListing.title}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-extrabold tabular-nums text-[var(--ps-accent)]">
                      ₹{item.price.toLocaleString('en-IN')}/{item.unit}
                    </span>
                  </div>

                  {/* Quick controls */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleStock(item)}
                      className={`h-7 rounded-md border px-2 text-[10px] font-bold transition-colors ${
                        item.in_stock
                          ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {busy
                        ? 'Saving…'
                        : item.in_stock
                          ? 'In Stock'
                          : 'Out of Stock'}
                    </button>

                    <div className="flex items-center gap-1">
                      {mode === 'staff' && (
                        <>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={
                              priceDraft !== undefined
                                ? priceDraft
                                : String(item.price)
                            }
                            onChange={(e) =>
                              setEditingPriceMap((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            aria-label={`Price for ${item.title}`}
                            className="h-7 w-20 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-[11px] tabular-nums text-[var(--ps-text)]"
                          />
                          {priceDraft !== undefined &&
                            Number(priceDraft) !== item.price && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleQuickPriceSave(item)}
                                className="h-7 rounded-md bg-[var(--ps-accent)] px-2 text-[10px] font-bold text-[var(--ps-accent-fg)]"
                              >
                                Save ₹
                              </button>
                            )}
                        </>
                      )}

                      {mode === 'owner' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditForm(item)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                            aria-label={`Edit ${item.title}`}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteProduct(item)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20"
                            aria-label={`Delete ${item.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quick Share & Market Preview */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--ps-border)]/70 pt-1.5">
                    {item.listing_id && (
                      <button
                        type="button"
                        onClick={() => void handleCopyShopLink(item)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                      >
                        {copiedShopKey === item.id ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>
                          {copiedShopKey === item.id ? 'Copied!' : 'Copy Shop Link'}
                        </span>
                      </button>
                    )}
                    <Link
                      href={`/marketplace?q=${encodeURIComponent(item.title)}`}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[10px] font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Preview in Market</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MarketplaceCatalogueManager;
