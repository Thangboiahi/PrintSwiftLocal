import type { Listing } from '@/lib/types';

export interface ExportableListingRecord extends Partial<Listing> {
  category_id?: string | null;
  short_description?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const CSV_HEADERS = [
  'id',
  'title',
  'category_id',
  'category',
  'subcategory',
  'status',
  'address',
  'locality',
  'latitude',
  'longitude',
  'contact_phone',
  'contact_email',
  'short_description',
  'description',
  'owner_id',
  'owner_name',
  'created_at',
  'updated_at',
] as const;

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (
    str.includes('"') ||
    str.includes(',') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of Supabase listing objects into a standardized CSV string.
 */
export function convertListingsToCsv(
  listings: ExportableListingRecord[]
): string {
  const headerRow = CSV_HEADERS.join(',');

  const dataRows = listings.map((item) => {
    const coords =
      item.coordinates &&
      typeof item.coordinates === 'object' &&
      'lat' in item.coordinates &&
      'lng' in item.coordinates
        ? (item.coordinates as { lat: number; lng: number })
        : null;

    const categoryValue = String(item.category ?? item.category_id ?? 'business');
    const categoryIdValue = String(item.category_id ?? categoryValue);

    const rowValues: Record<(typeof CSV_HEADERS)[number], unknown> = {
      id: item.id ?? '',
      title: item.title ?? '',
      category_id: categoryIdValue,
      category: categoryValue,
      subcategory: item.subcategory ?? 'General',
      status: item.status ?? 'draft',
      address: item.address ?? '',
      locality: item.locality ?? '',
      latitude: coords?.lat ?? item.latitude ?? '',
      longitude: coords?.lng ?? item.longitude ?? '',
      contact_phone: item.contactPhone ?? item.contact_phone ?? '',
      contact_email: item.contactEmail ?? item.contact_email ?? '',
      short_description: item.shortDescription ?? item.short_description ?? '',
      description: item.description ?? '',
      owner_id: item.ownerId ?? item.owner_id ?? '',
      owner_name: item.ownerName ?? item.owner_name ?? '',
      created_at: item.createdAt ?? item.created_at ?? '',
      updated_at: item.updatedAt ?? item.updated_at ?? '',
    };

    return CSV_HEADERS.map((key) => escapeCsvCell(rowValues[key])).join(',');
  });

  return [headerRow, ...dataRows].join('\r\n');
}

/**
 * Converts an array of Supabase listing objects into CSV format and triggers a browser download.
 */
export function exportListingsToCsv(
  listings: ExportableListingRecord[],
  filename = 'ddoodle-listings-export.csv'
): void {
  const csvContent = convertListingsToCsv(listings);

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
