import { CHURACHANDPUR_SAMPLE_CENTER } from '@/lib/seed-data';
import type { Listing, ListingCategory, ListingStatus } from '@/lib/types';

export interface ParsedListingCsvRow {
  id?: string;
  title: string;
  category_id: string;
  category: ListingCategory;
  subcategory: string;
  status: ListingStatus;
  address: string;
  locality: string;
  latitude: number;
  longitude: number;
  contact_phone: string;
  contact_email: string;
  short_description: string;
  description: string;
  owner_id?: string;
  owner_name?: string;
}

export interface CsvImportValidationError {
  rowNumber: number;
  message: string;
}

export interface CsvImportParseResult {
  rows: ParsedListingCsvRow[];
  validListings: Listing[];
  errors: CsvImportValidationError[];
}

/**
 * RFC-4180 compliant CSV string tokenizer supporting quoted cells, escaped quotes, and multiline values.
 */
function tokenizeCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const normalized = csvText.replace(/^\uFEFF/, '');

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const nextCh = normalized[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if (ch === '\r' && nextCh === '\n') {
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell.trim());
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.length > 0));
}

function normalizeCategory(raw: string): ListingCategory {
  const cleaned = raw.trim().toLowerCase().replace(/-/g, '_');
  if (cleaned.includes('real_estate') || cleaned.includes('property')) {
    return 'real_estate';
  }
  if (cleaned.includes('service')) {
    return 'service';
  }
  if (
    cleaned.includes('public_interest') ||
    cleaned.includes('public_place') ||
    cleaned.includes('civic')
  ) {
    return 'public_place';
  }
  if (cleaned.includes('sport')) {
    return 'sports';
  }
  return 'business';
}

function normalizeStatus(raw: string): ListingStatus {
  const cleaned = raw.trim().toLowerCase().replace(/-/g, '_');
  const validStatuses: ListingStatus[] = [
    'draft',
    'submitted',
    'pending_verification',
    'changes_requested',
    'rejected',
    'published',
    'suspended',
    'archived',
    'expired',
  ];
  return validStatuses.includes(cleaned as ListingStatus)
    ? (cleaned as ListingStatus)
    : 'draft';
}

/**
 * Parses raw CSV text into structured JSON objects and validates required fields (`title`, `category_id`, `address`).
 */
export function parseListingsCsvText(
  csvText: string,
  options?: {
    defaultOwnerId?: string;
    defaultOwnerName?: string;
  }
): CsvImportParseResult {
  const rawRows = tokenizeCsvRows(csvText);
  if (rawRows.length < 2) {
    return {
      rows: [],
      validListings: [],
      errors: [
        {
          rowNumber: 1,
          message:
            'CSV file is empty or missing data rows after the header line.',
        },
      ],
    };
  }

  const headers = rawRows[0].map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  );

  const rows: ParsedListingCsvRow[] = [];
  const validListings: Listing[] = [];
  const errors: CsvImportValidationError[] = [];

  for (let i = 1; i < rawRows.length; i++) {
    const rowCells = rawRows[i];
    const rowNumber = i + 1;
    const record: Record<string, string> = {};

    headers.forEach((header, colIdx) => {
      record[header] = (rowCells[colIdx] ?? '').trim();
    });

    const title = record.title || record.name || '';
    const categoryId = record.category_id || '';
    const address = record.address || '';

    const missingFields: string[] = [];
    if (!title) missingFields.push('title');
    if (!categoryId) missingFields.push('category_id');
    if (!address) missingFields.push('address');

    if (missingFields.length > 0) {
      errors.push({
        rowNumber,
        message: `Row ${rowNumber}: Missing required field(s): ${missingFields.join(', ')}.`,
      });
      continue;
    }

    const category = normalizeCategory(record.category || categoryId);
    const subcategory = record.subcategory || 'General';
    const status = normalizeStatus(record.status || 'draft');
    const locality = record.locality || address.split(',')[0]?.trim() || 'New Lamka';

    const parsedLat = Number(record.latitude || record.lat);
    const parsedLng = Number(record.longitude || record.lng);
    const latitude = Number.isFinite(parsedLat) && parsedLat !== 0
      ? parsedLat
      : CHURACHANDPUR_SAMPLE_CENTER.lat;
    const longitude = Number.isFinite(parsedLng) && parsedLng !== 0
      ? parsedLng
      : CHURACHANDPUR_SAMPLE_CENTER.lng;

    const contactPhone =
      record.contact_phone || record.phone || '+91 98620 00000';
    const contactEmail = record.contact_email || record.email || '';
    const description =
      record.description || `${title} located at ${address}.`;
    const shortDescription =
      record.short_description || description.slice(0, 140);

    const ownerId =
      record.owner_id || options?.defaultOwnerId || 'admin-bulk-import';
    const ownerName =
      record.owner_name || options?.defaultOwnerName || 'Administrator';
    const nowIso = new Date().toISOString();
    const id =
      record.id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `csv-${Date.now()}-${i}`);

    const parsedRow: ParsedListingCsvRow = {
      id,
      title,
      category_id: categoryId,
      category,
      subcategory,
      status,
      address,
      locality,
      latitude,
      longitude,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      short_description: shortDescription,
      description,
      owner_id: ownerId,
      owner_name: ownerName,
    };

    const listing: Listing = {
      id,
      title,
      category,
      subcategory,
      status,
      verificationStatus: 'unverified_sample',
      shortDescription,
      description,
      locality,
      address,
      coordinates: { lat: latitude, lng: longitude },
      contactPhone,
      contactEmail,
      coverImage: '',
      galleryImages: [],
      ownerId,
      ownerName,
      assignedStaffIds: [],
      createdAt: nowIso.slice(0, 10),
      updatedAt: nowIso,
      isFeaturedDemo: false,
      rating: 4.5,
      reviewCount: 0,
      viewsCount: 0,
      mapImpressionsCount: 0,
      detailVisitsCount: 0,
      directionClicksCount: 0,
      followsCount: 0,
      enquiriesCount: 0,
      versionHistory: [],
    };

    rows.push(parsedRow);
    validListings.push(listing);
  }

  return {
    rows,
    validListings,
    errors,
  };
}

/**
 * Parses an uploaded CSV File into structured JSON objects and validated Listing records.
 */
export async function parseListingsCsvFile(
  file: File,
  options?: {
    defaultOwnerId?: string;
    defaultOwnerName?: string;
  }
): Promise<CsvImportParseResult> {
  const text = await file.text();
  return parseListingsCsvText(text, options);
}
