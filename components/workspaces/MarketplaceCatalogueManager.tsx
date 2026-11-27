'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  ImagePlus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PayPerCheckoutModal } from '@/components/monetization/PayPerCheckoutModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { FormModal } from '@/components/ui/FormModal';
import { NestedCategoryPicker } from '@/components/ui/NestedCategoryPicker';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { compressImageWithPreset } from '@/lib/media/image-compressor';
import {
  evaluateOwnerQuotaStatus,
  type OwnerQuotaEvaluation,
} from '@/lib/monetization/pay-per';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
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
  category_id?: string | null;
  in_stock: boolean;
  thumbnail_url: string | null;
  is_active: boolean;
  paid_until?: string | null;
  created_at: string;
}

interface CsvImportRow {
  title: string;
  price: number;
  unit: string;
  category: string;
  description: string;
  in_stock: boolean;
}

function parseSimpleCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

export interface MarketplaceCatalogueManagerProps {
  mode: 'owner' | 'staff';
  listings: Listing[];
  /** Owner ID whose effective subscription entitlements apply (especially in Delegated Staff mode) */
  entitlementOwnerId?: string | null;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function MarketplaceCatalogueManager({
  mode,
  listings,
  entitlementOwnerId,
  onNotice,
}: MarketplaceCatalogueManagerProps) {
  const { user: authUser } = useAuth();
  const [products, setProducts] = useState<MarketplaceProductRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedShopKey, setCopiedShopKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'in_stock' | 'out_of_stock' | 'pay_per' | 'archived'
  >('all');
  const [nowMs, setNowMs] = useState<number>(0);

  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Add / Edit Product FormModal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState('piece');
  const [category, setCategory] = useState('General');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [description, setDescription] = useState('');

  // Bulk CSV Import FormModal state
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvListingId, setCsvListingId] = useState('');
  const [csvRows, setCsvRows] = useState<CsvImportRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [inStock, setInStock] = useState(true);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const [initialFormSnapshot, setInitialFormSnapshot] = useState<string>('');
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {}
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Quick staff price edit modal (uses FormModal cleanly)
  const [quickEditItem, setQuickEditItem] =
    useState<MarketplaceProductRow | null>(null);
  const [quickPrice, setQuickPrice] = useState('');
  const [quickInStock, setQuickInStock] = useState(true);
  const [quickTouched, setQuickTouched] = useState(false);
  const [quickSubmitAttempted, setQuickSubmitAttempted] = useState(false);

