import {
  createEquirectangularPanoramaSvg,
  createListingCoverSvg,
  createProductSvg,
} from './media-generator';
import {
  AuditLogEntry,
  DynamicFieldDefinition,
  EnquiryRecord,
  LatLngPoint,
  Listing,
  ModerationCase,
  NotificationItem,
  PropertyType,
  ReviewRecord,
  StaffDelegation,
  UserAccount,
  VerificationRequest,
} from './types';

export const CHURACHANDPUR_SAMPLE_CENTER: LatLngPoint = {
  lat: 24.3335,
  lng: 93.6978,
};

export const SAMPLE_LOCALITIES = [
  'New Lamka Demo Sector (Sample)',
  'Tuibong Sample Corridor (Sample)',
  'Rengkai Demo Enclave (Sample)',
  'Hiangtam Lamka Sample Hub (Sample)',
  'Zenhang Lamka Demo Ward (Sample)',
  'Bungmual Sample Ridge (Sample)',
  'Pearsonmun Demo Valley (Sample)',
  'Lanva Sample Crossing (Sample)',
] as const;

export const CHURACHANDPUR_LOCALITIES = SAMPLE_LOCALITIES;

export const INITIAL_USERS: UserAccount[] = [
  {
    id: 'visitor-demo',
    name: 'Demo Visitor (Public Explorer)',
    email: 'visitor@sample-printswift.local',
    roleType: 'visitor',
    status: 'active',
    joinedAt: '2026-01-10',
    avatarLabel: 'DV',
    description: 'Explore map, filter 80 sample listings, inspect 360° real-estate panoramas, and send demo enquiries.',
  },
  {
    id: 'owner-1',
    name: 'Thangboi Demo Enterprises (Owner)',
    email: 'owner1@sample-printswift.local',
    roleType: 'owner',
    status: 'active',
    joinedAt: '2026-01-15',
    avatarLabel: 'TD',
    description: 'Multi-listing demonstration owner managing sample shops, services, and real-estate listings.',
  },
  {
    id: 'owner-2',
    name: 'Lamka Sample Estates & Retail (Owner)',
    email: 'owner2@sample-printswift.local',
    roleType: 'owner',
    status: 'active',
    joinedAt: '2026-02-01',
    avatarLabel: 'LS',
    description: 'Demonstration property & venue owner account.',
  },
  {
    id: 'staff-1',
    name: 'Mercy Demo Agent (Delegated Staff)',
    email: 'staff1@sample-printswift.local',
    roleType: 'staff',
    status: 'active',
    joinedAt: '2026-02-18',
    avatarLabel: 'MA',
    description: 'Authorised staff member with delegated permissions on assigned owner listings only.',
  },
  {
    id: 'staff-2',
    name: 'David Sample Coordinator (Staff)',
    email: 'staff2@sample-printswift.local',
    roleType: 'staff',
    status: 'active',
    joinedAt: '2026-03-04',
    avatarLabel: 'DC',
    description: 'Catalogue and enquiry support staff for assigned sample business listings.',
  },
  {
    id: 'admin-super',
    name: 'Platform Super Admin (Demo)',
    email: 'superadmin@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'super_admin',
    status: 'active',
    joinedAt: '2026-01-01',
    avatarLabel: 'SA',
    description: 'Full demonstration access across users, roles, verification, moderation, geo tools, and settings.',
  },
  {
    id: 'admin-mod',
    name: 'Listing Moderator (Demo)',
    email: 'moderator@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'listing_moderator',
    status: 'active',
    joinedAt: '2026-01-12',
    avatarLabel: 'LM',
    description: 'Reviews submitted listings, requests changes, and manages publication workflow.',
  },
  {
    id: 'admin-verify',
    name: 'Verification Officer (Demo)',
    email: 'verify@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'verification_officer',
    status: 'active',
    joinedAt: '2026-01-14',
    avatarLabel: 'VO',
    description: 'Evaluates synthetic verification requests and evidence records.',
  },
  {
    id: 'admin-community',
    name: 'Community Moderator (Demo)',
    email: 'community@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'community_moderator',
    status: 'active',
    joinedAt: '2026-01-20',
    avatarLabel: 'CM',
    description: 'Handles review reports, community flags, and media moderation cases.',
  },
  {
    id: 'admin-support',
    name: 'Customer Support Officer (Demo)',
    email: 'support@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'customer_support',
    status: 'active',
    joinedAt: '2026-02-02',
    avatarLabel: 'CS',
    description: 'Assists owners and visitors with listing inquiries and account questions.',
  },
  {
    id: 'admin-finance',
    name: 'Commercial & Plans Admin (Demo)',
    email: 'finance@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'finance_admin',
    status: 'active',
    joinedAt: '2026-02-05',
    avatarLabel: 'FA',
    description: 'Manages future-phase sponsored demo plans and promotional slots.',
  },
  {
    id: 'admin-analytics',
    name: 'Analytics Viewer (Demo)',
    email: 'analytics@sample-printswift.local',
    roleType: 'admin',
    adminRole: 'analytics_viewer',
    status: 'active',
    joinedAt: '2026-02-10',
    avatarLabel: 'AV',
    description: 'Read-only access to platform analytics, locality distributions, and reports.',
  },
];

export const INITIAL_STAFF_DELEGATIONS: StaffDelegation[] = [
  {
    id: 'del-1',
    staffUserId: 'staff-1',
    staffName: 'Mercy Demo Agent (Delegated Staff)',
    staffEmail: 'staff1@sample-printswift.local',
    ownerId: 'owner-1',
    assignedListingIds: ['biz-1', 'biz-2', 're-1', 're-2', 'srv-1'],
    permissions: ['edit_details', 'manage_media', 'manage_catalogue', 'reply_enquiries', 'reply_reviews'],
    assignedAt: '2026-09-12',
    status: 'active',
  },
  {
    id: 'del-2',
    staffUserId: 'staff-2',
    staffName: 'David Sample Coordinator (Staff)',
    staffEmail: 'staff2@sample-printswift.local',
    ownerId: 'owner-1',
    assignedListingIds: ['biz-1', 'biz-3'],
    permissions: ['manage_catalogue', 'reply_enquiries', 'view_analytics'],
    assignedAt: '2026-09-20',
    status: 'active',
  },
];

function deterministicCoord(index: number, ringTotal: number, radiusDeg: number): LatLngPoint {
  const angle = (index / ringTotal) * Math.PI * 2 + (index % 5) * 0.18;
  const isOuterRing = index % 5 === 4;
  const r = isOuterRing
    ? radiusDeg * 1.75
    : radiusDeg * (0.18 + ((index * 13) % 32) / 100);
  const lat = Number((CHURACHANDPUR_SAMPLE_CENTER.lat + Math.sin(angle) * r).toFixed(6));
  const lng = Number((CHURACHANDPUR_SAMPLE_CENTER.lng + Math.cos(angle) * r * 1.1).toFixed(6));
  return { lat, lng };
}

function makeSampleBoundary(center: LatLngPoint, widthDeg = 0.00045, heightDeg = 0.00038): LatLngPoint[] {
  return [
    { lat: Number((center.lat - heightDeg).toFixed(6)), lng: Number((center.lng - widthDeg).toFixed(6)) },
    { lat: Number((center.lat - heightDeg).toFixed(6)), lng: Number((center.lng + widthDeg).toFixed(6)) },
    { lat: Number((center.lat + heightDeg).toFixed(6)), lng: Number((center.lng + widthDeg * 0.92).toFixed(6)) },
    { lat: Number((center.lat + heightDeg * 0.95).toFixed(6)), lng: Number((center.lng - widthDeg).toFixed(6)) },
  ];
}

