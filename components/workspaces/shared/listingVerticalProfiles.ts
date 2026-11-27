import type {
  CivicDepartmentType,
  CivicDocumentChecklist,
  CivicHelpline,
  ListingVertical,
  VerticalSummary,
} from '@/lib/verticals/types';
import type {
  PattaStatus,
  RealEstateAvailabilityStatus,
  RealEstateContactRevealPolicy,
  RealEstateDealType,
  RealEstateFurnishing,
  RealEstateListedByRole,
  RealEstatePricePeriod,
  RealEstatePropertyType,
  RoadAccessType,
  WaterSupplyType,
} from '@/lib/real-estate/types';
import type { BookingUnit, HotelStayType } from '@/lib/bookings/types';
import {
  convertAreaToSqft,
  convertSqftToUnit,
  type PayPerAreaUnit,
} from '@/lib/monetization/pay-per';
import type { PrintTurnaroundBadge } from '@/lib/print-orders/types';
import type { supabase as supabaseClient } from '@/lib/supabase/client';
import type { LatLngPoint, Listing, ListingCategory } from '@/lib/types';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export function toClosedGeoJsonPolygon(
  points: LatLngPoint[] | null | undefined
): GeoJsonPolygon | null {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring = points
    .filter(
      (pt) =>
        pt &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng)
    )
    .map((pt) => [pt.lng, pt.lat]);
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

export function parseBoundaryGeoJsonToPoints(raw: unknown): LatLngPoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (pt): pt is LatLngPoint =>
          Boolean(pt) &&
          typeof (pt as LatLngPoint).lat === 'number' &&
          typeof (pt as LatLngPoint).lng === 'number'
      )
      .map((pt) => ({ lat: pt.lat, lng: pt.lng }));
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'coordinates' in raw &&
    Array.isArray((raw as { coordinates?: unknown }).coordinates)
  ) {
    const outer = (raw as { coordinates: unknown[] }).coordinates[0];
    if (!Array.isArray(outer)) return [];
    const pts = outer
      .filter((pt): pt is number[] => Array.isArray(pt) && pt.length >= 2)
      .map((pt) => ({ lat: Number(pt[1]), lng: Number(pt[0]) }))
      .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
    if (
      pts.length >= 4 &&
      pts[0].lat === pts[pts.length - 1].lat &&
      pts[0].lng === pts[pts.length - 1].lng
    ) {
      return pts.slice(0, -1);
    }
    return pts;
  }
  return [];
}

function mergePaymentPolicyPreservingVerification(
  existingPolicyRaw: unknown,
  nextFields: Record<string, unknown>,
  nextUpiRaw: string
): Record<string, unknown> {
  const prev =
    existingPolicyRaw && typeof existingPolicyRaw === 'object'
      ? (existingPolicyRaw as Record<string, unknown>)
      : {};
  const prevUpi = String(prev.shop_upi_id || '').trim();
  const nextUpi = nextUpiRaw.trim();
  const upiChanged = prevUpi !== nextUpi;
  return {
    ...prev,
    ...nextFields,
    shop_upi_id: nextUpi || null,
    shop_upi_name: upiChanged ? null : (prev.shop_upi_name ?? null),
    shop_upi_verified: upiChanged
      ? false
      : Boolean(prev.shop_upi_verified),
  };
}

export interface PrintFormState {
  isAcceptingOrders: boolean;
  isOfficialPrintswift: boolean;
  turnaroundBadge: PrintTurnaroundBadge;
  expressEtaMins: number;
  supportsPickNDrop: boolean;
  pickupInstructions: string;
  maxFileSizeMb: number;
  bwA4SingleInr: number;
  bwA4DuplexInr: number;
  colorA4SingleInr: number;
  colorA4DuplexInr: number;
  spiralBindingInr: number;
  laminationPerSheetInr: number;
  capabilities: {
    bw_a4: boolean;
    color_a4: boolean;
    duplex: boolean;
    a3_large: boolean;
    spiral_binding: boolean;
    lamination: boolean;
    custom_digital_jobs: boolean;
    sealed_envelope: boolean;
  };
  shopUpiId: string;
  allowDirectPay: boolean;
  allowEscrow: boolean;
}

export interface BookingResourceFormState {
  existingResourceId?: string | null;
  name: string;
  description: string;
  bookingUnit: BookingUnit;
  slotDurationMins: number;
  openHour: number;
  closeHour: number;
  totalUnits: number;
  maxGuests: number;
  baseRateInr: number;
  advancePercent: number;
  isActive: boolean;
}

export interface HotelFormState {
  stayType: HotelStayType;
  checkInTime: string;
  checkOutTime: string;
  isAcceptingBookings: boolean;
  houseRules: string;
  cancellationPolicy: string;
  idRequirementNote: string;
  amenities: {
    wifi: boolean;
    parking: boolean;
    hot_water: boolean;
    power_backup: boolean;
    ac: boolean;
    heater: boolean;
    in_house_kitchen: boolean;
    early_checkin: boolean;
  };
  shopUpiId: string;
  starterRoomName: string;
  starterNightlyRateInr: number;
  starterTotalRooms: number;
  starterMaxGuests: number;
  existingRoomId?: string | null;
}

export interface ShopFormState {
  isAcceptingOrders: boolean;
  allowCounterPickup: boolean;
  allowPickNDrop: boolean;
  minOrderInr: number;
  packagingFeeInr: number;
  prepTimeMins: number;
  pickupInstructions: string;
  shopUpiId: string;
  allowDirectPay: boolean;
  allowEscrow: boolean;
}