  // v17c Quota vs. Pay-Per state
  const [quotaEval, setQuotaEval] = useState<OwnerQuotaEvaluation | null>(null);
  const [payPerTarget, setPayPerTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const { confirm, dialog: confirmDialogNode } = useConfirmDialogState();

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
  const effectiveOwnerId = entitlementOwnerId || authUserId;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [products.length]);

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
        .limit(120);

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
        paid_until: typeof row.paid_until === 'string' ? row.paid_until : null,
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
    const timer = window.setTimeout(() => {
      void loadProducts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  // Evaluate Owner's effective entitlements (both Owner and Staff inherit Owner's plan!)
  useEffect(() => {
    if (!effectiveOwnerId) return;
    let active = true;
    const activeCount = products.filter((p) => p.is_active).length;
    void evaluateOwnerQuotaStatus(
      effectiveOwnerId,
      'marketplace_item',
      activeCount
    ).then((res) => {
      if (active) setQuotaEval(res);
    });
    return () => {
      active = false;
    };
  }, [effectiveOwnerId, products]);

  const currentFormSnapshot = useMemo(
    () =>
      JSON.stringify({
        listingId,
        title,
        price,
        unit,
        category,
        description,
        inStock,
        thumbnailUrl,
      }),
    [listingId, title, price, unit, category, description, inStock, thumbnailUrl]
  );

  const isFormDirty =
    isFormOpen && currentFormSnapshot !== initialFormSnapshot;

  const formFieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!listingId) {
      errors.listingId = 'Select a linked shop listing.';
    }
    if (title.trim().length < 2) {
      errors.title = 'Product title must be at least 2 characters.';
    }
    const numPrice = Number(price);
    if (price.trim() === '' || !Number.isFinite(numPrice) || numPrice < 0) {
      errors.price = 'Enter a valid non-negative price (₹).';
    }
    if (!unit.trim()) {
      errors.unit = 'Specify a pricing unit (e.g. piece, kg, pack).';
    }
    return errors;
  }, [listingId, title, price, unit]);

  const validationSummary = useMemo(
    () => Object.values(formFieldErrors),
    [formFieldErrors]
  );

  const openCreateForm = () => {
    const defaultListing = listings[0]?.id || '';
    setEditingProductId(null);
    setListingId(defaultListing);
    setTitle('');
    setPrice('');
    setUnit('piece');
    setCategory('General');
    setCategoryId(null);
    setDescription('');
    setInStock(true);
    setThumbnailUrl('');
    setTouchedFields({});
    setSubmitAttempted(false);
    setInitialFormSnapshot(
      JSON.stringify({
        listingId: defaultListing,
        title: '',
        price: '',
        unit: 'piece',
        category: 'General',
        description: '',
        inStock: true,
        thumbnailUrl: '',
      })
    );
    setIsFormOpen(true);
  };

  const openEditForm = (item: MarketplaceProductRow) => {
    const nextListingId = item.listing_id;
    const nextTitle = item.title;
    const nextPrice = String(item.price);
    const nextUnit = item.unit || 'piece';
    const nextCategory = item.category || 'General';
    const nextDesc = item.description || '';
    const nextStock = item.in_stock;
    const nextThumb = item.thumbnail_url || '';

    setEditingProductId(item.id);
    setListingId(nextListingId);
    setTitle(nextTitle);
    setPrice(nextPrice);
    setUnit(nextUnit);
    setCategory(nextCategory);
    setCategoryId(item.category_id || null);
    setDescription(nextDesc);
    setInStock(nextStock);
    setThumbnailUrl(nextThumb);
    setTouchedFields({});
    setSubmitAttempted(false);
    setInitialFormSnapshot(
      JSON.stringify({
        listingId: nextListingId,
        title: nextTitle,
        price: nextPrice,
        unit: nextUnit,
        category: nextCategory,
        description: nextDesc,
        inStock: nextStock,
        thumbnailUrl: nextThumb,
      })
    );
    setIsFormOpen(true);
  };

  const openStaffQuickEdit = (item: MarketplaceProductRow) => {
    setQuickEditItem(item);
    setQuickPrice(String(item.price));
    setQuickInStock(item.in_stock);
    setQuickTouched(false);
    setQuickSubmitAttempted(false);
  };

  const quickPriceError = useMemo(() => {
    const n = Number(quickPrice);
    if (quickPrice.trim() === '' || !Number.isFinite(n) || n < 0) {
      return 'Enter a valid non-negative price (₹).';
    }
    return null;
  }, [quickPrice]);

  const handleUploadThumbnail = async (file: File | null) => {
    if (!file) return;
    setIsUploadingThumb(true);
    setAppStatus('saving', 'Compressing & uploading product image…');
    try {
      const compressed = await compressImageWithPreset(file, 'gallery');
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('file', compressed.file);
      formData.append('entityType', 'product_image');
      formData.append('retentionClass', 'ephemeral_ttl');
      formData.append('ttlDays', '30');
      if (listingId) {
        formData.append('entityId', listingId);
      }
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers,
        body: formData,
      });
      const json = (await res.json()) as {
        url?: string;
        success?: boolean;
        error?: string;
      };
      if (!res.ok || !json.success || !json.url) {
        throw new Error(json.error || 'Thumbnail upload failed.');
      }
      setThumbnailUrl(json.url);
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

  const handleCsvFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        setCsvRows([]);
        setCsvErrors(['CSV must contain a header row and at least 1 product row.']);
        return;
      }
      const headers = parseSimpleCsvLine(lines[0]).map((h) => h.toLowerCase());
      const titleIdx = headers.findIndex((h) => h === 'title' || h === 'name');
      const priceIdx = headers.findIndex((h) => h === 'price' || h === 'price_inr');
      const unitIdx = headers.findIndex((h) => h === 'unit');
      const catIdx = headers.findIndex((h) => h === 'category');
      const descIdx = headers.findIndex((h) => h === 'description');
      const stockIdx = headers.findIndex((h) => h === 'in_stock' || h === 'stock');

      if (titleIdx === -1 || priceIdx === -1) {
        setCsvRows([]);
        setCsvErrors(['CSV header must include at least "title" and "price" columns.']);
        return;
      }

      const valid: CsvImportRow[] = [];
      const errors: string[] = [];
      for (let r = 1; r < Math.min(lines.length, 202); r += 1) {
        const cols = parseSimpleCsvLine(lines[r]);
        const rowTitle = (cols[titleIdx] || '').trim();
        const rowPrice = Number(cols[priceIdx]);
        if (rowTitle.length < 2) {
          errors.push(`Row ${r + 1}: Title must be at least 2 characters.`);
          continue;
        }
        if (!Number.isFinite(rowPrice) || rowPrice < 0) {
          errors.push(`Row ${r + 1}: Invalid price "${cols[priceIdx] || ''}".`);
          continue;
        }
        const stockRaw = stockIdx >= 0 ? (cols[stockIdx] || '').toLowerCase() : 'true';
        valid.push({
          title: rowTitle,
          price: rowPrice,
          unit: unitIdx >= 0 && cols[unitIdx] ? cols[unitIdx].trim() : 'piece',
          category:
            catIdx >= 0 && cols[catIdx] ? cols[catIdx].trim() : 'General',
          description: descIdx >= 0 ? (cols[descIdx] || '').trim() : '',
          in_stock: stockRaw !== 'false' && stockRaw !== '0' && stockRaw !== 'no',
        });
      }
      setCsvRows(valid);
      setCsvErrors(errors);
    } catch (err) {
      setCsvRows([]);
      setCsvErrors([
        err instanceof Error ? err.message : 'Unable to read CSV file.',
      ]);
    }
  };

  const handleConfirmCsvImport = async () => {
    const targetListing = csvListingId || listings[0]?.id || '';
    if (!targetListing || csvRows.length === 0) return;
    setIsImportingCsv(true);
    setAppStatus('saving', `Importing ${csvRows.length} CSV products…`);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id || authUser?.id;
      if (!uid) throw new Error('Sign in required to import catalogue items.');
      const withinQuota = quotaEval ? quotaEval.hasRemainingQuota : true;
      const rowsPayload = csvRows.map((row) => ({
        listing_id: targetListing,
        owner_id: effectiveOwnerId || uid,
        title: row.title,
        price: row.price,
        unit: row.unit,
        category: row.category,
        description: row.description || null,
        in_stock: row.in_stock,
        is_active: withinQuota,
      }));
      const { error } = await supabase
        .from('marketplace_products')
        .insert(rowsPayload);
      if (error) throw new Error(error.message);

      const msg = `Imported ${csvRows.length} products into your Marketplace catalogue.`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'CSV import complete');
      setIsCsvModalOpen(false);
      setCsvRows([]);
      setCsvErrors([]);
      await loadProducts();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'CSV bulk import failed.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Import failed');
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleSaveProduct = async () => {
    if (validationSummary.length > 0) return;
    const trimmedTitle = title.trim();
    const numericPrice = Number(price);

    setIsSaving(true);
    setAppStatus('saving', 'Saving product…');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id || authUser?.id;
      if (!uid) throw new Error('Sign in required to manage products.');

      if (editingProductId) {
        const updatePayload: Record<string, unknown> = {
          listing_id: listingId,
          title: trimmedTitle,
          price: numericPrice,
          unit: unit.trim() || 'piece',
          category,
          category_id: categoryId || null,
          description: description.trim() || null,
          in_stock: inStock,
          thumbnail_url: thumbnailUrl.trim() || null,
        };
        let { error } = await supabase
          .from('marketplace_products')
          .update(updatePayload)
          .eq('id', editingProductId);
        if (error && /category_id/i.test(error.message || '')) {
          delete updatePayload.category_id;
          const retry = await supabase
            .from('marketplace_products')
            .update(updatePayload)
            .eq('id', editingProductId);
          error = retry.error;
        }
        if (error) throw new Error(error.message);

        const msg = `Updated "${trimmedTitle}".`;
        setBanner({ type: 'success', text: msg });
        onNotice?.({ type: 'success', text: msg });
        setAppStatus('success', 'Product saved');
        setIsFormOpen(false);
        await loadProducts();
      } else {
        const withinQuota = quotaEval ? quotaEval.hasRemainingQuota : true;
        const insertPayload: Record<string, unknown> = {
          listing_id: listingId,
          owner_id: effectiveOwnerId || uid,
          title: trimmedTitle,
          price: numericPrice,
          unit: unit.trim() || 'piece',
          category,
          category_id: categoryId || null,
          description: description.trim() || null,
          in_stock: inStock,
          thumbnail_url: thumbnailUrl.trim() || null,
          is_active: withinQuota,
        };
        let { data: insertedRow, error } = await supabase
          .from('marketplace_products')
          .insert(insertPayload)
          .select('id')
          .single();
        if (error && /category_id/i.test(error.message || '')) {
          delete insertPayload.category_id;
          const retry = await supabase
            .from('marketplace_products')
            .insert(insertPayload)
            .select('id')
            .single();
          insertedRow = retry.data;
          error = retry.error;
        }
        if (error) throw new Error(error.message);

        const insertedId = String((insertedRow as { id?: string })?.id || '');
        setIsFormOpen(false);
        await loadProducts();

        if (!withinQuota && insertedId && mode === 'owner') {
          setPayPerTarget({ id: insertedId, title: trimmedTitle });
          setBanner({
            type: 'success',
            text: `Saved "${trimmedTitle}" draft. Complete Pay-Per checkout below to publish beyond your plan quota.`,
          });
          setAppStatus('success', 'Complete Pay-Per checkout');
        } else {
          const msg = `Added "${trimmedTitle}" to Marketplace (₹0 — Included in ${quotaEval?.planName || 'Active Plan'}).`;
          setBanner({ type: 'success', text: msg });
          onNotice?.({ type: 'success', text: msg });
          setAppStatus('success', 'Product saved');
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save product.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveStaffQuickEdit = async () => {
    if (!quickEditItem || quickPriceError) return;
    setIsSaving(true);
    setAppStatus('saving', 'Updating stock & price…');
    try {
      const nextPrice = Number(quickPrice);
      const { error } = await supabase
        .from('marketplace_products')
        .update({ price: nextPrice, in_stock: quickInStock })
        .eq('id', quickEditItem.id);
      if (error) throw new Error(error.message);

      setProducts((prev) =>
        prev.map((p) =>
          p.id === quickEditItem.id
            ? { ...p, price: nextPrice, in_stock: quickInStock }
            : p
        )
      );
      const msg = `Updated "${quickEditItem.title}" to ₹${nextPrice.toLocaleString('en-IN')} (${quickInStock ? 'In Stock' : 'Out of Stock'}).`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setQuickEditItem(null);
      setAppStatus('success', 'Updated');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update product.',
      });
      setAppStatus('error', 'Update failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStock = async (item: MarketplaceProductRow) => {
    const nextStock = !item.in_stock;
    setTogglingId(item.id);
    setAppStatus('saving', 'Updating stock…');
    try {
      const { error } = await supabase
        .from('marketplace_products')
        .update({ in_stock: nextStock })
        .eq('id', item.id);
      if (error) throw new Error(error.message);

      setProducts((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, in_stock: nextStock } : p))
      );
      setAppStatus(
        'success',
        nextStock ? 'Marked In Stock' : 'Marked Out of Stock'
      );
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

  const handleToggleArchiveProduct = async (item: MarketplaceProductRow) => {
    if (mode !== 'owner') return;
    const nextActive = !item.is_active;
    const accepted = await confirm({
      title: nextActive
        ? `Activate "${item.title}" on Marketplace?`
        : `Archive / Hide "${item.title}" from Marketplace?`,
      description: nextActive
        ? 'Makes this product visible to shoppers on /marketplace again.'
        : 'Temporarily hides this product from public shoppers without deleting its details or price history.',
      confirmLabel: nextActive ? 'Activate Product' : 'Archive Product',
      variant: 'warning',
    });
    if (!accepted) return;

    setTogglingId(item.id);
    try {
      const { error } = await supabase
        .from('marketplace_products')
        .update({ is_active: nextActive })
        .eq('id', item.id);
      if (error) throw new Error(error.message);

      setProducts((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, is_active: nextActive } : p
        )
      );
      setBanner({
        type: 'success',
        text: nextActive
          ? `Activated "${item.title}" on Marketplace.`
          : `Archived "${item.title}" (hidden from public shoppers).`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update visibility.',
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteProduct = async (item: MarketplaceProductRow) => {
    if (mode !== 'owner') return;
    const accepted = await confirm({
      title: `Delete "${item.title}" Permanently?`,
      description:
        'Remove this product permanently from your Marketplace catalogue? This cannot be undone.',
      caution:
        'If you only want to pause sales temporarily, choose Archive or mark Out of Stock instead.',
      confirmLabel: 'Delete Product',
      variant: 'danger',
    });
    if (!accepted) return;

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

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((item) => {
      if (statusFilter === 'in_stock' && !item.in_stock) return false;
      if (statusFilter === 'out_of_stock' && item.in_stock) return false;
      if (statusFilter === 'archived' && item.is_active) return false;
      if (statusFilter === 'pay_per' && !item.paid_until) return false;

      if (q) {
        const listingTitle =
          listings.find((l) => l.id === item.listing_id)?.title || '';
        const hay = `${item.title} ${item.category} ${item.unit} ${listingTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, searchQuery, statusFilter, listings]);

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full overflow-x-clip">
      {/* Header + Quota Banner + Filters */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              {mode === 'owner'
                ? `Marketplace Catalogue (${products.length})`
                : `Delegated Shop Stock (${products.length})`}
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)]">
              {mode === 'owner'
                ? 'Manage live shop products on /marketplace with quota tracking, Pay-Per soft-expiry renewals, and instant stock controls.'
                : 'Update stock availability and prices on your assigned listings using the Business Owner’s active subscription.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quotaEval && (
              <span
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1 text-[11px] font-bold ${
                  quotaEval.hasRemainingQuota
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}
              >
                {quotaEval.hasRemainingQuota ? (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      Included in {mode === 'staff' ? "Owner's " : 'your '}
                      {quotaEval.planName} (
                      {quotaEval.remainingCount === null
                        ? 'Unlimited'
                        : `${quotaEval.remainingCount} remaining`}
                      )
                    </span>
                  </>
                ) : (
                  <>
                    <Ticket className="h-3.5 w-3.5" />
                    <span>
                      Quota Reached ({quotaEval.usedCount}/
                      {quotaEval.maxLimit ?? 0}) · Pay-Per Publish Available
                    </span>
                  </>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadProducts()}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              aria-label="Refresh products"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {mode === 'owner' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCsvListingId(listings[0]?.id || '');
                    setCsvRows([]);
                    setCsvErrors([]);
                    setIsCsvModalOpen(true);
                  }}
                  data-testid="marketplace-bulk-csv-btn"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                >
                  <Upload className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Bulk CSV</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateForm}
                  data-testid="marketplace-add-product-btn"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>
                    {quotaEval && !quotaEval.hasRemainingQuota
                      ? 'Add via Pay-Per Pass'
                      : 'Add Product'}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Search + Horizontal Filter Pills */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by title, category, unit, or shop..."
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-4 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'in_stock', label: 'In Stock' },
                { id: 'out_of_stock', label: 'Out of Stock' },
                { id: 'pay_per', label: 'Pay-Per' },
                { id: 'archived', label: 'Archived' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatusFilter(pill.id)}
                className={`inline-flex shrink-0 min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  statusFilter === pill.id
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Product Grid with .dd-shimmer skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy="true">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
            >
              <div className="h-14 w-14 shrink-0 rounded-xl dd-shimmer" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded dd-shimmer" />
                <div className="h-3 w-1/2 rounded dd-shimmer" />
                <div className="flex gap-2 pt-1">
                  <div className="h-8 w-20 rounded-lg dd-shimmer" />
                  <div className="h-8 w-24 rounded-lg dd-shimmer" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <ShoppingBag className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
            {products.length === 0
              ? 'No marketplace products yet'
              : 'No products match this filter'}
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            {mode === 'owner'
              ? 'Click "Add Product" to publish items from your shop onto /marketplace.'
              : 'No products are linked to your delegated shop listings yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredProducts.map((item) => {
            const matchedListing = listings.find(
              (l) => l.id === item.listing_id
            );
            const thumb = item.thumbnail_url
              ? resolveRemoteMediaUrl(item.thumbnail_url)
              : '';
            const busy = togglingId === item.id;
            const paidUntilMs = item.paid_until
              ? Date.parse(item.paid_until)
              : NaN;
            const hasPaidUntil = Number.isFinite(paidUntilMs);
            const isExpired = hasPaidUntil && nowMs > 0 && paidUntilMs <= nowMs;
            const isExpiringSoon =
              hasPaidUntil &&
              nowMs > 0 &&
              paidUntilMs > nowMs &&
              paidUntilMs - nowMs <= 7 * 86400 * 1000;

            return (
              <div
                key={item.id}
                data-testid={`marketplace-product-card-${item.id}`}
                className="flex items-start gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 shadow-xs"
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
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

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[var(--ps-text)]">
                        {item.title}
                      </p>
                      <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                        {item.category}
                        {matchedListing ? ` • ${matchedListing.title}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-extrabold tabular-nums text-[var(--ps-accent)]">
                      ₹{item.price.toLocaleString('en-IN')}/{item.unit}
                    </span>
                  </div>

                  {/* Status & Pay-Per Badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!item.is_active && (
                      <span className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
                        Archived / Hidden
                      </span>
                    )}
                    {hasPaidUntil && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          isExpired
                            ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                            : isExpiringSoon
                              ? 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                              : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        <span>
                          {isExpired
                            ? 'Expired — Hidden Publicly'
                            : `Active until ${formatShortDate(item.paid_until)}`}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Quick controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleStock(item)}
                      className={`min-h-[38px] rounded-xl border px-3 text-[11px] font-bold transition-colors cursor-pointer ${
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

                    <div className="flex flex-wrap items-center gap-1.5">
                      {mode === 'staff' ? (
                        <button
                          type="button"
                          onClick={() => openStaffQuickEdit(item)}
                          className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit Price / Stock</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditForm(item)}
                            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                            aria-label={`Edit ${item.title}`}
                            title="Edit Product"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleToggleArchiveProduct(item)
                            }
                            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                            aria-label={
                              item.is_active
                                ? `Archive ${item.title}`
                                : `Activate ${item.title}`
                            }
                            title={
                              item.is_active
                                ? 'Archive Product'
                                : 'Activate Product'
                            }
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteProduct(item)}
                            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                            aria-label={`Delete ${item.title}`}
                            title="Delete Product"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quick Share, Renew Pay-Per & Market Preview */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--ps-border)]/70 pt-2">
                    {item.listing_id && (
                      <button
                        type="button"
                        onClick={() => void handleCopyShopLink(item)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                      >
                        {copiedShopKey === item.id ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>
                          {copiedShopKey === item.id ? 'Copied!' : 'Shop Link'}
                        </span>
                      </button>
                    )}
                    {mode === 'owner' && (
                      <button
                        type="button"
                        onClick={() =>
                          setPayPerTarget({ id: item.id, title: item.title })
                        }
                        className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-bold cursor-pointer ${
                          isExpired || isExpiringSoon
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                            : 'border-[var(--ps-accent)]/40 bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]'
                        }`}
                      >
                        <Ticket className="h-3 w-3" />
                        <span>
                          {isExpired || isExpiringSoon
                            ? 'Renew Pay-Per'
                            : item.is_active
                              ? 'Pay-Per Boost'
                              : 'Activate Pass'}
                        </span>
                      </button>
                    )}
                    <Link
                      href={`/marketplace?q=${encodeURIComponent(item.title)}`}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>Preview</span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Owner Add / Edit Product FormModal */}
      <FormModal
        isOpen={mode === 'owner' && isFormOpen}
        title={
          editingProductId
            ? 'Edit Marketplace Product'
            : 'Add Marketplace Product'
        }
        subtitle={
          quotaEval
            ? quotaEval.hasRemainingQuota
              ? `Included in your ${quotaEval.planName} (${quotaEval.remainingCount === null ? 'Unlimited' : `${quotaEval.remainingCount} remaining`})`
              : `Plan quota reached (${quotaEval.usedCount}/${quotaEval.maxLimit ?? 0}) — Saves draft and opens Pay-Per Publish checkout.`
            : undefined
        }
        hints={[
          'Clear product photos and accurate unit pricing (piece, kg, pack) increase direct enquiries.',
        ]}
        cautions={
          !editingProductId && quotaEval && !quotaEval.hasRemainingQuota
            ? [
                'Your active plan quota is full. Saving this product will open Pay-Per Publish checkout to activate it on /marketplace.',
              ]
            : undefined
        }
        isDirty={isFormDirty}
        isValid={validationSummary.length === 0}
        validationSummary={submitAttempted ? validationSummary : []}
        onSubmitAttempt={() => {
          setSubmitAttempted(true);
          setTouchedFields({
            listingId: true,
            title: true,
            price: true,
            unit: true,
          });
        }}
        submitLabel={
          editingProductId
            ? 'Update Product'
            : quotaEval && !quotaEval.hasRemainingQuota
              ? 'Save & Continue to Pay-Per'
              : 'Save Product'
        }
        confirmSubmitTitle={
          editingProductId
            ? 'Update Marketplace Product?'
            : 'Publish Marketplace Product?'
        }
        confirmSubmitDescription={
          editingProductId
            ? `Save updated pricing and details for "${title.trim() || 'product'}".`
            : `Add "${title.trim() || 'product'}" to your Marketplace catalogue.`
        }
        confirmSubmitImpact={[
          `Price: ₹${Number(price || 0).toLocaleString('en-IN')} / ${unit || 'piece'}`,
          `Stock: ${inStock ? 'In Stock' : 'Out of Stock'}`,
        ]}
        isSubmitting={isSaving || isUploadingThumb}
        onSubmit={handleSaveProduct}
        onClose={() => setIsFormOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
                Linked Shop Listing *
              </label>
              <CustomSelectModal
                placeholder="Select shop listing"
                options={listingOptions}
                value={listingId}
                onChange={(val) => {
                  setListingId(val);
                  setTouchedFields((prev) => ({ ...prev, listingId: true }));
                }}
                testId="market-product-listing-select"
              />
              {(touchedFields.listingId || submitAttempted) &&
                formFieldErrors.listingId && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    {formFieldErrors.listingId}
                  </p>
                )}
            </div>

            <div>
              <NestedCategoryPicker
                label="Category (3-Level Taxonomy) *"
                entityType="product"
                value={categoryId}
                customTag={category}
                allowSuggestion
                hubId={
                  (
                    listings.find((l) => l.id === listingId) as unknown as
                      | { hub_id?: string; hubId?: string }
                      | undefined
                  )?.hub_id ||
                  (
                    listings.find((l) => l.id === listingId) as unknown as
                      | { hub_id?: string; hubId?: string }
                      | undefined
                  )?.hubId ||
                  null
                }
                linkedEntityId={listingId || null}
                onChange={(sel) => {
                  setCategoryId(sel.categoryId || null);
                  setCategory(sel.categoryName || 'General');
                }}
                testId="market-product-category-select"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
                Product Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTouchedFields((prev) => ({ ...prev, title: true }));
                }}
                onBlur={() =>
                  setTouchedFields((prev) => ({ ...prev, title: true }))
                }
                placeholder="e.g. Organic Black Rice (Chakhao) 1kg"
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {(touchedFields.title || submitAttempted) &&
                formFieldErrors.title && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    {formFieldErrors.title}
                  </p>
                )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
                Price (₹) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setTouchedFields((prev) => ({ ...prev, price: true }));
                }}
                onBlur={() =>
                  setTouchedFields((prev) => ({ ...prev, price: true }))
                }
                placeholder="250"
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs tabular-nums text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {(touchedFields.price || submitAttempted) &&
                formFieldErrors.price && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    {formFieldErrors.price}
                  </p>
                )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
                Unit *
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value);
                  setTouchedFields((prev) => ({ ...prev, unit: true }));
                }}
                onBlur={() =>
                  setTouchedFields((prev) => ({ ...prev, unit: true }))
                }
                placeholder="piece, kg, pack, dozen"
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {(touchedFields.unit || submitAttempted) &&
                formFieldErrors.unit && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    {formFieldErrors.unit}
                  </p>
                )}
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
                Short Description
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Fresh local stock, home delivery available"
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)]">
              <ImagePlus className="h-4 w-4 text-[var(--ps-accent)]" />
              <span>
                {isUploadingThumb
                  ? 'Uploading…'
                  : thumbnailUrl
                    ? 'Change Thumbnail'
                    : 'Upload Thumbnail'}
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
              className={`min-h-[44px] rounded-xl border px-3.5 text-xs font-bold cursor-pointer ${
                inStock
                  ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
              }`}
            >
              {inStock ? 'Status: In Stock' : 'Status: Out of Stock'}
            </button>
          </div>
        </div>
      </FormModal>

      {/* Delegated Staff Quick Price & Stock FormModal */}
      <FormModal
        isOpen={mode === 'staff' && Boolean(quickEditItem)}
        title={
          quickEditItem
            ? `Update Stock & Price — ${quickEditItem.title}`
            : 'Update Product'
        }
        subtitle="Delegated Staff operational edit (inherits Business Owner's active subscription)."
        isDirty={
          Boolean(quickEditItem) &&
          (quickPrice !== String(quickEditItem?.price ?? '') ||
            quickInStock !== Boolean(quickEditItem?.in_stock))
        }
        isValid={!quickPriceError}
        validationSummary={
          quickSubmitAttempted && quickPriceError ? [quickPriceError] : []
        }
        onSubmitAttempt={() => {
          setQuickTouched(true);
          setQuickSubmitAttempted(true);
        }}
        submitLabel="Save Price & Stock"
        confirmSubmitTitle="Update Shop Stock & Price?"
        confirmSubmitDescription="Changes will appear immediately to shoppers on /marketplace."
        isSubmitting={isSaving}
        onSubmit={handleSaveStaffQuickEdit}
        onClose={() => setQuickEditItem(null)}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
              Price (₹) *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={quickPrice}
              onChange={(e) => {
                setQuickPrice(e.target.value);
                setQuickTouched(true);
              }}
              onBlur={() => setQuickTouched(true)}
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs tabular-nums text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            />
            {(quickTouched || quickSubmitAttempted) && quickPriceError && (
              <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {quickPriceError}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setQuickInStock((prev) => !prev)}
            className={`min-h-[44px] rounded-xl border px-4 text-xs font-bold cursor-pointer ${
              quickInStock
                ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
            }`}
          >
            {quickInStock ? 'Status: In Stock' : 'Status: Out of Stock'}
          </button>
        </div>
      </FormModal>

      {mode === 'owner' && payPerTarget ? (
        <PayPerCheckoutModal
          open={Boolean(payPerTarget)}
          onClose={() => setPayPerTarget(null)}
          moduleKey="marketplace_item"
          targetTable="marketplace_products"
          targetId={payPerTarget.id}
          targetTitle={payPerTarget.title}
          onSuccess={(payload) => {
            const msg = `Submitted ₹${payload.amountInr} Pay-Per pass (${payload.durationDays} days) for "${payPerTarget.title}". Pending Superadmin verification.`;
            setBanner({ type: 'success', text: msg });
            onNotice?.({ type: 'success', text: msg });
            setPayPerTarget(null);
            void loadProducts();
          }}
        />
      ) : null}

      {/* Owner Bulk CSV Import FormModal */}
      <FormModal
        isOpen={isCsvModalOpen}
        onClose={() => {
          if (!isImportingCsv) setIsCsvModalOpen(false);
        }}
        title="Bulk Import Products via CSV"
        subtitle="Upload a CSV file (columns: title, price, unit, category, description, in_stock) to add items to a shop."
        isDirty={csvRows.length > 0}
        isValid={Boolean(csvListingId && csvRows.length > 0)}
        isSubmitting={isImportingCsv}
        submitLabel={`Import ${csvRows.length} Product${csvRows.length === 1 ? '' : 's'}`}
        confirmSubmitTitle="Import CSV Products?"
        confirmSubmitDescription={`Insert ${csvRows.length} product(s) into the selected shop catalogue?`}
        onSubmit={() => void handleConfirmCsvImport()}
      >
        <div className="space-y-4">
          <CustomSelectModal
            label="Target Shop Listing *"
            options={listingOptions}
            value={csvListingId}
            onChange={setCsvListingId}
            placeholder="Choose a shop listing"
          />
          <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-center space-y-2">
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Header format:{' '}
              <code className="font-mono text-[var(--ps-text)]">
                title,price,unit,category,description,in_stock
              </code>
            </p>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)]">
              <Upload className="h-4 w-4" />
              <span>Choose .csv File</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void handleCsvFileSelected(e)}
              />
            </label>
          </div>
          {(csvRows.length > 0 || csvErrors.length > 0) && (
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs space-y-1.5">
              <p className="font-bold text-emerald-600 dark:text-emerald-400">
                {csvRows.length} valid product row(s) ready to import.
              </p>
              {csvErrors.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-rose-600 dark:text-rose-400">
                  {csvErrors.slice(0, 5).map((errMsg, idx) => (
                    <li key={idx}>• {errMsg}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </FormModal>

      {confirmDialogNode}
    </div>
  );
}

export default MarketplaceCatalogueManager;