// ============================================================================
// BUILD 80 SYNTHETIC SAMPLE LISTINGS
// - 20 Businesses & Shops (biz-1 .. biz-20)
// - 20 Public-Interest & Community Places (pub-1 .. pub-20)
// - 15 Services & Providers (srv-1 .. srv-15)
// - 15 Real Estate Properties (re-1 .. re-15)
// - 10 Sports & Recreational Venues (spt-1 .. spt-10)
// ============================================================================

const BUSINESS_SEED = [
  ['Hilltop Sample Book & Craft Mart', 'Bookstore & Stationery', 'Curated academic books, art supplies, and office stationery sample shop.'],
  ['Lamka Valley Organic Grocery (Sample)', 'Supermarket & Daily Needs', 'Fresh hill produce, dry goods, and packaged household staples for demo browsing.'],
  ['Zogam weave & Handloom Studio (Sample)', 'Apparel & Traditional Textiles', 'Synthetic showcase of traditional shawls, woven fabrics, and tailored garments.'],
  ['Tuibong Digital & Computer Hub (Sample)', 'Electronics & Peripherals', 'Sample laptops, monitors, networking routers, and accessories catalogue.'],
  ['Singngat Aroma Coffee Roasters (Sample)', 'Cafe & Bakery', 'Specialty local-roast coffee beans, pastries, and quiet reading space (Sample).'],
  ['Rengkai Timber & Home Furniture (Sample)', 'Furniture & Interiors', 'Solid wood dining sets, study desks, and modular storage cabinets (Demo).'],
  ['Bungmual Solar & Inverter Supply (Sample)', 'Hardware & Solar Equipment', 'Off-grid solar panels, lithium battery banks, and LED lighting fixtures (Sample).'],
  ['Hiangtam MedPlus Sample Pharmacy', 'Pharmacy & Wellness', 'Illustrative health supplies, wellness monitors, and first-aid kits (Not real medical store).'],
  ['New Lamka Agro & Seed Centre (Sample)', 'Agricultural Supplies', 'Garden tools, drip irrigation kits, and organic compost bags (Demo).'],
  ['Pearsonmun Ceramic & Kitchen Studio (Sample)', 'Home & Kitchenware', 'Cookware sets, ceramic tableware, and water filtration units (Sample).'],
  ['Lanva Auto Spares & Lubricants (Sample)', 'Automotive Retail', 'Two-wheeler and four-wheeler spare parts, tyres, and synthetic oils (Sample).'],
  ['Zenhang Musical Instruments Gallery (Sample)', 'Music & Audio Gear', 'Acoustic guitars, digital pianos, studio microphones, and PA speakers (Demo).'],
  ['Khuga Valley Tea & Spice Emporium (Sample)', 'Gourmet & Spices', 'Packaged hill turmeric, ginger blends, and orthodox loose-leaf teas (Sample).'],
  ['Blue Ridge Optical & Eyewear (Sample)', 'Optical Retail', 'Sample prescription frames, UV sunglasses, and lens care kits.'],
  ['Vengnuam Kids Toy & Learning Store (Sample)', 'Toys & Educational Kits', 'STEM building blocks, board games, and children reading kits (Sample).'],
  ['Central Lamka Footwear & Leather (Sample)', 'Footwear & Bags', 'Trekking boots, school shoes, and weatherproof travel backpacks (Demo).'],
  ['Mualvaiphei Paint & Sanitaryware (Sample)', 'Building Materials', 'Exterior weatherproof paints, ceramic tiles, and bathroom fittings (Sample).'],
  ['Saikot Fresh Bakehouse & Confectionery (Sample)', 'Bakery & Cakes', 'Artisan sourdough loaves, celebration cakes, and tea biscuits (Sample).'],
  ['Hillcrest Pet Care & Feed Store (Sample)', 'Pet Supplies', 'Balanced pet nutrition, grooming accessories, and travel crates (Demo).'],
  ['Lamka Eco Packaging & Paper Mart (Sample)', 'Packaging & Office Supplies', 'Biodegradable kraft bags, food containers, and retail display supplies (Sample).'],
];

const PUBLIC_PLACE_SEED = [
  ['New Lamka Sample Community Library', 'Public Library & Reading Hall', 'Demonstration public reading room with study desks and local archive reference shelves.'],
  ['Tuibong Sample Civic Information Kiosk', 'Citizen Information Centre', 'Synthetic public information point illustrating directory and community notices.'],
  ['Rengkai Sample Botanical Eco-Park', 'Public Park & Green Space', 'Walking trails, native bamboo groves, and shaded community seating pavilions (Sample).'],
  ['Hiangtam Sample Town Hall & Auditorium', 'Community Assembly Hall', 'Multi-purpose civic hall for cultural gatherings, seminars, and public workshops (Demo).'],
  ['Bungmual Sample Primary Health Outpost', 'Community Health Centre (Sample)', 'Illustrative public health awareness centre and wellness checkpoint (Synthetic record).'],
  ['Pearsonmun Sample Viewpoint & Heritage Garden', 'Scenic Viewpoint & Park', 'Elevated ridge park overlooking the sample valley with informational plaques.'],
  ['Lanva Sample Youth Innovation Hub', 'Skill & Digital Learning Centre', 'Public-interest digital literacy lab and maker workshop space (Demonstration).'],
  ['Zenhang Sample Farmers Market Pavilion', 'Community Market Shed', 'Covered morning market pavilion for local growers and artisans (Sample).'],
  ['Central Lamka Sample Museum of Crafts', 'Cultural & Heritage Center', 'Exhibition gallery showcasing synthetic artifacts and textile heritage notes.'],
  ['Khuga Sample Riverside Promenade', 'Public Recreation Walk', 'Pedestrian walkway with solar street lighting and rest benches (Sample).'],
  ['Vengnuam Sample Senior Citizens Lounge', 'Community Welfare Centre', 'Daytime reading, chess, and social gathering room for community elders (Demo).'],
  ['Saikot Sample Eco-Conservation Nursery', 'Public Forestry Nursery', 'Tree sapling distribution point and environmental education garden (Sample).'],
  ['Mualvaiphei Sample Women Weavers Co-op Hall', 'Community Cooperative Facility', 'Shared loom workspace and craft training facility (Synthetic record).'],
  ['Tuibong South Sample Disaster Preparedness Centre', 'Emergency & Civic Facility (Sample)', 'Illustrative training and relief coordination building for prototype testing.'],
  ['New Lamka Sample Children Science Park', 'Educational Park', 'Outdoor interactive physics exhibits and solar dial installation (Sample).'],
  ['Rengkai Bridge Sample Ecological Point', 'Riverbank Observation Area', 'Public birdwatching and river ecology observation deck (Sample).'],
  ['Hiangtam West Sample Public Wash & Rest Stop', 'Public Amenity Block', 'Accessible rest facility with filtered drinking water kiosk (Sample).'],
  ['Bungmual North Sample Amphitheatre', 'Open-Air Cultural Venue', 'Tiered stone seating for acoustic community performances (Sample).'],
  ['Pearsonmun East Sample Solar Microgrid Station', 'Public Utility Demonstration', 'Educational display on community renewable energy storage (Sample).'],
  ['Lanva South Sample Recycling & Compost Drop-off', 'Civic Sustainability Hub', 'Segregated dry waste and community composting point (Sample).'],
];

