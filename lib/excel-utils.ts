import * as XLSX from 'xlsx';
import { createListingCoverSvg } from './media-generator';
import { CHURACHANDPUR_SAMPLE_CENTER, SAMPLE_LOCALITIES } from './seed-data';
import { shouldShowPlotAndBoundary } from './rules';
import {
  CatalogueProduct,
  Listing,
  ListingCategory,
  PropertyType,
} from './types';

export interface ExportColumn<T> {
  key: string;
  header: string;
  getValue: (row: T) => string | number | boolean | undefined;
}

export function exportRowsToXlsx<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string,
  sheetName = 'SampleData'
): void {
  const formatted = rows.map((row) => {
    const obj: Record<string, string | number | boolean> = {};
    columns.forEach((col) => {
      const val = col.getValue(row);
      obj[col.header] = val === undefined || val === null ? '' : val;
    });
    return obj;
  });

  const worksheet = XLSX.utils.json_to_sheet(formatted);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  const cleanName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, cleanName);
}

export function exportRowsToCsv<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename: string
): void {
  const formatted = rows.map((row) => {
    const obj: Record<string, string | number | boolean> = {};
    columns.forEach((col) => {
      const val = col.getValue(row);
      obj[col.header] = val === undefined || val === null ? '' : val;
    });
    return obj;
  });

  const worksheet = XLSX.utils.json_to_sheet(formatted);
  const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ImportValidationResult {
  validListings: Listing[];
  duplicateRows: Array<{ rowNumber: number; title: string; reason: string }>;
  invalidRows: Array<{ rowNumber: number; title: string; reason: string }>;
  draftPanoramaWarnings: number;
}

export async function parseAndValidateListingImportFile(
  file: File,
  existingListings: Listing[],
  ownerId: string,
  ownerName: string
): Promise<ImportValidationResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[firstSheet],
    { defval: '' }
  );

  const validListings: Listing[] = [];
  const duplicateRows: Array<{ rowNumber: number; title: string; reason: string }> = [];
  const invalidRows: Array<{ rowNumber: number; title: string; reason: string }> = [];
  let draftPanoramaWarnings = 0;

  rows.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const title = String(raw['Title'] || raw['title'] || raw['Name'] || '').trim();
    const categoryRaw = String(
      raw['Category'] || raw['category'] || 'business'
    )
      .trim()
      .toLowerCase();
    const locality = String(
      raw['Locality'] || raw['locality'] || SAMPLE_LOCALITIES[0]
    ).trim();
    const latRaw = Number(
      raw['Latitude'] || raw['lat'] || CHURACHANDPUR_SAMPLE_CENTER.lat
    );
    const lngRaw = Number(
      raw['Longitude'] || raw['lng'] || CHURACHANDPUR_SAMPLE_CENTER.lng
    );

    if (!title || title.length < 3) {
      invalidRows.push({
        rowNumber,
        title: title || '(Untitled Row)',
        reason: 'Title is missing or shorter than 3 characters.',
      });
      return;
    }

    const allowedCategories: ListingCategory[] = [
      'business',
      'service',
      'real_estate',
      'sports',
      'public_place',
    ];
    const category: ListingCategory = allowedCategories.includes(
      categoryRaw as ListingCategory
    )
      ? (categoryRaw as ListingCategory)
      : 'business';

    if (!Number.isFinite(latRaw) || !Number.isFinite(lngRaw)) {
      invalidRows.push({
        rowNumber,
        title,
        reason: 'Invalid latitude or longitude coordinates.',
      });
      return;
    }

    const isDuplicate = existingListings.some(
      (ex) => ex.title.toLowerCase() === title.toLowerCase()
    );
    if (isDuplicate) {
      duplicateRows.push({
        rowNumber,
        title,
        reason: 'A sample listing with this exact title already exists.',
      });
      return;
    }

    const id = `imp-${Date.now()}-${idx}`;
    const propertyType = (String(
      raw['PropertyType'] || raw['propertyType'] || 'plot_land'
    ).trim() || 'plot_land') as PropertyType;
    const showPlot = shouldShowPlotAndBoundary(propertyType, true);
    const plotAreaSqm = showPlot
      ? Number(raw['PlotAreaSqm'] || raw['plotAreaSqm'] || 400)
      : undefined;

    if (category === 'real_estate') {
      draftPanoramaWarnings++;
    }

    const listing: Listing = {
      id,
      title,
      category,
      subcategory: String(raw['Subcategory'] || raw['subcategory'] || 'Sample Imported'),
      shortDescription: String(
        raw['Description'] || raw['description'] || `${title} — Imported synthetic listing.`
      ).slice(0, 120),
      description: String(
        raw['Description'] ||
          raw['description'] ||
          `${title} — Imported synthetic record for testing in PrintSwift Local.`
      ),
      locality,
      address: `${locality} (Imported Sample)`,
      coordinates: { lat: latRaw, lng: lngRaw },
      // Real estate without a valid 360° panorama is strictly saved as an incomplete draft
      status: category === 'real_estate' ? 'draft' : 'draft',
      verificationStatus: 'unverified_sample',
      ownerId,
      ownerName,
      assignedStaffIds: [],
      contactPhone: String(raw['Phone'] || '+91 90000 99999'),
      contactEmail: `import.${id}@sample-printswift.local`,
      coverImage: createListingCoverSvg(title, category, locality, idx + 50),
      galleryImages: [],
      rating: 4.0,
      reviewCount: 0,
      viewsCount: 0,
      mapImpressionsCount: 0,
      detailVisitsCount: 0,
      followsCount: 0,
      enquiriesCount: 0,
      directionClicksCount: 0,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      versionHistory: [],
      realEstateDetails:
        category === 'real_estate'
          ? {
              propertyType,
              hasAssociatedPlot: showPlot,
              availability: 'available',
              askingPrice: Number(raw['Price'] || 2500000),
              priceLabel: `₹${Number(raw['Price'] || 2500000).toLocaleString('en-IN')} (Sample)`,
              plotAreaSqm,
              utilities: ['Grid Electricity'],
              amenities: ['Sample Import'],
              panoramas: [], // Imported without panorama -> stays incomplete draft until owner adds 360° panorama
              streetViewAvailable: false,
            }
          : undefined,
      businessDetails:
        category === 'business'
          ? {
              subcategory: String(raw['Subcategory'] || 'Retail'),
              openingHours: '09:00 AM – 06:00 PM',
              priceRange: '₹₹',
              deliveryInfo: 'Sample in-store browsing only',
              establishedYear: 2022,
              highlights: ['Imported Sample'],
              catalogue: [] as CatalogueProduct[],
            }
          : undefined,
    };

    validListings.push(listing);
  });

  return {
    validListings,
    duplicateRows,
    invalidRows,
    draftPanoramaWarnings,
  };
}