export interface RestaurantFormState {
  cuisinesText: string;
  isPureVeg: boolean;
  isKitchenOpen: boolean;
  prepTimeMins: number;
  avgCostForTwoInr: number;
  allowTakeaway: boolean;
  allowPickNDrop: boolean;
  allowTableBooking: boolean;
  maxTablePartySize: number;
  minOrderInr: number;
  packagingFeeInr: number;
  fssaiLicenseNo: string;
  pickupInstructions: string;
  shopUpiId: string;
  allowDirectPay: boolean;
  allowEscrow: boolean;
}

export interface RealEstateFormState {
  dealType: RealEstateDealType;
  propertyType: RealEstatePropertyType;
  priceInr: number;
  pricePeriod: RealEstatePricePeriod;
  depositInr: number;
  isNegotiable: boolean;
  areaSqft: number;
  areaUnit: PayPerAreaUnit;
  areaValue: number;
  plotAreaSqm: number;
  landAreaText: string;
  bedrooms: number;
  bathrooms: number;
  furnishing: RealEstateFurnishing;
  pattaStatus: PattaStatus;
  waterSupply: WaterSupplyType;
  roadAccess: RoadAccessType;
  powerBackup: boolean;
  parkingAvailable: boolean;
  listedByRole: RealEstateListedByRole;
  showExactPin: boolean;
  contactRevealPolicy: RealEstateContactRevealPolicy;
  availabilityStatus: RealEstateAvailabilityStatus;
  boundaryPolygon: LatLngPoint[];
}

export interface CivicFormState {
  departmentType: CivicDepartmentType;
  is24x7: boolean;
  officeHoursText: string;
  importantNotes: string;
  officialWebsite: string;
  showNearbyPrintHelper: boolean;
  helplines: CivicHelpline[];
  documentChecklists: CivicDocumentChecklist[];
}

export interface GeneralFormState {
  priceRange: '₹' | '₹₹' | '₹₹₹';
  deliveryInfo: string;
  highlightsText: string;
  serviceAreasText: string;
  startingPriceInr: number;
  experienceYears: number;
}

export interface VerticalFormBundle {
  print: PrintFormState;
  booking: BookingResourceFormState;
  hotel: HotelFormState;
  shop: ShopFormState;
  restaurant: RestaurantFormState;
  realEstate: RealEstateFormState;
  civic: CivicFormState;
  general: GeneralFormState;
}

export const VERTICAL_OPTIONS: Array<{
  value: ListingVertical;
  label: string;
  description: string;
}> = [
  {
    value: 'general',
    label: 'General Store / Local Service',
    description: 'Standard business, repair, coaching, clinic, or local service listing',
  },
  {
    value: 'print_digital',
    label: 'Print & Digital Hub',
    description: 'Document printing, scanning, binding, lamination & Pick N Drop jobs',
  },
  {
    value: 'shop_catalogue',
    label: 'Shop & Retail Catalogue',
    description: 'Multi-item catalogue with online cart, UPI/escrow & counter/rider handover',
  },
  {
    value: 'restaurant_food',
    label: 'Restaurant, Café & Bakery',
    description: 'Food menu with veg/non-veg filters, takeaway, Pick N Drop & table requests',
  },
  {
    value: 'booking_venue',
    label: 'Turf, Hall & Slot Booking Venue',
    description: 'Bookable grounds, turfs, auditoriums, conference halls, or hourly courts',
  },
  {
    value: 'hotel_stay',
    label: 'Hotel, Homestay & Lodge',
    description: 'Nightly stays, guest houses, homestays, check-in rules & room inventory',
  },
  {
    value: 'real_estate',
    label: 'Real Estate & Plots',
    description: 'Land plots, houses, apartments, commercial shops & PG rentals with plot polygon',
  },
  {
    value: 'public_civic',
    label: 'Public & Government Civic Service',
    description: 'Admin/Hub-Manager only — emergency, civic office, helplines & document checklists',
  },
];

export function verticalToLegacyCategory(vertical: ListingVertical): ListingCategory {
  if (vertical === 'real_estate') return 'real_estate';
  if (vertical === 'public_civic') return 'public_place';
  if (vertical === 'booking_venue') return 'sports';
  return 'business';
}