const SERVICE_SEED = [
  ['Zogam Sample Electrical & Solar Technicians', 'Electrical & Solar Maintenance', 'On-call residential wiring, inverter diagnostics, and solar panel cleaning (Sample).'],
  ['Lamka Precision Plumbing & Water Tank Care', 'Plumbing & Water Systems', 'Pipe leak repair, pump installation, and rainwater harvesting maintenance (Demo).'],
  ['Tuibong Sample Architectural Drafting Studio', 'Architecture & Structural Design', '3D residential floor plans, structural layout consultation, and interior CAD (Sample).'],
  ['Rengkai Sample Appliance Repair Collective', 'Home Appliance Servicing', 'Refrigerator, washing machine, and induction cooktop diagnostics (Sample).'],
  ['Hiangtam Sample Home Tutors & Language Lab', 'Academic Tutoring & Coaching', 'Mathematics, science, and spoken language coaching for students (Demo).'],
  ['Bungmual Sample Carpentry & Custom Woodwork', 'Carpentry & Joinery', 'Custom wardrobes, modular kitchen fitting, and door frame restoration (Sample).'],
  ['Pearsonmun Sample Event Sound & Tent Rentals', 'Event Production & Rentals', 'PA sound systems, weatherproof canopies, and stage lighting setup (Sample).'],
  ['Lanva Sample Computer & Network Support', 'IT & Laptop Repair', 'OS troubleshooting, SSD upgrades, and office Wi-Fi mesh setup (Demo).'],
  ['Zenhang Sample Tailoring & Alteration Studio', 'Custom Tailoring', 'Bespoke formal wear, traditional attire stitching, and rapid alterations (Sample).'],
  ['New Lamka Sample Tax & Bookkeeping Advisory', 'Accounting & Documentation', 'Small business bookkeeping, GST filing demos, and financial literacy (Sample).'],
  ['Vengnuam Sample Landscape & Garden Maintenance', 'Gardening & Landscaping', 'Terrace garden setup, hedge pruning, and orchard care (Sample).'],
  ['Saikot Sample Photography & Drone Videography', 'Photography & Media', 'Event coverage, architectural photography, and 360° virtual tour capture (Demo).'],
  ['Mualvaiphei Sample Water Purifier Servicing', 'RO & Filter Maintenance', 'Filter cartridge replacement and TDS water quality testing (Sample).'],
  ['Khuga Sample Borewell & Rainwater Consultants', 'Hydrogeology & Water Harvesting', 'Rooftop rainwater filtration design and storage sizing (Sample).'],
  ['Central Lamka Sample Pest Control & Sanitization', 'Hygiene & Pest Control', 'Eco-friendly termite treatment and commercial space sanitization (Sample).'],
];

const REAL_ESTATE_SEED: Array<{
  title: string;
  propertyType: PropertyType;
  hasPlot: boolean;
  price: number;
  priceLabel: string;
  plotAreaSqm?: number;
  builtUpAreaSqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
  floorNumber?: number;
  totalFloors?: number;
}> = [
  {
    title: 'Sample Corner Residential Plot at Tuibong Ridge',
    propertyType: 'plot_land',
    hasPlot: true,
    price: 2250000,
    priceLabel: '₹22.50 Lakhs (Sample Asking)',
    plotAreaSqm: 520,
  },
  {
    title: 'Sample Hillside Agricultural-Residential Land in Bungmual',
    propertyType: 'plot_land',
    hasPlot: true,
    price: 1680000,
    priceLabel: '₹16.80 Lakhs (Sample Asking)',
    plotAreaSqm: 840,
  },
  {
    title: 'Sample 4BHK Family House with Walled Plot in New Lamka',
    propertyType: 'house_with_plot',
    hasPlot: true,
    price: 6800000,
    priceLabel: '₹68.00 Lakhs (Sample Asking)',
    plotAreaSqm: 410,
    builtUpAreaSqm: 235,
    bedrooms: 4,
    bathrooms: 3,
    floors: 2,
  },
  {
    title: 'Sample 3BHK Timber-Frame House with Garden Plot in Rengkai',
    propertyType: 'house_with_plot',
    hasPlot: true,
    price: 5400000,
    priceLabel: '₹54.00 Lakhs (Sample Asking)',
    plotAreaSqm: 360,
    builtUpAreaSqm: 185,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
  },
  {
    title: 'Sample Standalone 3BHK Townhouse (No Separate Plot) in Hiangtam',
    propertyType: 'house_without_plot',
    hasPlot: false,
    price: 3950000,
    priceLabel: '₹39.50 Lakhs (Sample Asking)',
    builtUpAreaSqm: 155,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
  },
  {
    title: 'Sample Compact 2BHK Independent Residence in Zenhang',
    propertyType: 'house_without_plot',
    hasPlot: false,
    price: 2900000,
    priceLabel: '₹29.00 Lakhs (Sample Asking)',
    builtUpAreaSqm: 118,
    bedrooms: 2,
    bathrooms: 2,
    floors: 1,
  },
  {
    title: 'Sample Pearsonmun Valley View Villa with Private Estate Land',
    propertyType: 'villa_with_land',
    hasPlot: true,
    price: 9200000,
    priceLabel: '₹92.00 Lakhs (Sample Asking)',
    plotAreaSqm: 780,
    builtUpAreaSqm: 310,
    bedrooms: 5,
    bathrooms: 4,
    floors: 2,
  },
  {
    title: 'Sample Lanva Eco-Bungalow with Orchard Plot',
    propertyType: 'villa_with_land',
    hasPlot: true,
    price: 7600000,
    priceLabel: '₹76.00 Lakhs (Sample Asking)',
    plotAreaSqm: 650,
    builtUpAreaSqm: 245,
    bedrooms: 4,
    bathrooms: 3,
    floors: 2,
  },
  {
    title: 'Sample 3BHK Modern Apartment at Lamka Heights Block B',
    propertyType: 'apartment',
    hasPlot: false,
    price: 4200000,
    priceLabel: '₹42.00 Lakhs (Sample Asking)',
    builtUpAreaSqm: 132,
    bedrooms: 3,
    bathrooms: 2,
    floorNumber: 3,
    totalFloors: 5,
  },
  {
    title: 'Sample 2BHK Sunny Flat near Tuibong Civic Centre',
    propertyType: 'apartment',
    hasPlot: false,
    price: 3150000,
    priceLabel: '₹31.50 Lakhs (Sample Asking)',
    builtUpAreaSqm: 98,
    bedrooms: 2,
    bathrooms: 2,
    floorNumber: 2,
    totalFloors: 4,
  },
  {
    title: 'Sample 1BHK Studio Apartment for Young Professionals (New Lamka)',
    propertyType: 'apartment',
    hasPlot: false,
    price: 2100000,
    priceLabel: '₹21.00 Lakhs (Sample Asking)',
    builtUpAreaSqm: 64,
    bedrooms: 1,
    bathrooms: 1,
    floorNumber: 4,
    totalFloors: 4,
  },
  {
    title: 'Sample Ground-Floor Retail Showroom Space on Tedim Demo Road',
    propertyType: 'commercial',
    hasPlot: false,
    price: 45000,
    priceLabel: '₹45,000 / month (Sample Lease)',
    builtUpAreaSqm: 145,
    floorNumber: 0,
    totalFloors: 3,
  },
  {
    title: 'Sample First-Floor Co-Working & Office Suite in Hiangtam',
    propertyType: 'commercial',
    hasPlot: false,
    price: 28000,
    priceLabel: '₹28,000 / month (Sample Lease)',
    builtUpAreaSqm: 110,
    floorNumber: 1,
    totalFloors: 3,
  },
  {
    title: 'Sample Student PG & Furnished Single Rooms near College Veng',
    propertyType: 'room_pg',
    hasPlot: false,
    price: 6500,
    priceLabel: '₹6,500 / month (Sample Rent)',
    builtUpAreaSqm: 24,
  },
  {
    title: 'Sample Executive Guest Suite & Working Professional PG (Rengkai)',
    propertyType: 'room_pg',
    hasPlot: false,
    price: 8500,
    priceLabel: '₹8,500 / month (Sample Rent)',
    builtUpAreaSqm: 32,
  },
];

