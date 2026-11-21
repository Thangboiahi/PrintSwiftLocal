export interface LandingCivicAlertItem {
  listingId: string;
  title: string;
  alertText: string;
  isEmergency: boolean;
}

export interface LandingCivicHighlightItem {
  id: string;
  title: string;
  locality: string;
  departmentType: string;
  is24x7: boolean;
  primaryPhone: string | null;
}

export interface LandingFoodShopItem {
  id: string;
  title: string;
  vertical: 'restaurant_food' | 'shop_catalogue';
  locality: string;
  imageUrl: string | null;
  isPureVeg: boolean;
  fssaiVerified: boolean;
  prepEtaMins: number | null;
  pickNDropReady: boolean;
  inStockCount: number;
}

export interface LandingVenueStayItem {
  id: string;
  title: string;
  vertical: 'booking_venue' | 'hotel_stay';
  locality: string;
  imageUrl: string | null;
  startingRateInr: number;
  rateUnit: string;
}

export interface LandingRealEstateItem {
  id: string;
  title: string;
  locality: string;
  imageUrl: string | null;
  priceInr: number;
  pricePeriod: 'total' | 'monthly' | 'yearly';
  transactionType: string;
  pattaVerified: boolean;
  water24x7: boolean;
  carRoad: boolean;
  isBoosted: boolean;
}

export interface LandingDishPreviewItem {
  id: string;
  listingId: string;
  name: string;
  priceInr: number;
  restaurantName: string;
  dietaryType: string;
}