export function downloadListingImportTemplate(format: 'xlsx' | 'csv' = 'xlsx'): void {
  const sampleRows = [
    {
      Title: 'Lamka Heritage Craft Store (Sample Import)',
      Category: 'business',
      Subcategory: 'Handloom & Crafts',
      Locality: 'New Lamka, Churachandpur',
      Latitude: 24.3342,
      Longitude: 93.6985,
      Phone: '+91 98620 55501',
      Price: 1200,
      Description: 'Synthetic business import row for demonstration.',
    },
    {
      Title: 'Tuibong Hillside Residential Plot (Sample Import)',
      Category: 'real_estate',
      Subcategory: 'Residential Plot',
      PropertyType: 'plot_land',
      PlotAreaSqm: 420,
      Locality: 'Tuibong, Churachandpur',
      Latitude: 24.3481,
      Longitude: 93.7024,
      Phone: '+91 98620 55502',
      Price: 3200000,
      Description: 'Imported real-estate row (saved as Draft until 360° panorama is added).',
    },
  ];

  const columns: ExportColumn<(typeof sampleRows)[0]>[] = [
    { key: 'Title', header: 'Title', getValue: (r) => r.Title },
    { key: 'Category', header: 'Category', getValue: (r) => r.Category },
    { key: 'Subcategory', header: 'Subcategory', getValue: (r) => r.Subcategory },
    { key: 'PropertyType', header: 'PropertyType', getValue: (r) => r.PropertyType || '' },
    { key: 'PlotAreaSqm', header: 'PlotAreaSqm', getValue: (r) => r.PlotAreaSqm || '' },
    { key: 'Locality', header: 'Locality', getValue: (r) => r.Locality },
    { key: 'Latitude', header: 'Latitude', getValue: (r) => r.Latitude },
    { key: 'Longitude', header: 'Longitude', getValue: (r) => r.Longitude },
    { key: 'Phone', header: 'Phone', getValue: (r) => r.Phone },
    { key: 'Price', header: 'Price', getValue: (r) => r.Price },
    { key: 'Description', header: 'Description', getValue: (r) => r.Description },
  ];

  if (format === 'csv') {
    exportRowsToCsv(sampleRows, columns, 'printswift-listing-import-template.csv');
  } else {
    exportRowsToXlsx(sampleRows, columns, 'printswift-listing-import-template.xlsx', 'ImportTemplate');
  }
}