const SPORTS_SEED = [
  ['Lamka Sample Synthetic Football Turf Arena', '5-a-side & 7-a-side Football', 'Turf Court', 180],
  ['Tuibong Sample Indoor Badminton Stadium', 'Badminton & Table Tennis', 'Indoor Arena', 240],
  ['Rengkai Sample Community Athletics Ground', 'Track & Field / Football', 'Outdoor Ground', 600],
  ['New Lamka Sample Basketball & Volleyball Court', 'Basketball & Volleyball', 'Outdoor Ground', 150],
  ['Hiangtam Sample Strength & Fitness Complex', 'Gymnasium & Cross-Training', 'Fitness Complex', 85],
  ['Bungmual Sample Futsal & Box Cricket Cage', 'Futsal & Box Cricket', 'Turf Court', 120],
  ['Pearsonmun Sample Archery & Outdoor Sports Field', 'Archery & Field Sports', 'Outdoor Ground', 200],
  ['Lanva Sample Martial Arts & Boxing Dojo', 'Boxing & Martial Arts', 'Indoor Arena', 90],
  ['Zenhang Sample Table Tennis & Chess Club', 'Table Tennis & Mind Sports', 'Indoor Arena', 70],
  ['Khuga Sample Cycling & Running Trailhead Hub', 'Trail Running & Cycling', 'Outdoor Ground', 160],
] as const;