export function createInitialVerticalBundle(
  listing?: Partial<Listing> | null
): VerticalFormBundle {
  const bd = listing?.businessDetails;
  const re = listing?.realEstateDetails;
  const pp = listing?.publicPlaceDetails;
  const sp = listing?.sportsDetails;
  const sd = listing?.serviceDetails;

  const mapUiPropertyType = (raw?: string): RealEstatePropertyType => {
    const t = (raw || '').toLowerCase();
    if (t.includes('house') || t.includes('villa')) return 'house';
    if (t.includes('flat') || t.includes('apartment')) return 'apartment';
    if (t.includes('commercial') || t.includes('shop')) return 'commercial_shop';
    if (t.includes('room') || t.includes('pg') || t.includes('hostel'))
      return 'room_pg';
    return 'plot_land';
  };

  return {
    print: {
      isAcceptingOrders: true,
      isOfficialPrintswift: Boolean(listing?.vertical_summary?.is_official_printswift || listing?.vertical_summary?.is_first_party_printswift),
      turnaroundBadge: 'same_day',
      expressEtaMins: 30,
      supportsPickNDrop: true,
      pickupInstructions: 'Show order code at counter.',
      maxFileSizeMb: 25,
      bwA4SingleInr: 3,
      bwA4DuplexInr: 5,
      colorA4SingleInr: 12,
      colorA4DuplexInr: 22,
      spiralBindingInr: 35,
      laminationPerSheetInr: 20,
      capabilities: {
        bw_a4: true,
        color_a4: true,
        duplex: true,
        a3_large: false,
        spiral_binding: true,
        lamination: true,
        custom_digital_jobs: false,
        sealed_envelope: true,
      },
      shopUpiId: '',
      allowDirectPay: true,
      allowEscrow: true,
    },
    booking: {
      existingResourceId: null,
      name: sp?.sportActivity ? `${listing?.title || 'Main'} Court` : 'Main Turf / Hall',
      description: '',
      bookingUnit: 'hourly',
      slotDurationMins: 60,
      openHour: 6,
      closeHour: 22,
      totalUnits: 1,
      maxGuests: sp?.capacity || 14,
      baseRateInr: 600,
      advancePercent: 30,
      isActive: true,
    },
    hotel: {
      stayType: 'homestay',
      checkInTime: '12:00 PM',
      checkOutTime: '11:00 AM',
      isAcceptingBookings: true,
      houseRules: 'Valid Govt ID required at check-in.',
      cancellationPolicy: 'Free cancellation up to 24 hours before check-in.',
      idRequirementNote: 'Aadhaar, Voter ID, Driving License, or Passport.',
      amenities: {
        wifi: true,
        parking: true,
        hot_water: true,
        power_backup: true,
        ac: false,
        heater: false,
        in_house_kitchen: false,
        early_checkin: false,
      },
      shopUpiId: '',
      starterRoomName: 'Standard Room',
      starterNightlyRateInr: 1800,
      starterTotalRooms: 3,
      starterMaxGuests: 2,
      existingRoomId: null,
    },
    shop: {
      isAcceptingOrders: true,
      allowCounterPickup: true,
      allowPickNDrop: true,
      minOrderInr: 100,
      packagingFeeInr: 10,
      prepTimeMins: 20,
      pickupInstructions: 'Counter pickup inside store entrance.',
      shopUpiId: '',
      allowDirectPay: true,
      allowEscrow: true,
    },
    restaurant: {
      cuisinesText: bd?.subcategory || 'Local Cuisine, Café',
      isPureVeg: false,
      isKitchenOpen: true,
      prepTimeMins: 25,
      avgCostForTwoInr: 400,
      allowTakeaway: true,
      allowPickNDrop: true,
      allowTableBooking: false,
      maxTablePartySize: 8,
      minOrderInr: 150,
      packagingFeeInr: 15,
      fssaiLicenseNo: '',
      pickupInstructions: 'Takeaway counter near billing desk.',
      shopUpiId: '',
      allowDirectPay: true,
      allowEscrow: true,
    },
    realEstate: {
      dealType: re?.availability === 'rented' ? 'rent' : 'sale',
      propertyType: mapUiPropertyType(re?.propertyType),
      priceInr: re?.askingPrice || 0,
      pricePeriod: re?.availability === 'rented' ? 'monthly' : 'total',
      depositInr: 0,
      isNegotiable: true,
      areaSqft: re?.plotAreaSqm ? Math.round(re.plotAreaSqm * 10.7639) : re?.builtUpAreaSqm ? Math.round(re.builtUpAreaSqm * 10.7639) : 0,
      areaUnit: 'sqft',
      areaValue: re?.plotAreaSqm ? Math.round(re.plotAreaSqm * 10.7639) : re?.builtUpAreaSqm ? Math.round(re.builtUpAreaSqm * 10.7639) : 0,
      plotAreaSqm: re?.plotAreaSqm || 0,
      landAreaText: re?.dimensionsText || '',
      bedrooms: re?.bedrooms || 0,
      bathrooms: re?.bathrooms || 0,
      furnishing:
        re?.furnishingStatus === 'Fully Furnished'
          ? 'furnished'
          : re?.furnishingStatus === 'Semi-Furnished'
          ? 'semi_furnished'
          : 'unfurnished',
      pattaStatus: 'verified_patta',
      waterSupply: '24x7',
      roadAccess: 'car_accessible',
      powerBackup: false,
      parkingAvailable: Boolean(re?.parking),
      listedByRole: 'owner',
      showExactPin: true,
      contactRevealPolicy: 'direct_call',
      availabilityStatus: 'available',
      boundaryPolygon: Array.isArray(re?.boundaryPolygon) ? re.boundaryPolygon : [],
    },
    civic: {
      departmentType: 'government_office',
      is24x7: false,
      officeHoursText: pp?.openingHours || 'Mon–Fri 9:30 AM – 4:30 PM',
      importantNotes: pp?.publicInfo || '',
      officialWebsite: '',
      showNearbyPrintHelper: true,
      helplines: listing?.contactPhone
        ? [{ label: 'Primary Desk', phone: listing.contactPhone, is_emergency: false }]
        : [],
      documentChecklists: [],
    },
    general: {
      priceRange: bd?.priceRange || '₹₹',
      deliveryInfo: bd?.deliveryInfo || 'Counter Pickup / Local Delivery',
      highlightsText: (bd?.highlights || []).join(', '),
      serviceAreasText: (sd?.areasServed || []).join(', '),
      startingPriceInr: sd?.startingPrice || 0,
      experienceYears: sd?.experienceYears || 2,
    },
  };
}

