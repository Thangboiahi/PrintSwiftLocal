/**
 * DD oodle — Phase 75-A: Lightweight Real Estate Pro Shared TypeScript Contracts
 * Regional trust fields (Patta/VA, 24x7 water, car vs two-wheeler access),
 * 30-day freshness confirmation, site visits & verified boosts.
 */

export type RealEstateDealType = 'rent' | 'sale' | 'lease' | 'pg_hostel';

export type RealEstatePropertyType =
  | 'plot_land'
  | 'house'
  | 'apartment'
  | 'commercial_shop'
  | 'room_pg';

export type RealEstatePricePeriod = 'total' | 'monthly' | 'yearly';

export type RealEstateFurnishing =
  | 'unfurnished'
  | 'semi_furnished'
  | 'furnished'
  | 'not_applicable';

export type PattaStatus =
  | 'verified_patta'
  | 'village_authority'
  | 'leasehold'
  | 'not_applicable';

export type WaterSupplyType =
  | '24x7'
  | 'municipal'
  | 'borewell'
  | 'tanker'
  | 'seasonal';

export type RoadAccessType =
  | 'car_accessible'
  | 'two_wheeler_only'
  | 'footpath';

export type RealEstateListedByRole = 'owner' | 'agent' | 'builder';

export type RealEstateContactRevealPolicy =
  | 'direct_call'
  | 'after_visit_accept';

export type RealEstateAvailabilityStatus =
  | 'available'
  | 'under_offer'
  | 'sold_rented'
  | 'paused';

export type PropertyVisitSlot = 'morning' | 'afternoon' | 'evening';

export type PropertyVisitStatus =
  | 'requested'
  | 'accepted'
  | 'rescheduled'
  | 'completed'
  | 'declined'
  | 'cancelled';

export interface ListingRealEstateProfile {
  listing_id: string;
  hub_id: string;
  deal_type: RealEstateDealType;
  property_type: RealEstatePropertyType;
  price_inr: number;
  price_period: RealEstatePricePeriod;
  deposit_inr: number | null;
  is_negotiable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  land_area_text: string | null;
  furnishing: RealEstateFurnishing;
  patta_status: PattaStatus;
  water_supply: WaterSupplyType;
  road_access: RoadAccessType;
  power_backup: boolean;
  parking_available: boolean;
  listed_by_role: RealEstateListedByRole;
  show_exact_pin: boolean;
  contact_reveal_policy: RealEstateContactRevealPolicy;
  optional_tour_url: string | null;
  patta_verified: boolean;
  site_verified: boolean;
  verified_boost_expires_at: string | null;
  availability_status: RealEstateAvailabilityStatus;
  last_confirmed_available_at: string;
  freshness_expires_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface PropertyVisitRequest {
  id: string;
  request_code: string;
  hub_id: string;
  listing_id: string;
  requester_id: string;
  requester_name: string;
  requester_phone: string;
  preferred_date: string;
  preferred_slot: PropertyVisitSlot;
  message: string | null;
  status: PropertyVisitStatus;
  owner_note: string | null;
  contact_revealed: boolean;
  created_at: string;
  updated_at: string;
}

export interface RealEstateVerticalSummary {
  deal_type: RealEstateDealType;
  property_type: RealEstatePropertyType;
  price_inr: number;
  price_period: RealEstatePricePeriod;
  bedrooms: number | null;
  area_sqft: number | null;
  land_area_text: string | null;
  patta_status: PattaStatus;
  patta_verified: boolean;
  site_verified: boolean;
  water_supply: WaterSupplyType;
  road_access: RoadAccessType;
  availability_status: RealEstateAvailabilityStatus;
  listed_by_role: RealEstateListedByRole;
  verified_boost_expires_at: string | null;
  freshness_expires_at: string;
}