export function createInitialListings(): Listing[] {
  const listings: Listing[] = [];

  // 1. 20 Businesses (biz-1 .. biz-20)
  BUSINESS_SEED.forEach(([title, subcat, desc], idx) => {
    const id = `biz-${idx + 1}`;
    const locality = SAMPLE_LOCALITIES[idx % SAMPLE_LOCALITIES.length];
    const coords = deterministicCoord(idx, 20, 0.018);
    const ownerId = idx < 12 ? 'owner-1' : 'owner-2';
    const ownerName =
      ownerId === 'owner-1'
        ? 'Thangboi Demo Enterprises (Owner)'
        : 'Lamka Sample Estates & Retail (Owner)';

    listings.push({
      id,
      title,
      category: 'business',
      subcategory: subcat,
      shortDescription: desc,
      description: `${desc} This synthetic record is part of the PrintSwift Local private prototype dataset around Churachandpur. All product catalogue items, prices, and contact details are illustrative sample data.`,
      locality,
      address: `Sample Building #${101 + idx}, ${locality}`,
      coordinates: coords,
      status: idx === 18 ? 'draft' : idx === 19 ? 'submitted' : 'published',
      verificationStatus: idx % 3 === 0 ? 'verified_demo' : 'unverified_sample',
      ownerId,
      ownerName,
      assignedStaffIds: idx < 3 ? ['staff-1', 'staff-2'] : [],
      contactPhone: `+91 90001 ${String(10000 + idx)}`,
      contactEmail: `contact.${id}@sample-printswift.local`,
      coverImage: createListingCoverSvg(title, 'business', locality, idx),
      galleryImages: [
        createListingCoverSvg(`${title} — Interior`, 'business', locality, idx + 30),
        createListingCoverSvg(`${title} — Display`, 'business', locality, idx + 60),
      ],
      rating: Number((4.1 + (idx % 9) * 0.1).toFixed(1)),
      reviewCount: 4 + (idx % 12),
      viewsCount: 240 + idx * 35,
      mapImpressionsCount: 680 + idx * 70,
      detailVisitsCount: 145 + idx * 19,
      followsCount: 18 + idx * 3,
      enquiriesCount: 5 + (idx % 7),
      directionClicksCount: 28 + idx * 4,
      updatedAt: '2026-11-04T09:30:00Z',
      createdAt: '2026-08-15T10:00:00Z',
      isFeaturedDemo: idx < 3,
      businessDetails: {
        subcategory: subcat,
        openingHours: 'Mon–Sat: 09:00 AM – 07:30 PM (Sample Hours)',
        priceRange: idx % 3 === 0 ? '₹' : idx % 3 === 1 ? '₹₹' : '₹₹₹',
        deliveryInfo: 'Sample in-store browsing only — No online checkout or delivery',
        establishedYear: 2015 + (idx % 10),
        highlights: ['Sample Verified Catalogue', 'Local Demo Listing', 'Wheelchair Accessible Entrance'],
        catalogue: [
          {
            id: `${id}-prod-1`,
            listingId: id,
            name: `${title.split(' ')[0]} Signature Pack A`,
            category: subcat.split(' ')[0],
            description: 'Synthetic demonstration catalogue item with sample specifications.',
            price: 350 + idx * 75,
            variants: ['Standard', 'Large Pack'],
            availability: 'in_stock',
            imageUrl: createProductSvg(`${title.split(' ')[0]} Pack A`, subcat, 350 + idx * 75, idx + 1),
            promotionLabel: idx % 2 === 0 ? 'Sample Featured Item' : undefined,
          },
          {
            id: `${id}-prod-2`,
            listingId: id,
            name: `${title.split(' ')[0]} Essential Kit B`,
            category: subcat.split(' ')[0],
            description: 'Illustrative sample product for testing search and catalogue filtering.',
            price: 780 + idx * 90,
            variants: ['Single Unit', 'Bundle of 3'],
            availability: idx % 4 === 0 ? 'low_stock' : 'in_stock',
            imageUrl: createProductSvg(`${title.split(' ')[0]} Kit B`, subcat, 780 + idx * 90, idx + 25),
          },
          {
            id: `${id}-prod-3`,
            listingId: id,
            name: `${title.split(' ')[0]} Pro Series C`,
            category: 'Premium Sample',
            description: 'High-durability sample item listed in the business catalogue.',
            price: 1450 + idx * 120,
            variants: ['Classic', 'Pro Edition'],
            availability: idx % 5 === 0 ? 'made_to_order' : 'in_stock',
            imageUrl: createProductSvg(`${title.split(' ')[0]} Pro C`, 'Premium Sample', 1450 + idx * 120, idx + 50),
          },
        ],
      },
      versionHistory: [
        {
          versionId: `${id}-v1`,
          timestamp: '2026-10-15T11:00:00Z',
          editorName: ownerName,
          editorRole: 'Listing Owner',
          summary: 'Initial synthetic listing created for prototype.',
          title,
          description: desc,
          status: 'published',
          coordinates: coords,
        },
      ],
    });
  });

  // 2. 20 Public-Interest & Community Places (pub-1 .. pub-20)
  PUBLIC_PLACE_SEED.forEach(([title, subcat, desc], idx) => {
    const id = `pub-${idx + 1}`;
    const locality = SAMPLE_LOCALITIES[(idx + 2) % SAMPLE_LOCALITIES.length];
    const coords = deterministicCoord(idx + 5, 20, 0.022);
    listings.push({
      id,
      title,
      category: 'public_place',
      subcategory: subcat,
      shortDescription: desc,
      description: `${desc} Note: This is an illustrative community place record created for the PrintSwift Local prototype. It does not represent an official government record or verified administrative facility.`,
      locality,
      address: `Civic Demo Sector ${idx + 1}, ${locality}`,
      coordinates: coords,
      status: 'published',
      verificationStatus: 'verified_demo',
      ownerId: 'owner-2',
      ownerName: 'Lamka Sample Estates & Retail (Owner)',
      assignedStaffIds: [],
      contactPhone: `+91 90002 ${String(20000 + idx)}`,
      contactEmail: `info.${id}@sample-printswift.local`,
      coverImage: createListingCoverSvg(title, 'public_place', locality, idx + 100),
      galleryImages: [
        createListingCoverSvg(`${title} — Main View`, 'public_place', locality, idx + 120),
      ],
      rating: Number((4.3 + (idx % 7) * 0.1).toFixed(1)),
      reviewCount: 3 + (idx % 8),
      viewsCount: 190 + idx * 22,
      mapImpressionsCount: 520 + idx * 45,
      detailVisitsCount: 110 + idx * 14,
      followsCount: 12 + idx * 2,
      enquiriesCount: 2 + (idx % 4),
      directionClicksCount: 34 + idx * 5,
      updatedAt: '2026-11-02T14:00:00Z',
      createdAt: '2026-08-20T10:00:00Z',
      publicPlaceDetails: {
        placeType: subcat,
        publicInfo: 'Open to the public for demonstration discovery. All schedules and notices shown are synthetic sample data.',
        facilities: ['Public Seating', 'Drinking Water Kiosk (Sample)', 'Ramp Access', 'Information Board'],
        openingHours: 'Daily: 08:00 AM – 06:00 PM (Sample Schedule)',
        verificationSourceLabel: 'Synthetic Prototype Record — Not an Official Government Entry',
        accessibilityNotes: 'Step-free ground access and clear directional signage (Illustrative).',
      },
      versionHistory: [
        {
          versionId: `${id}-v1`,
          timestamp: '2026-09-10T09:00:00Z',
          editorName: 'Platform Super Admin (Demo)',
          editorRole: 'Administrator',
          summary: 'Seeded public-interest demonstration record.',
          title,
          description: desc,
          status: 'published',
          coordinates: coords,
        },
      ],
    });
  });

  // 3. 15 Services & Providers (srv-1 .. srv-15)
  SERVICE_SEED.forEach(([title, subcat, desc], idx) => {
    const id = `srv-${idx + 1}`;
    const locality = SAMPLE_LOCALITIES[(idx + 4) % SAMPLE_LOCALITIES.length];
    const coords = deterministicCoord(idx + 3, 15, 0.019);
    const ownerId = idx < 8 ? 'owner-1' : 'owner-2';
    const ownerName =
      ownerId === 'owner-1'
        ? 'Thangboi Demo Enterprises (Owner)'
        : 'Lamka Sample Estates & Retail (Owner)';

    listings.push({
      id,
      title,
      category: 'service',
      subcategory: subcat,
      shortDescription: desc,
      description: `${desc} All service rates, coverage areas, and provider credentials are synthetic sample data for the PrintSwift Local prototype.`,
      locality,
      address: `Service Hub #${201 + idx}, ${locality}`,
      coordinates: coords,
      status: idx === 14 ? 'changes_requested' : 'published',
      changeRequestNote:
        idx === 14
          ? 'Please clarify synthetic service coverage hours for weekend calls.'
          : undefined,
      verificationStatus: idx % 2 === 0 ? 'verified_demo' : 'unverified_sample',
      ownerId,
      ownerName,
      assignedStaffIds: idx === 0 ? ['staff-1'] : [],
      contactPhone: `+91 90003 ${String(30000 + idx)}`,
      contactEmail: `service.${id}@sample-printswift.local`,
      coverImage: createListingCoverSvg(title, 'service', locality, idx + 200),
      galleryImages: [
        createListingCoverSvg(`${title} — Work Sample 1`, 'service', locality, idx + 220),
        createListingCoverSvg(`${title} — Work Sample 2`, 'service', locality, idx + 240),
      ],
      rating: Number((4.2 + (idx % 8) * 0.1).toFixed(1)),
      reviewCount: 5 + (idx % 9),
      viewsCount: 175 + idx * 28,
      mapImpressionsCount: 440 + idx * 55,
      detailVisitsCount: 98 + idx * 16,
      followsCount: 14 + idx * 2,
      enquiriesCount: 6 + (idx % 6),
      directionClicksCount: 19 + idx * 3,
      updatedAt: '2026-11-03T16:15:00Z',
      createdAt: '2026-08-25T10:00:00Z',
      serviceDetails: {
        serviceType: subcat,
        areasServed: [
          locality,
          SAMPLE_LOCALITIES[(idx + 1) % SAMPLE_LOCALITIES.length],
          SAMPLE_LOCALITIES[(idx + 3) % SAMPLE_LOCALITIES.length],
        ],
        workingHours: 'Mon–Sat: 08:30 AM – 06:30 PM',
        availabilityStatus: idx % 3 === 0 ? 'Available Today' : idx % 3 === 1 ? 'By Appointment' : 'Weekdays Only',
        startingPrice: 450 + idx * 100,
        priceRangeText: `₹${450 + idx * 100} – ₹${1800 + idx * 250} per visit (Sample Estimate)`,
        experienceYears: 4 + (idx % 9),
        workSamples: [
          'Completed 40+ synthetic residential maintenance projects (Sample)',
          'Standard safety and tool checklist verified in demo',
        ],
        certificationsLabel: 'Unverified Sample Trade Profile (Prototype Data)',
      },
      versionHistory: [
        {
          versionId: `${id}-v1`,
          timestamp: '2026-10-01T10:00:00Z',
          editorName: ownerName,
          editorRole: 'Listing Owner',
          summary: 'Created sample service provider listing.',
          title,
          description: desc,
          status: 'published',
          coordinates: coords,
        },
      ],
    });
  });

  // 4. 15 Real Estate Listings (re-1 .. re-15)
  REAL_ESTATE_SEED.forEach((item, idx) => {
    const id = `re-${idx + 1}`;
    const locality = SAMPLE_LOCALITIES[(idx + 1) % SAMPLE_LOCALITIES.length];
    const coords = deterministicCoord(idx + 2, 15, 0.021);
    const ownerId = idx < 8 ? 'owner-1' : 'owner-2';
    const ownerName =
      ownerId === 'owner-1'
        ? 'Thangboi Demo Enterprises (Owner)'
        : 'Lamka Sample Estates & Retail (Owner)';

    const showPlot =
      item.propertyType === 'plot_land' ||
      item.propertyType === 'house_with_plot' ||
      item.propertyType === 'villa_with_land';

    const boundaryPolygon = showPlot
      ? makeSampleBoundary(
          coords,
          0.00038 + (idx % 3) * 0.00008,
          0.00032 + (idx % 2) * 0.00007
        )
      : undefined;

    const propertyTypeLabels: Record<PropertyType, string> = {
      plot_land: 'Plot / Land',
      house_with_plot: 'House with Associated Plot',
      house_without_plot: 'House without Associated Plot',
      villa_with_land: 'Villa / Bungalow with Land',
      apartment: 'Apartment / Flat',
      commercial: 'Commercial Unit / Shop / Office',
      room_pg: 'Room / PG / Accommodation',
    };

    listings.push({
      id,
      title: item.title,
      category: 'real_estate',
      subcategory: propertyTypeLabels[item.propertyType],
      shortDescription: `${propertyTypeLabels[item.propertyType]} in ${locality} — ${item.priceLabel}. Includes mandatory 360° synthetic panorama.`,
      description: `Synthetic real-estate demonstration listing for ${item.title}. All area measurements default to square metres (m²). Any property polygons and 360° panoramas are illustrative sample media and do not represent legally surveyed land boundaries or real property photographs.`,
      locality,
      address: `Sample Plot/Unit #${301 + idx}, ${locality}`,
      coordinates: coords,
      status: idx === 14 ? 'pending_verification' : 'published',
      verificationStatus: idx % 2 === 0 ? 'verified_demo' : 'unverified_sample',
      ownerId,
      ownerName,
      assignedStaffIds: idx < 2 ? ['staff-1'] : [],
      contactPhone: `+91 90004 ${String(40000 + idx)}`,
      contactEmail: `property.${id}@sample-printswift.local`,
      coverImage: createListingCoverSvg(item.title, 'real_estate', locality, idx + 300),
      galleryImages: [
        createListingCoverSvg(`${item.title} — Exterior View`, 'real_estate', locality, idx + 320),
        createListingCoverSvg(`${item.title} — Interior / Site`, 'real_estate', locality, idx + 340),
      ],
      rating: Number((4.4 + (idx % 6) * 0.1).toFixed(1)),
      reviewCount: 2 + (idx % 6),
      viewsCount: 310 + idx * 42,
      mapImpressionsCount: 790 + idx * 65,
      detailVisitsCount: 195 + idx * 24,
      followsCount: 26 + idx * 4,
      enquiriesCount: 7 + (idx % 8),
      directionClicksCount: 31 + idx * 4,
      updatedAt: '2026-11-05T11:20:00Z',
      createdAt: '2026-09-01T10:00:00Z',
      isFeaturedDemo: idx < 2,
      realEstateDetails: {
        propertyType: item.propertyType,
        hasAssociatedPlot: showPlot,
        availability: idx === 12 ? 'under_negotiation' : 'available',
        askingPrice: item.price,
        priceLabel: item.priceLabel,
        // Plot fields ONLY when showPlot is true
        plotAreaSqm: showPlot ? item.plotAreaSqm : undefined,
        landType: showPlot
          ? idx === 1
            ? 'Agricultural'
            : 'Residential'
          : undefined,
        boundaryPolygon,
        dimensionsText: showPlot ? 'Approx. 22m × 24m (Illustrative Sample)' : undefined,
        roadAccess: showPlot ? '6.0m Wide Sample Approach Road' : undefined,
        roadFrontageMeters: showPlot ? 22 : undefined,
        terrainSlope: showPlot ? (idx % 2 === 0 ? 'Flat / Level' : 'Gentle Slope') : undefined,
        ownershipLabel: showPlot
          ? 'Seller-Provided Sample Ownership Statement (Unverified — Not Legally Surveyed)'
          : undefined,
        // Building fields when not plot_land
        builtUpAreaSqm: item.builtUpAreaSqm,
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms,
        floors: item.floors,
        floorNumber: item.floorNumber,
        totalFloors: item.totalFloors,
        constructionStatus:
          item.propertyType !== 'plot_land' ? 'Ready to Move' : undefined,
        furnishingStatus:
          item.propertyType === 'plot_land'
            ? undefined
            : idx % 2 === 0
              ? 'Semi-Furnished'
              : 'Fully Furnished',
        parking:
          item.propertyType !== 'plot_land'
            ? 'Covered 2-Wheeler & Car Parking (Sample)'
            : undefined,
        balcony:
          item.propertyType === 'apartment' ||
          item.propertyType === 'house_without_plot'
            ? true
            : undefined,
        liftAvailable: item.propertyType === 'apartment' ? true : undefined,
        propertyAgeYears: item.propertyType !== 'plot_land' ? 2 + (idx % 6) : undefined,
        maintenanceMonthly: item.propertyType === 'apartment' ? 1800 : undefined,
        commercialUse:
          item.propertyType === 'commercial' ? 'Retail Showroom / Office Suite' : undefined,
        unitType:
          item.propertyType === 'commercial' ? 'Self-Contained Commercial Unit' : undefined,
        frontageMeters: item.propertyType === 'commercial' ? 8.5 : undefined,
        powerWaterAvailability:
          item.propertyType === 'commercial'
            ? '3-Phase Demo Power & Dedicated Water Tank'
            : undefined,
        leaseTerms:
          item.propertyType === 'commercial'
            ? '11-Month Renewable Sample Agreement (Demo)'
            : undefined,
        roomType: item.propertyType === 'room_pg' ? 'Single Room' : undefined,
        occupancyCapacity: item.propertyType === 'room_pg' ? 2 : undefined,
        attachedBathroom: item.propertyType === 'room_pg' ? true : undefined,
        paymentFrequency: item.propertyType === 'room_pg' ? 'Monthly' : undefined,
        houseRules:
          item.propertyType === 'room_pg'
            ? ['Quiet hours after 10:00 PM (Sample)', 'No smoking indoors']
            : undefined,
        utilities: ['Municipal Water Connection (Sample)', 'Grid Electricity', 'Fibre Broadband Ready'],
        amenities:
          item.propertyType === 'plot_land'
            ? ['Corner Stone Markers (Sample)', 'Drainage Channel', 'Approach Road']
            : ['Solar Backup', 'Rainwater Harvesting', '24x7 Water Storage', 'Gated Entry'],
        streetViewAvailable: idx % 4 === 0,
        panoramas: [
          {
            id: `${id}-pano-1`,
            name: 'Panorama 1',
            imageUrl: createEquirectangularPanoramaSvg(
              item.title,
              'Panorama 1 — Primary 360° View',
              item.propertyType,
              0
            ),
            isPrimary: true,
            order: 1,
            width: 2048,
            height: 1024,
            isEquirectangular: true,
            isSyntheticDemo: true,
            sceneType: item.propertyType === 'plot_land' ? 'plot_survey' : 'interior',
            initialYaw: 0,
            initialPitch: 0,
          },
          {
            id: `${id}-pano-2`,
            name: 'Panorama 2',
            imageUrl: createEquirectangularPanoramaSvg(
              item.title,
              'Panorama 2 — Secondary Surround View',
              item.propertyType,
              1
            ),
            isPrimary: false,
            order: 2,
            width: 2048,
            height: 1024,
            isEquirectangular: true,
            isSyntheticDemo: true,
            sceneType: 'courtyard',
            initialYaw: 90,
            initialPitch: 0,
          },
        ],
      },
      versionHistory: [
        {
          versionId: `${id}-v1`,
          timestamp: '2026-10-05T12:00:00Z',
          editorName: ownerName,
          editorRole: 'Listing Owner',
          summary: 'Published synthetic real-estate record with mandatory 360° panoramas.',
          title: item.title,
          description: item.priceLabel,
          status: 'published',
          coordinates: coords,
        },
      ],
    });
  });

  // 5. 10 Sports & Recreational Venues (spt-1 .. spt-10)
  SPORTS_SEED.forEach(([title, sport, venueCat, cap], idx) => {
    const id = `spt-${idx + 1}`;
    const locality = SAMPLE_LOCALITIES[(idx + 3) % SAMPLE_LOCALITIES.length];
    const coords = deterministicCoord(idx + 1, 10, 0.017);
    listings.push({
      id,
      title,
      category: 'sports',
      subcategory: sport,
      shortDescription: `${venueCat} for ${sport} in ${locality}. Sample capacity: ${cap} participants/spectators.`,
      description: `Synthetic sports and recreation venue record for ${title}. Designed for exploring local athletic facilities in the PrintSwift Local prototype. No real booking or payment is active.`,
      locality,
      address: `Sports Complex Road #${401 + idx}, ${locality}`,
      coordinates: coords,
      status: 'published',
      verificationStatus: 'verified_demo',
      ownerId: 'owner-2',
      ownerName: 'Lamka Sample Estates & Retail (Owner)',
      assignedStaffIds: [],
      contactPhone: `+91 90005 ${String(50000 + idx)}`,
      contactEmail: `venue.${id}@sample-printswift.local`,
      coverImage: createListingCoverSvg(title, 'sports', locality, idx + 400),
      galleryImages: [
        createListingCoverSvg(`${title} — Pitch & Lighting`, 'sports', locality, idx + 420),
      ],
      rating: Number((4.5 + (idx % 5) * 0.1).toFixed(1)),
      reviewCount: 6 + (idx % 10),
      viewsCount: 260 + idx * 30,
      mapImpressionsCount: 610 + idx * 50,
      detailVisitsCount: 155 + idx * 18,
      followsCount: 22 + idx * 3,
      enquiriesCount: 4 + (idx % 5),
      directionClicksCount: 39 + idx * 5,
      updatedAt: '2026-11-01T18:00:00Z',
      createdAt: '2026-09-05T10:00:00Z',
      sportsDetails: {
        sportActivity: sport,
        venueCategory: venueCat,
        facilities: ['Floodlights (Sample)', 'Changing Rooms', 'Drinking Water', 'First-Aid Kit', 'Spectator Bench'],
        capacity: cap,
        openingHours: 'Daily: 06:00 AM – 09:00 PM (Sample Hours)',
        surfaceType: venueCat === 'Turf Court' ? 'FIFA-Grade Synthetic Turf (Sample)' : 'Multi-Sport Court Surface',
        accessNotes: 'Demonstration enquiry only — online slot booking disabled in prototype.',
      },
      versionHistory: [
        {
          versionId: `${id}-v1`,
          timestamp: '2026-09-20T10:00:00Z',
          editorName: 'Lamka Sample Estates & Retail (Owner)',
          editorRole: 'Listing Owner',
          summary: 'Initial synthetic sports venue listing.',
          title,
          description: sport,
          status: 'published',
          coordinates: coords,
        },
      ],
    });
  });

  return listings;
}