export async function hydrateVerticalProfileFromSupabase(
  supabase: typeof supabaseClient,
  listingId: string,
  vertical: ListingVertical,
  baseBundle: VerticalFormBundle
): Promise<VerticalFormBundle> {
  const next: VerticalFormBundle = structuredClone(baseBundle);
  try {
    if (vertical === 'print_digital') {
      const { data } = await supabase
        .from('listing_print_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();
      if (data) {
        const cap = (data.capabilities || {}) as Record<string, unknown>;
        const rate = (data.rate_card || {}) as Record<string, unknown>;
        const pay = (data.payment_policy || {}) as Record<string, unknown>;
        next.print = {
          isAcceptingOrders: data.is_accepting_orders ?? true,
          isOfficialPrintswift: Boolean(data.is_official_printswift || data.is_first_party_printswift),
          turnaroundBadge: (data.turnaround_badge as PrintTurnaroundBadge) || 'same_day',
          expressEtaMins: Number(data.express_eta_mins || 30),
          supportsPickNDrop: data.supports_pick_n_drop ?? true,
          pickupInstructions: String(data.pickup_instructions || ''),
          maxFileSizeMb: Number(data.max_file_size_mb || 25),
          bwA4SingleInr: Number(rate.bw_a4_single_inr ?? 3),
          bwA4DuplexInr: Number(rate.bw_a4_duplex_inr ?? 5),
          colorA4SingleInr: Number(rate.color_a4_single_inr ?? 12),
          colorA4DuplexInr: Number(rate.color_a4_duplex_inr ?? 22),
          spiralBindingInr: Number(rate.spiral_binding_inr ?? 35),
          laminationPerSheetInr: Number(rate.lamination_per_sheet_inr ?? 20),
          capabilities: {
            bw_a4: cap.bw_a4 !== false,
            color_a4: Boolean(cap.color_a4),
            duplex: Boolean(cap.duplex),
            a3_large: Boolean(cap.a3_large),
            spiral_binding: Boolean(cap.spiral_binding),
            lamination: Boolean(cap.lamination),
            custom_digital_jobs: Boolean(cap.custom_digital_jobs),
            sealed_envelope: cap.sealed_envelope !== false,
          },
          shopUpiId: String(pay.shop_upi_id || ''),
          allowDirectPay: pay.allow_direct_pay !== false,
          allowEscrow: pay.allow_escrow !== false,
        };
      }
    } else if (vertical === 'booking_venue') {
      const { data } = await supabase
        .from('listing_booking_resources')
        .select('*')
        .eq('listing_id', listingId)
        .eq('resource_vertical', 'booking_venue')
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (data) {
        next.booking = {
          existingResourceId: String(data.id),
          name: String(data.name || ''),
          description: String(data.description || ''),
          bookingUnit: (data.booking_unit as BookingUnit) || 'hourly',
          slotDurationMins: Number(data.slot_duration_mins || 60),
          openHour: Number(data.open_hour ?? 6),
          closeHour: Number(data.close_hour ?? 22),
          totalUnits: Number(data.total_units || 1),
          maxGuests: Number(data.max_guests || 10),
          baseRateInr: Number(data.base_rate_inr || 500),
          advancePercent: Number(data.advance_percent ?? 30),
          isActive: data.is_active !== false,
        };
      }
    } else if (vertical === 'hotel_stay') {
      const [{ data: hotel }, { data: room }] = await Promise.all([
        supabase
          .from('listing_hotel_profiles')
          .select('*')
          .eq('listing_id', listingId)
          .maybeSingle(),
        supabase
          .from('listing_booking_resources')
          .select('*')
          .eq('listing_id', listingId)
          .eq('resource_vertical', 'hotel_stay')
          .order('sort_order', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      if (hotel) {
        const am = (hotel.amenities || {}) as Record<string, unknown>;
        const pay = (hotel.payment_policy || {}) as Record<string, unknown>;
        next.hotel = {
          ...next.hotel,
          stayType: (hotel.stay_type as HotelStayType) || 'homestay',
          checkInTime: String(hotel.check_in_time || '12:00 PM'),
          checkOutTime: String(hotel.check_out_time || '11:00 AM'),
          isAcceptingBookings: hotel.is_accepting_bookings !== false,
          houseRules: String(hotel.house_rules || ''),
          cancellationPolicy: String(hotel.cancellation_policy || ''),
          idRequirementNote: String(hotel.id_requirement_note || ''),
          amenities: {
            wifi: am.wifi !== false,
            parking: Boolean(am.parking),
            hot_water: Boolean(am.hot_water),
            power_backup: Boolean(am.power_backup),
            ac: Boolean(am.ac),
            heater: Boolean(am.heater),
            in_house_kitchen: Boolean(am.in_house_kitchen),
            early_checkin: Boolean(am.early_checkin),
          },
          shopUpiId: String(pay.shop_upi_id || ''),
        };
      }
      if (room) {
        next.hotel.existingRoomId = String(room.id);
        next.hotel.starterRoomName = String(room.name || 'Standard Room');
        next.hotel.starterNightlyRateInr = Number(room.base_rate_inr || 1800);
        next.hotel.starterTotalRooms = Number(room.total_units || 2);
        next.hotel.starterMaxGuests = Number(room.max_guests || 2);
      }
    } else if (vertical === 'shop_catalogue') {
      const { data } = await supabase
        .from('listing_shop_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();
      if (data) {
        const pay = (data.payment_policy || {}) as Record<string, unknown>;
        next.shop = {
          isAcceptingOrders: data.is_accepting_orders !== false,
          allowCounterPickup: data.allow_counter_pickup !== false,
          allowPickNDrop: data.allow_pick_n_drop !== false,
          minOrderInr: Number(data.min_order_inr ?? 0),
          packagingFeeInr: Number(data.packaging_fee_inr ?? 0),
          prepTimeMins: Number(data.prep_time_mins ?? 20),
          pickupInstructions: String(data.pickup_instructions || ''),
          shopUpiId: String(pay.shop_upi_id || ''),
          allowDirectPay: pay.allow_direct_pay !== false,
          allowEscrow: pay.allow_escrow !== false,
        };
      }
    } else if (vertical === 'restaurant_food') {
      const { data } = await supabase
        .from('listing_restaurant_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();
      if (data) {
        const pay = (data.payment_policy || {}) as Record<string, unknown>;
        next.restaurant = {
          cuisinesText: Array.isArray(data.cuisines)
            ? data.cuisines.join(', ')
            : '',
          isPureVeg: Boolean(data.is_pure_veg),
          isKitchenOpen: data.is_kitchen_open !== false,
          prepTimeMins: Number(data.prep_time_mins ?? 25),
          avgCostForTwoInr: Number(data.avg_cost_for_two_inr ?? 400),
          allowTakeaway: data.allow_takeaway !== false,
          allowPickNDrop: data.allow_pick_n_drop !== false,
          allowTableBooking: Boolean(data.allow_table_booking),
          maxTablePartySize: Number(data.max_table_party_size ?? 8),
          minOrderInr: Number(data.min_order_inr ?? 0),
          packagingFeeInr: Number(data.packaging_fee_inr ?? 15),
          fssaiLicenseNo: String(data.fssai_license_no || ''),
          pickupInstructions: String(data.pickup_instructions || ''),
          shopUpiId: String(pay.shop_upi_id || ''),
          allowDirectPay: pay.allow_direct_pay !== false,
          allowEscrow: pay.allow_escrow !== false,
        };
      }
    } else if (vertical === 'real_estate') {
      const { data } = await supabase
        .from('listing_real_estate_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();
      if (data) {
        const poly = parseBoundaryGeoJsonToPoints(data.boundary_geojson);
        const rawUnit = String(data.area_unit || 'sqft').trim().toLowerCase();
        const areaUnit: PayPerAreaUnit =
          rawUnit === 'sqm' || rawUnit === 'sangam' || rawUnit === 'acre'
            ? rawUnit
            : 'sqft';
        const resolvedAreaSqft = Number(
          data.area_sqft || next.realEstate.areaSqft || 0
        );
        const resolvedAreaValue =
          Number(data.area_value) > 0
            ? Number(data.area_value)
            : convertSqftToUnit(resolvedAreaSqft, areaUnit);
        next.realEstate = {
          ...next.realEstate,
          dealType: (data.deal_type as RealEstateDealType) || 'sale',
          propertyType: (data.property_type as RealEstatePropertyType) || 'plot_land',
          priceInr: Number(data.price_inr || 0),
          pricePeriod: (data.price_period as RealEstatePricePeriod) || 'total',
          depositInr: Number(data.deposit_inr || 0),
          isNegotiable: data.is_negotiable !== false,
          areaSqft: resolvedAreaSqft,
          areaUnit,
          areaValue: resolvedAreaValue,
          plotAreaSqm: resolvedAreaSqft
            ? Math.round(resolvedAreaSqft / 10.7639104)
            : next.realEstate.plotAreaSqm,
          landAreaText: String(data.land_area_text || ''),
          bedrooms: Number(data.bedrooms || 0),
          bathrooms: Number(data.bathrooms || 0),
          furnishing: (data.furnishing as RealEstateFurnishing) || 'unfurnished',
          pattaStatus: (data.patta_status as PattaStatus) || 'verified_patta',
          waterSupply: (data.water_supply as WaterSupplyType) || '24x7',
          roadAccess: (data.road_access as RoadAccessType) || 'car_accessible',
          powerBackup: Boolean(data.power_backup),
          parkingAvailable: Boolean(data.parking_available),
          listedByRole: (data.listed_by_role as RealEstateListedByRole) || 'owner',
          showExactPin: data.show_exact_pin !== false,
          contactRevealPolicy:
            (data.contact_reveal_policy as RealEstateContactRevealPolicy) || 'direct_call',
          availabilityStatus:
            (data.availability_status as RealEstateAvailabilityStatus) || 'available',
          boundaryPolygon: poly.length >= 3 ? poly : next.realEstate.boundaryPolygon,
        };
      }
    } else if (vertical === 'general') {
      const { data } = await supabase
        .from('listings')
        .select('service_details, business_details')
        .eq('id', listingId)
        .maybeSingle();
      if (data) {
        const sd = (data.service_details || {}) as Record<string, unknown>;
        const bd = (data.business_details || {}) as Record<string, unknown>;
        const rawRange = String(sd.priceRange || bd.priceRange || next.general.priceRange);
        next.general = {
          priceRange:
            rawRange === '₹' || rawRange === '₹₹₹' ? rawRange : '₹₹',
          deliveryInfo: String(
            sd.deliveryInfo || bd.deliveryInfo || next.general.deliveryInfo
          ),
          highlightsText: Array.isArray(sd.highlights)
            ? (sd.highlights as string[]).join(', ')
            : next.general.highlightsText,
          serviceAreasText: Array.isArray(sd.areasServed)
            ? (sd.areasServed as string[]).join(', ')
            : next.general.serviceAreasText,
          startingPriceInr: Number(
            sd.startingPrice ?? next.general.startingPriceInr ?? 0
          ),
          experienceYears: Number(
            sd.experienceYears ?? next.general.experienceYears ?? 2
          ),
        };
      }
    } else if (vertical === 'public_civic') {
      const { data } = await supabase
        .from('listing_civic_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();
      if (data) {
        next.civic = {
          departmentType:
            (data.department_type as CivicDepartmentType) || 'government_office',
          is24x7: Boolean(data.is_24x7),
          officeHoursText: String(data.office_hours_text || ''),
          importantNotes: String(data.important_notes || ''),
          officialWebsite: String(data.official_website || ''),
          showNearbyPrintHelper: data.show_nearby_print_helper !== false,
          helplines: Array.isArray(data.helplines)
            ? (data.helplines as CivicHelpline[])
            : [],
          documentChecklists: Array.isArray(data.document_checklists)
            ? (data.document_checklists as CivicDocumentChecklist[])
            : [],
        };
      }
    }
  } catch {
    // Non-fatal: keep defaults if vertical profile table hasn't been created for this listing yet
  }
  return next;
}

export function buildVerticalSummary(
  vertical: ListingVertical,
  bundle: VerticalFormBundle,
  logoUrl?: string | null,
  primaryPhone?: string | null
): VerticalSummary {
  const base: Record<string, unknown> = logoUrl ? { logo_url: logoUrl } : {};
  if (vertical === 'print_digital') {
    return {
      ...base,
      is_official_printswift: bundle.print.isOfficialPrintswift,
      is_first_party_printswift: bundle.print.isOfficialPrintswift,
      is_accepting_orders: bundle.print.isAcceptingOrders,
      express_eta_mins: bundle.print.expressEtaMins,
      supports_pick_n_drop: bundle.print.supportsPickNDrop,
      turnaround_badge: bundle.print.turnaroundBadge,
    };
  }
  if (vertical === 'booking_venue') {
    return {
      ...base,
      resource_count: 1,
      min_rate_inr: bundle.booking.baseRateInr,
      primary_unit: bundle.booking.bookingUnit,
      is_accepting_bookings: bundle.booking.isActive,
    };
  }
  if (vertical === 'hotel_stay') {
    return {
      ...base,
      stay_type: bundle.hotel.stayType,
      min_rate_inr: bundle.hotel.starterNightlyRateInr,
      primary_unit: 'nightly',
      is_accepting_bookings: bundle.hotel.isAcceptingBookings,
      top_amenities: Object.entries(bundle.hotel.amenities)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .slice(0, 5),
    };
  }
  if (vertical === 'shop_catalogue') {
    return {
      ...base,
      is_accepting_orders: bundle.shop.isAcceptingOrders,
      min_order_inr: bundle.shop.minOrderInr,
      prep_time_mins: bundle.shop.prepTimeMins,
      allow_pick_n_drop: bundle.shop.allowPickNDrop,
    };
  }
  if (vertical === 'restaurant_food') {
    return {
      ...base,
      is_pure_veg: bundle.restaurant.isPureVeg,
      is_kitchen_open: bundle.restaurant.isKitchenOpen,
      avg_cost_for_two_inr: bundle.restaurant.avgCostForTwoInr,
      allow_table_booking: bundle.restaurant.allowTableBooking,
    };
  }
  if (vertical === 'real_estate') {
    const normalizedAreaSqft =
      bundle.realEstate.areaSqft > 0
        ? bundle.realEstate.areaSqft
        : convertAreaToSqft(
            bundle.realEstate.areaValue,
            bundle.realEstate.areaUnit
          );
    return {
      ...base,
      deal_type: bundle.realEstate.dealType,
      property_type: bundle.realEstate.propertyType,
      price_inr: bundle.realEstate.priceInr,
      area_sqft: normalizedAreaSqft,
      area_unit: bundle.realEstate.areaUnit,
      area_value:
        bundle.realEstate.areaValue > 0
          ? bundle.realEstate.areaValue
          : convertSqftToUnit(normalizedAreaSqft, bundle.realEstate.areaUnit),
      show_exact_pin: bundle.realEstate.showExactPin,
      boundary_geojson: toClosedGeoJsonPolygon(
        bundle.realEstate.boundaryPolygon
      ),
    };
  }
  if (vertical === 'public_civic') {
    return {
      ...base,
      department_type: bundle.civic.departmentType,
      is_24x7: bundle.civic.is24x7,
      primary_phone: primaryPhone || bundle.civic.helplines[0]?.phone || null,
      helpline_count: bundle.civic.helplines.length,
      checklist_count: bundle.civic.documentChecklists.length,
    };
  }
  return base;
}

export async function saveVerticalProfileToSupabase(params: {
  supabase: typeof supabaseClient;
  listingId: string;
  hubId: string;
  vertical: ListingVertical;
  bundle: VerticalFormBundle;
  isPrivilegedOfficialRole: boolean;
}): Promise<string | null> {
  const {
    supabase,
    listingId,
    hubId,
    vertical,
    bundle,
    isPrivilegedOfficialRole,
  } = params;

  try {
    if (vertical === 'general') {
      const g = bundle.general;
      const areasServed = g.serviceAreasText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const highlights = g.highlightsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const { error } = await supabase
        .from('listings')
        .update({
          service_details: {
            areasServed,
            startingPrice: g.startingPriceInr > 0 ? g.startingPriceInr : null,
            experienceYears: g.experienceYears > 0 ? g.experienceYears : 0,
            priceRange: g.priceRange,
            deliveryInfo: g.deliveryInfo.trim() || null,
            highlights,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', listingId);
      return error ? error.message : null;
    }

    if (vertical === 'print_digital') {
      const p = bundle.print;
      const { data: existingPrint } = await supabase
        .from('listing_print_profiles')
        .select('capabilities, rate_card, payment_policy')
        .eq('listing_id', listingId)
        .maybeSingle();
      const prevCap =
        (existingPrint?.capabilities as Record<string, unknown> | null) || {};
      const prevRate =
        (existingPrint?.rate_card as Record<string, unknown> | null) || {};
      const payload: Record<string, unknown> = {
        listing_id: listingId,
        hub_id: hubId,
        is_accepting_orders: p.isAcceptingOrders,
        turnaround_badge: p.turnaroundBadge,
        express_eta_mins: p.expressEtaMins,
        supports_pick_n_drop: p.supportsPickNDrop,
        pickup_instructions: p.pickupInstructions.trim() || null,
        max_file_size_mb: p.maxFileSizeMb,
        capabilities: { ...prevCap, ...p.capabilities },
        rate_card: {
          ...prevRate,
          bw_a4_single_inr: p.bwA4SingleInr,
          bw_a4_duplex_inr: p.bwA4DuplexInr,
          color_a4_single_inr: p.colorA4SingleInr,
          color_a4_duplex_inr: p.colorA4DuplexInr,
          spiral_binding_inr: p.spiralBindingInr,
          lamination_per_sheet_inr: p.laminationPerSheetInr,
        },
        payment_policy: mergePaymentPolicyPreservingVerification(
          existingPrint?.payment_policy,
          {
            allow_direct_pay: p.allowDirectPay,
            direct_pay_max_inr: Number(
              (existingPrint?.payment_policy as Record<string, unknown> | null)
                ?.direct_pay_max_inr ?? 500
            ),
            allow_escrow: p.allowEscrow,
          },
          p.shopUpiId
        ),
        updated_at: new Date().toISOString(),
      };
      if (isPrivilegedOfficialRole) {
        payload.is_official_printswift = p.isOfficialPrintswift;
        payload.is_first_party_printswift = p.isOfficialPrintswift;
      }
      const { error } = await supabase
        .from('listing_print_profiles')
        .upsert(payload, { onConflict: 'listing_id' });
      return error ? error.message : null;
    }

    if (vertical === 'booking_venue') {
      const b = bundle.booking;
      const payload = {
        listing_id: listingId,
        hub_id: hubId,
        resource_vertical: 'booking_venue',
        name: b.name.trim() || 'Main Venue / Slot',
        description: b.description.trim() || null,
        booking_unit: b.bookingUnit,
        slot_duration_mins: b.slotDurationMins,
        open_hour: b.openHour,
        close_hour: b.closeHour,
        total_units: b.totalUnits,
        max_guests: b.maxGuests,
        base_rate_inr: b.baseRateInr,
        advance_percent: b.advancePercent,
        is_active: b.isActive,
        updated_at: new Date().toISOString(),
      };
      if (b.existingResourceId) {
        const { error } = await supabase
          .from('listing_booking_resources')
          .update(payload)
          .eq('id', b.existingResourceId);
        return error ? error.message : null;
      }
      const { error } = await supabase
        .from('listing_booking_resources')
        .insert(payload);
      return error ? error.message : null;
    }

    if (vertical === 'hotel_stay') {
      const h = bundle.hotel;
      const { data: existingHotel } = await supabase
        .from('listing_hotel_profiles')
        .select('amenities, payment_policy')
        .eq('listing_id', listingId)
        .maybeSingle();
      const prevAmenities =
        (existingHotel?.amenities as Record<string, unknown> | null) || {};
      const { error: hotelErr } = await supabase
        .from('listing_hotel_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId,
            stay_type: h.stayType,
            check_in_time: h.checkInTime.trim() || '12:00 PM',
            check_out_time: h.checkOutTime.trim() || '11:00 AM',
            amenities: { ...prevAmenities, ...h.amenities },
            house_rules: h.houseRules.trim() || null,
            cancellation_policy:
              h.cancellationPolicy.trim() ||
              'Free cancellation up to 24 hours before check-in.',
            id_requirement_note:
              h.idRequirementNote.trim() || 'Valid Govt photo ID required.',
            is_accepting_bookings: h.isAcceptingBookings,
            payment_policy: mergePaymentPolicyPreservingVerification(
              existingHotel?.payment_policy,
              {
                allow_direct_pay: true,
                advance_percent: Number(
                  (existingHotel?.payment_policy as Record<string, unknown> | null)
                    ?.advance_percent ?? 30
                ),
                allow_full_prepay: true,
              },
              h.shopUpiId
            ),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'listing_id' }
        );
      if (hotelErr) return hotelErr.message;

      const roomPayload = {
        listing_id: listingId,
        hub_id: hubId,
        resource_vertical: 'hotel_stay',
        name: h.starterRoomName.trim() || 'Standard Room',
        booking_unit: 'nightly',
        slot_duration_mins: 1440,
        open_hour: 0,
        close_hour: 24,
        total_units: h.starterTotalRooms,
        max_guests: h.starterMaxGuests,
        base_rate_inr: h.starterNightlyRateInr,
        advance_percent: 30,
        is_active: h.isAcceptingBookings,
        updated_at: new Date().toISOString(),
      };
      if (h.existingRoomId) {
        await supabase
          .from('listing_booking_resources')
          .update(roomPayload)
          .eq('id', h.existingRoomId);
      } else {
        await supabase.from('listing_booking_resources').insert(roomPayload);
      }
      return null;
    }

    if (vertical === 'shop_catalogue') {
      const s = bundle.shop;
      const { data: existingShop } = await supabase
        .from('listing_shop_profiles')
        .select('payment_policy')
        .eq('listing_id', listingId)
        .maybeSingle();
      const { error } = await supabase.from('listing_shop_profiles').upsert(
        {
          listing_id: listingId,
          hub_id: hubId,
          is_accepting_orders: s.isAcceptingOrders,
          allow_counter_pickup: s.allowCounterPickup,
          allow_pick_n_drop: s.allowPickNDrop,
          min_order_inr: s.minOrderInr,
          packaging_fee_inr: s.packagingFeeInr,
          prep_time_mins: s.prepTimeMins,
          pickup_instructions: s.pickupInstructions.trim() || null,
          payment_policy: mergePaymentPolicyPreservingVerification(
            existingShop?.payment_policy,
            {
              allow_direct_pay: s.allowDirectPay,
              direct_pay_max_inr: Number(
                (existingShop?.payment_policy as Record<string, unknown> | null)
                  ?.direct_pay_max_inr ?? 2000
              ),
              allow_escrow: s.allowEscrow,
            },
            s.shopUpiId
          ),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'listing_id' }
      );
      return error ? error.message : null;
    }

    if (vertical === 'restaurant_food') {
      const r = bundle.restaurant;
      const cuisines = r.cuisinesText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const { data: existingRest } = await supabase
        .from('listing_restaurant_profiles')
        .select('payment_policy')
        .eq('listing_id', listingId)
        .maybeSingle();
      const { error } = await supabase
        .from('listing_restaurant_profiles')
        .upsert(
          {
            listing_id: listingId,
            hub_id: hubId,
            cuisines,
            is_pure_veg: r.isPureVeg,
            is_kitchen_open: r.isKitchenOpen,
            prep_time_mins: r.prepTimeMins,
            avg_cost_for_two_inr: r.avgCostForTwoInr,
            allow_takeaway: r.allowTakeaway,
            allow_pick_n_drop: r.allowPickNDrop,
            allow_table_booking: r.allowTableBooking,
            max_table_party_size: r.maxTablePartySize,
            min_order_inr: r.minOrderInr,
            packaging_fee_inr: r.packagingFeeInr,
            fssai_license_no: r.fssaiLicenseNo.trim() || null,
            pickup_instructions: r.pickupInstructions.trim() || null,
            payment_policy: mergePaymentPolicyPreservingVerification(
              existingRest?.payment_policy,
              {
                allow_direct_pay: r.allowDirectPay,
                direct_pay_max_inr: Number(
                  (existingRest?.payment_policy as Record<string, unknown> | null)
                    ?.direct_pay_max_inr ?? 2000
                ),
                allow_escrow: r.allowEscrow,
              },
              r.shopUpiId
            ),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'listing_id' }
        );
      return error ? error.message : null;
    }

    if (vertical === 'real_estate') {
      const re = bundle.realEstate;
      const nowIso = new Date().toISOString();
      const normalizedSqft =
        re.areaSqft > 0
          ? re.areaSqft
          : convertAreaToSqft(re.areaValue, re.areaUnit);
      const resolvedAreaVal =
        re.areaValue > 0
          ? re.areaValue
          : convertSqftToUnit(normalizedSqft, re.areaUnit);
      const payload = {
        listing_id: listingId,
        hub_id: hubId,
        deal_type: re.dealType,
        property_type: re.propertyType,
        price_inr: re.priceInr,
        price_period: re.pricePeriod,
        deposit_inr: re.depositInr > 0 ? re.depositInr : null,
        is_negotiable: re.isNegotiable,
        bedrooms: re.bedrooms > 0 ? re.bedrooms : null,
        bathrooms: re.bathrooms > 0 ? re.bathrooms : null,
        area_sqft: normalizedSqft > 0 ? normalizedSqft : null,
        area_unit: re.areaUnit,
        area_value: resolvedAreaVal > 0 ? resolvedAreaVal : null,
        land_area_text: re.landAreaText.trim() || null,
        furnishing: re.furnishing,
        patta_status: re.pattaStatus,
        water_supply: re.waterSupply,
        road_access: re.roadAccess,
        power_backup: re.powerBackup,
        parking_available: re.parkingAvailable,
        listed_by_role: re.listedByRole,
        show_exact_pin: re.showExactPin,
        contact_reveal_policy: re.contactRevealPolicy,
        availability_status: re.availabilityStatus,
        boundary_geojson: toClosedGeoJsonPolygon(re.boundaryPolygon),
        last_confirmed_available_at: nowIso,
        updated_at: nowIso,
      };
      const { error } = await supabase
        .from('listing_real_estate_profiles')
        .upsert(payload, { onConflict: 'listing_id' });
      return error ? error.message : null;
    }

    if (vertical === 'public_civic') {
      const c = bundle.civic;
      const { error } = await supabase.from('listing_civic_profiles').upsert(
        {
          listing_id: listingId,
          hub_id: hubId,
          department_type: c.departmentType,
          is_24x7: c.is24x7,
          office_hours_text: c.officeHoursText.trim() || null,
          helplines: c.helplines,
          document_checklists: c.documentChecklists,
          important_notes: c.importantNotes.trim() || null,
          official_website: c.officialWebsite.trim() || null,
          show_nearby_print_helper: c.showNearbyPrintHelper,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'listing_id' }
      );
      return error ? error.message : null;
    }
  } catch (err) {
    return err instanceof Error
      ? err.message
      : 'Failed saving vertical configuration.';
  }

  return null;
}