export const INITIAL_REVIEWS: ReviewRecord[] = [
  {
    id: 'rev-1',
    listingId: 'biz-1',
    listingTitle: 'Hilltop Sample Book & Craft Mart',
    authorName: 'Kimboi Sample Reviewer',
    rating: 5,
    comment: 'Well-organised sample stationery catalogue and helpful staff. Clearly labelled synthetic review.',
    createdAt: '2026-10-22',
    ownerReply: 'Thank you for visiting our sample bookstore! Glad the catalogue filter was useful.',
    ownerReplyUpdatedAt: '2026-10-23',
    reported: false,
    moderationStatus: 'approved',
  },
  {
    id: 'rev-2',
    listingId: 'biz-1',
    listingTitle: 'Hilltop Sample Book & Craft Mart',
    authorName: 'Lalrem Sample Visitor',
    rating: 4,
    comment: 'Good collection of sample art supplies and notebooks.',
    createdAt: '2026-11-01',
    reported: false,
    moderationStatus: 'approved',
  },
  {
    id: 'rev-3',
    listingId: 're-1',
    listingTitle: 'Sample Corner Residential Plot at Tuibong Ridge',
    authorName: 'Paumin Sample Explorer',
    rating: 5,
    comment: 'The 360° synthetic panorama and m² boundary map make it very clear how plot measurements work.',
    createdAt: '2026-10-28',
    ownerReply: 'Appreciated! All plot measurements are stored in m² with illustrative sample polygons.',
    ownerReplyUpdatedAt: '2026-10-29',
    reported: false,
    moderationStatus: 'approved',
  },
  {
    id: 'rev-4',
    listingId: 're-3',
    listingTitle: 'Sample 4BHK Family House with Walled Plot in New Lamka',
    authorName: 'Chingnu Sample User',
    rating: 4,
    comment: 'Helpful distinction between built-up area (235 m²) and plot area (410 m²).',
    createdAt: '2026-11-02',
    reported: false,
    moderationStatus: 'approved',
  },
  {
    id: 'rev-5',
    listingId: 'srv-1',
    listingTitle: 'Zogam Sample Electrical & Solar Technicians',
    authorName: 'Hauzel Demo Resident',
    rating: 5,
    comment: 'Prompt sample solar inverter inspection in our demonstration scenario.',
    createdAt: '2026-10-30',
    reported: true,
    reportReason: 'Sample flag test: Verify review does not contain external phone numbers.',
    moderationStatus: 'flagged',
  },
  {
    id: 'rev-6',
    listingId: 'spt-1',
    listingTitle: 'Lamka Sample Synthetic Football Turf Arena',
    authorName: 'Muan Sample Player',
    rating: 5,
    comment: 'Great evening floodlights in this sample venue listing.',
    createdAt: '2026-11-03',
    reported: false,
    moderationStatus: 'approved',
  },
];

export const INITIAL_ENQUIRIES: EnquiryRecord[] = [
  {
    id: 'enq-1',
    listingId: 're-1',
    listingTitle: 'Sample Corner Residential Plot at Tuibong Ridge',
    ownerId: 'owner-1',
    senderName: 'Ginlian Sample Enquirer',
    senderPhone: '+91 90009 11101',
    senderEmail: 'ginlian@sample-printswift.local',
    message: 'Hello, I inspected the 360° demo panorama and 520 m² plot boundary. Can we schedule a sample site discussion?',
    source: '360° Property Tour',
    createdAt: '2026-11-04T14:20:00Z',
    status: 'open',
    activityLog: [
      {
        id: 'act-1',
        timestamp: '2026-11-04T14:20:00Z',
        actor: 'Ginlian Sample Enquirer',
        action: 'Submitted demonstration enquiry via 360° Property Tour.',
      },
    ],
  },
  {
    id: 'enq-2',
    listingId: 'biz-1',
    listingTitle: 'Hilltop Sample Book & Craft Mart',
    ownerId: 'owner-1',
    senderName: 'Niangboi Sample Teacher',
    senderPhone: '+91 90009 11102',
    senderEmail: 'niangboi@sample-printswift.local',
    message: 'Do you have 25 units of the Signature Pack A in stock for a sample classroom demonstration?',
    source: 'Catalogue Item',
    createdAt: '2026-11-03T10:05:00Z',
    status: 'in_progress',
    ownerReply: 'Yes, we have sample stock available for inspection at our New Lamka demo counter.',
    repliedAt: '2026-11-03T11:30:00Z',
    activityLog: [
      {
        id: 'act-2a',
        timestamp: '2026-11-03T10:05:00Z',
        actor: 'Niangboi Sample Teacher',
        action: 'Submitted demonstration enquiry via Catalogue Item.',
      },
      {
        id: 'act-2b',
        timestamp: '2026-11-03T11:30:00Z',
        actor: 'Thangboi Demo Enterprises (Owner)',
        action: 'Saved demonstration reply and marked In Progress.',
      },
    ],
  },
  {
    id: 'enq-3',
    listingId: 'srv-1',
    listingTitle: 'Zogam Sample Electrical & Solar Technicians',
    ownerId: 'owner-1',
    senderName: 'Kaplian Sample Homeowner',
    senderPhone: '+91 90009 11103',
    senderEmail: 'kaplian@sample-printswift.local',
    message: 'Looking for a sample quote on cleaning a 3kW rooftop solar array in Tuibong.',
    source: 'Map Preview',
    createdAt: '2026-11-01T09:15:00Z',
    status: 'resolved',
    ownerReply: 'Shared illustrative maintenance checklist and sample estimate.',
    repliedAt: '2026-11-01T15:00:00Z',
    activityLog: [
      {
        id: 'act-3a',
        timestamp: '2026-11-01T09:15:00Z',
        actor: 'Kaplian Sample Homeowner',
        action: 'Submitted demonstration enquiry.',
      },
      {
        id: 'act-3b',
        timestamp: '2026-11-01T15:00:00Z',
        actor: 'Mercy Demo Agent (Delegated Staff)',
        action: 'Replied and marked Resolved.',
      },
    ],
  },
];

export const INITIAL_VERIFICATION_REQUESTS: VerificationRequest[] = [
  {
    id: 'ver-1',
    listingId: 're-15',
    listingTitle: 'Sample Executive Guest Suite & Working Professional PG (Rengkai)',
    category: 'real_estate',
    ownerId: 'owner-2',
    ownerName: 'Lamka Sample Estates & Retail (Owner)',
    submittedAt: '2026-11-05T08:00:00Z',
    evidenceSummary: 'Synthetic sample trade & property declaration #DEMO-904 (Not an official legal document).',
    status: 'pending',
  },
  {
    id: 'ver-2',
    listingId: 'biz-20',
    listingTitle: 'Lamka Eco Packaging & Paper Mart (Sample)',
    category: 'business',
    ownerId: 'owner-2',
    ownerName: 'Lamka Sample Estates & Retail (Owner)',
    submittedAt: '2026-11-04T16:45:00Z',
    evidenceSummary: 'Synthetic shop establishment sample form #DEMO-812.',
    status: 'pending',
  },
  {
    id: 'ver-3',
    listingId: 're-1',
    listingTitle: 'Sample Corner Residential Plot at Tuibong Ridge',
    category: 'real_estate',
    ownerId: 'owner-1',
    ownerName: 'Thangboi Demo Enterprises (Owner)',
    submittedAt: '2026-10-18T11:00:00Z',
    evidenceSummary: 'Synthetic plot demonstration file #DEMO-301.',
    status: 'approved',
    decisionReason: 'Approved as synthetic demonstration record for prototype testing.',
    decidedBy: 'Verification Officer (Demo)',
    decidedAt: '2026-10-19T14:10:00Z',
  },
];

export const INITIAL_MODERATION_CASES: ModerationCase[] = [
  {
    id: 'mod-1',
    targetType: 'review',
    targetId: 'rev-5',
    targetTitle: 'Review on Zogam Sample Electrical & Solar Technicians',
    reason: 'Automated check: Flagged for community moderator inspection.',
    reportedBy: 'Community Filter (Demo)',
    createdAt: '2026-11-02T12:00:00Z',
    status: 'open',
  },
  {
    id: 'mod-2',
    targetType: 'polygon',
    targetId: 're-2',
    targetTitle: 'Boundary Polygon on Sample Hillside Agricultural-Residential Land in Bungmual',
    reason: 'Routine geographic audit: Confirm illustrative sample polygon does not overlap road centreline.',
    reportedBy: 'Geographic Audit Check (Demo)',
    createdAt: '2026-11-03T15:30:00Z',
    status: 'open',
  },
];

export const INITIAL_DYNAMIC_FIELDS: DynamicFieldDefinition[] = [
  {
    id: 'df-1',
    category: 'business',
    name: 'parkingAvailable',
    label: 'Customer Parking Available (Sample Field)',
    fieldType: 'boolean',
    required: false,
    publicVisible: true,
    ownerEditable: true,
    adminOnly: false,
    filterable: true,
  },
  {
    id: 'df-2',
    category: 'real_estate',
    name: 'waterStorageLitres',
    label: 'Water Storage Capacity (Litres)',
    fieldType: 'number',
    required: false,
    publicVisible: true,
    ownerEditable: true,
    adminOnly: false,
    filterable: false,
  },
  {
    id: 'df-3',
    category: 'service',
    name: 'emergencyCallout',
    label: 'Same-Day Callout Support',
    fieldType: 'dropdown',
    required: false,
    publicVisible: true,
    ownerEditable: true,
    adminOnly: false,
    filterable: true,
    options: ['Yes (Within Locality)', 'By Prior Schedule Only', 'No'],
  },
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    recipientRole: 'owner',
    title: 'New Demonstration Enquiry Received',
    message: 'Ginlian Sample Enquirer sent an enquiry on Sample Corner Residential Plot at Tuibong Ridge.',
    type: 'enquiry',
    createdAt: '2026-11-04T14:20:00Z',
    read: false,
    linkListingId: 're-1',
  },
  {
    id: 'notif-2',
    recipientRole: 'owner',
    title: 'Change Requested on Service Listing',
    message: 'Moderator requested clarification of weekend hours on Central Lamka Sample Pest Control.',
    type: 'status_change',
    createdAt: '2026-11-03T16:15:00Z',
    read: false,
    linkListingId: 'srv-15',
  },
  {
    id: 'notif-3',
    recipientRole: 'admin',
    title: '2 Pending Verification Requests',
    message: 'Synthetic verification submissions awaiting review in the Verification Centre.',
    type: 'verification',
    createdAt: '2026-11-05T08:00:00Z',
    read: false,
  },
];

export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'aud-1',
    timestamp: '2026-11-05T11:20:00Z',
    actorId: 'owner-1',
    actorName: 'Thangboi Demo Enterprises (Owner)',
    actorRole: 'Listing Owner',
    workspace: 'owner',
    action: 'Updated Real-Estate Panorama Order',
    targetId: 're-1',
    targetName: 'Sample Corner Residential Plot at Tuibong Ridge',
    details: 'Confirmed Panorama 1 as primary 360° equirectangular view.',
  },
  {
    id: 'aud-2',
    timestamp: '2026-11-04T09:30:00Z',
    actorId: 'admin-verify',
    actorName: 'Verification Officer (Demo)',
    actorRole: 'Verification Officer',
    workspace: 'admin',
    action: 'Approved Demo Verification',
    targetId: 're-1',
    targetName: 'Sample Corner Residential Plot at Tuibong Ridge',
    details: 'Marked as verified demonstration record (synthetic evidence).',
  },
];
