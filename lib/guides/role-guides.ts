/**
 * Single Canonical 8-Role Guide Registry (Sprint v23a — P2-14)
 *
 * Pure data & types module.
 * IMPORTANT: ZERO imports from `components/workspaces/**` or `components/admin/**`
 * so public routes (`/guides`, `AssistantWidget`, `Header`) remain completely chunk-isolated.
 */

export type RoleGuideId =
  | 'visitor'
  | 'owner'
  | 'staff'
  | 'driver'
  | 'mediator'
  | 'hub_manager'
  | 'advertiser'
  | 'super_admin';

export interface RoleGuideChecklistItem {
  id: string;
  label: string;
  detail: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface RoleGuideWorkflow {
  id: string;
  title: string;
  category: string;
  flowBadges: string[];
  summary: string;
  steps: string[];
  proTip?: string;
  caution?: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface RoleGuideRule {
  id: string;
  title: string;
  badge: string;
  description: string;
}

export interface RoleGuideFaq {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  deepLinkUrl?: string;
  deepLinkLabel?: string;
}

export interface RoleGuideDefinition {
  id: RoleGuideId;
  title: string;
  shortTitle: string;
  tagline: string;
  audienceBadge: string;
  entryHref: string;
  entryLabel: string;
  quickChecklist: RoleGuideChecklistItem[];
  workflows: RoleGuideWorkflow[];
  rulesAndSafety: RoleGuideRule[];
  faqs: RoleGuideFaq[];
}

export const ROLE_GUIDE_ORDER: readonly RoleGuideId[] = [
  'visitor',
  'owner',
  'staff',
  'driver',
  'mediator',
  'hub_manager',
  'advertiser',
  'super_admin',
] as const;

export const ROLE_GUIDES_MAP: Record<RoleGuideId, RoleGuideDefinition> = {
  visitor: {
    id: 'visitor',
    title: 'Visitor & Customer Guide',
    shortTitle: 'Visitor & Customer',
    tagline:
      'Discover verified shops, order food & printouts, inspect real estate plots in Sangam/sq.ft, book seats or Pick N Drop couriers, and access 24×7 offline emergency helplines.',
    audienceBadge: 'Everyday Users & Customers',
    entryHref: '/explore',
    entryLabel: 'Open Explore Map',
    quickChecklist: [
      {
        id: 'visitor-chk-1',
        label: 'Sign in with Google or Email & complete 2-step Onboarding',
        detail:
          'Set your @username, +91 WhatsApp/phone number, and preferred locality so drivers and shops can coordinate smoothly.',
        ctaLabel: 'Open Onboarding',
        ctaHref: '/onboarding',
      },
      {
        id: 'visitor-chk-2',
        label: 'Explore the 3-Level Map & Zoom-to-Plot Real Estate Polygons',
        detail:
          'Filter by vertical or subcategory on /explore; zoom past level 16 on Real Estate listings to inspect drawn plot polygons in Sangam, Acre, Sq.Ft, or m².',
        ctaLabel: 'Explore Map',
        ctaHref: '/explore',
      },
      {
        id: 'visitor-chk-3',
        label: 'Understand Private Handover OTPs & Offline OTP Cache',
        detail:
          'Your Pickup, Dropoff, Return, and Check-In OTPs are private to you and cached automatically in IndexedDB for zero-signal areas.',
        ctaLabel: 'View Activity & OTPs',
        ctaHref: '/activity',
      },
      {
        id: 'visitor-chk-4',
        label: 'Configure Notification Categories in Settings',
        detail:
          'Customize per-category alerts (Orders, Logistics, Enquiries, Billing) while keeping urgent safety, OTP, and escrow alerts always active.',
        ctaLabel: 'Notification Settings',
        ctaHref: '/settings#notifications',
      },
      {
        id: 'visitor-chk-5',
        label: 'Bookmark 24×7 Offline Civic & Emergency Helplines',
        detail:
          'Visit /civic once to cache up to 120 verified hospital, ambulance, police, and utility contacts for offline use.',
        ctaLabel: 'Open Civic Directory',
        ctaHref: '/civic',
      },
    ],
    workflows: [
      {
        id: 'visitor-wf-explore-realestate',
        title: 'Map Discovery, 3-Level Categories & Real Estate Site Visits',
        category: 'Discovery & Real Estate',
        flowBadges: ['3-Level Filter', 'Zoom >= 16 Polygons', 'Visit Approval', 'Live Contact Unlock'],
        summary:
          'Browse verified businesses across 8 listing verticals and inspect land/rental properties with Manipur Sangam area conversions.',
        steps: [
          'Open /explore and tap any Level-1 category pill or expand the tray to filter by Level-2/Level-3 subcategories and "Open Now".',
          'For Real Estate plots and properties, zoom in to level 16+ to morph markers into drawn boundary polygons showing price and area in your preferred unit (Sangam, Sq.Ft, Acre, or m²).',
          'On privacy-guarded properties (contact_reveal_policy = after_visit_approval), tap "Request Site Visit" to pick a preferred date and time.',
          'The moment the property owner approves your visit, you receive an instant notification and the "Call Owner" button unlocks live without reloading.',
        ],
        proTip:
          'Long-press (850ms) anywhere on the /explore map to copy exact coordinates or set a custom Pick N Drop pin.',
        ctaLabel: 'Explore Map & Plots',
        ctaHref: '/explore',
      },
      {
        id: 'visitor-wf-pnd-vehicles',
        title: 'Pick N Drop Couriers, Scheduled Vehicles & UPI Escrow',
        category: 'Mobility & Logistics',
        flowBadges: ['Pin A & B', 'UPI UTR Proof', 'Mediator Verify', 'Asymmetric OTP Handover'],
        summary:
          'Book intra-hub parcel, passenger, or LPG trips and inter-hub Winger/Bolero/Sumo seats or full-vehicle charters with escrow protection.',
        steps: [
          'Open /explore?mode=pick_n_drop (or /vehicles for scheduled seats & charters) and lock your Pickup (Point A) and Dropoff (Point B).',
          'Review the server-calculated distance and fare across the 5 verified fleet tiers (Cycle Rickshaw, Scooty, E-Rickshaw, Mini Van, Pickup Truck).',
          'Pay via UPI and submit your 12-digit UTR reference (plus optional screenshot uploaded to the private payment-proofs vault).',
          'Once the Dispatch Mediator verifies your payment, a KYC-verified driver is assigned. Share the Pickup OTP at collection and the Dropoff OTP only when the parcel/trip arrives.',
        ],
        caution:
          'Never share your Dropoff OTP before the driver arrives at the destination—giving the Dropoff OTP marks delivery complete.',
        ctaLabel: 'Book Pick N Drop',
        ctaHref: '/explore?mode=pick_n_drop',
      },
      {
        id: 'visitor-wf-shops-food-print',
        title: '0%-Commission Shops, Restaurants, Print Upload & Bookings',
        category: 'Commerce & Print',
        flowBadges: ['Basket / PDF Upload', 'Shop UPI or Counter', 'Vaulted Collection OTP', 'Pick N Drop Option'],
        summary:
          'Order retail items, pure-veg/restaurant dishes, encrypted PDF printouts, or turf/hotel slots directly from local merchants.',
        steps: [
          'Browse /marketplace for retail products, restaurant dishes, and Print Pro centers, or visit /bookings for sports turfs, halls, and hotel stays.',
          'For Print Orders, upload your PDF (stored in the private print-documents vault with 5-minute signed links and automatic 48-hour post-collection purge).',
          'Choose Counter Pay, Direct Shop UPI, or Platform Escrow (where enabled) and optionally attach Pick N Drop doorstep delivery.',
          'Track live preparation milestones and retrieve your vaulted 6-digit Collection/Check-In OTP inside /activity.',
        ],
        proTip:
          'Even if your mobile data drops at the counter or stand, your active booking OTPs remain accessible inside /profile#offline-otps.',
        ctaLabel: 'Browse Marketplace',
        ctaHref: '/marketplace',
      },
      {
        id: 'visitor-wf-cancel-refund',
        title: 'Customer Cancellation & Escrow Refund Requests',
        category: 'Escrow & Support',
        flowBadges: ['Open Order Tracker', 'Request Cancellation', 'Mediator Review', 'Refund / Release'],
        summary:
          'Cancel unpaid bookings immediately or request a mediator-reviewed escrow refund if plans change after submitting UPI UTR.',
        steps: [
          'Open /activity, locate your Pick N Drop order or Vehicle Booking, and tap "Track / Details".',
          'Tap "Cancel / Request Refund" and provide a short reason.',
          'Unpaid orders cancel immediately. If you already submitted a UPI UTR or funded escrow, your request is flagged in the Dispatch Mediator queue for priority verification and refund settlement.',
        ],
        ctaLabel: 'Open My Activity',
        ctaHref: '/activity',
      },
    ],
    rulesAndSafety: [
      {
        id: 'visitor-rule-otp',
        title: 'Asymmetric Zero-Trust OTPs',
        badge: 'Customer-Only Vault',
        description:
          'Drivers and Dispatch Mediators can never view your raw OTP codes in the database. Drivers only verify codes you read aloud at handover (with a 5-attempt lockout guard).',
      },
      {
        id: 'visitor-rule-privacy',
        title: '48-Hour Private Document & POD Auto-Purge',
        badge: 'Privacy By Default',
        description:
          'Uploaded PDF print files (print-documents) and delivery Proof-of-Delivery photos (delivery-pods) live in private storage buckets and are automatically purged 48 hours after completion.',
      },
      {
        id: 'visitor-rule-auth',
        title: 'Google OAuth PKCE & Email/Password Auth',
        badge: 'No SMS OTP Required',
        description:
          'Sign in reliably using Google OAuth or Email/Password without waiting for carrier SMS OTPs. Your phone number is saved in your profile for delivery and enquiry coordination.',
      },
    ],
    faqs: [
      {
        id: 'visitor-faq-1',
        question: 'Where do I find my Pickup, Dropoff, or Print Collection OTP?',
        answer:
          'Open /activity (or /profile#offline-otps when offline). Every active Pick N Drop delivery, vehicle booking, print job, shop/food order, and room/turf booking displays its customer-only handover OTP badge.',
        keywords: ['otp', 'pickup otp', 'dropoff otp', 'collection otp', 'code', 'offline otp'],
        deepLinkUrl: '/activity',
        deepLinkLabel: 'Open Activity & OTPs',
      },
      {
        id: 'visitor-faq-2',
        question: 'How do I unlock a Real Estate owner’s phone number?',
        answer:
          'If a property uses "Reveal After Visit Approval", tap "Request Site Visit" on the listing page. As soon as the owner accepts your request, you receive a real-time alert and the "Call Owner" button unlocks immediately.',
        keywords: ['real estate', 'phone', 'contact', 'site visit', 'unlock', 'plot', 'sangam'],
        deepLinkUrl: '/explore',
        deepLinkLabel: 'Browse Properties on Map',
      },
      {
        id: 'visitor-faq-3',
        question: 'What happens if I need to cancel after paying via UPI?',
        answer:
          'Open the order in /activity and tap "Cancel / Request Refund". Your request is routed to the Dispatch Mediator Desk with a refund flag so the mediator can verify your UTR and process your refund.',
        keywords: ['cancel', 'refund', 'upi', 'utr', 'escrow', 'payment'],
        deepLinkUrl: '/activity',
        deepLinkLabel: 'Manage Active Orders',
      },
    ],
  },

  owner: {
    id: 'owner',
    title: 'Business Owner Guide',
    shortTitle: 'Business Owner',
    tagline:
      'Launch and manage listings across all 8 verticals, configure catalogues, menus, print matrices, bookings, and Sangam land polygons, manage subscriptions or Pay-Per renewals, and delegate staff.',
    audienceBadge: 'Merchants, Landlords & Service Providers',
    entryHref: '/workspace/owner',
    entryLabel: 'Open Owner Workspace',
    quickChecklist: [
      {
        id: 'owner-chk-1',
        label: 'Complete Business Partner Onboarding (/onboarding?track=business)',
        detail:
          'Submit your business profile and KYC documents (compressed client-side to WebP and stored in the private kyc-documents vault).',
        ctaLabel: 'Business Onboarding',
        ctaHref: '/onboarding?track=business',
      },
      {
        id: 'owner-chk-2',
        label: 'Create Your First Listing in the 4-Step Listing Editor',
        detail:
          'Choose your L1 vertical (General, Shop, Restaurant, Print, Real Estate, Hotel, Venue, or Civic), pin coordinates via MapCoordinatePicker, and upload WebP media.',
        ctaLabel: 'Open My Businesses',
        ctaHref: '/workspace/owner',
      },
      {
        id: 'owner-chk-3',
        label: 'Activate Your One-Time Free Trial, Plan, or Pay-Per Pass',
        detail:
          'Start on the Default Free Tier, activate a one-time free trial on eligible Pro plans, or purchase a Pay-Per pass for real estate plots or products.',
        ctaLabel: 'Plans & Billing',
        ctaHref: '/workspace/owner',
      },
      {
        id: 'owner-chk-4',
        label: 'Configure Shop UPI & Vertical Inventory (Menu, Print, Rooms, Plots)',
        detail:
          'Set your verified Shop UPI VPA, add products or dishes (or bulk CSV import), configure your Print rate matrix, or draw Real Estate plot boundaries.',
        ctaLabel: 'Manage Storefront',
        ctaHref: '/workspace/owner',
      },
      {
        id: 'owner-chk-5',
        label: 'Invite Delegated Staff by @username (`max_staff` Quota)',
        detail:
          'Search staff by @username (or exact phone/email) and assign granular permissions and vertical scopes without sharing your owner password.',
        ctaLabel: 'Manage Staff Team',
        ctaHref: '/workspace/owner',
      },
    ],
    workflows: [
      {
        id: 'owner-wf-listing-editor',
        title: 'Creating Listings Across 8 Verticals & Suggesting L3 Categories',
        category: 'Listings & Taxonomy',
        flowBadges: ['1. Core & Map Pin', '2. Vertical Setup', '3. WebP Media & 360°', '4. Staff & Submit'],
        summary:
          'Build rich listings with session-persisted drafts, automatic WebP compression, optional named 360° panoramas, and custom leaf category suggestions.',
        steps: [
          'In /workspace/owner, click "+ Create New Listing" to launch the 4-step ListingEditorModal (drafts save automatically in sessionStorage until submitted).',
          'Pick your locked Level-1 vertical and select an official Level-2/Level-3 category—or suggest a new Level-3 leaf category (up to 5 per 24 hours; usable immediately by you while pending Hub Manager review).',
          'Use MapCoordinatePicker to drop your exact pin. For Real Estate listings, draw your closed plot polygon on the map to auto-calculate area in Sangam, Acre, Sq.Ft, and m².',
          'Upload your 1:1 logo, 16:9 cover, gallery photos, and optional named 360° equirectangular views—all images compress automatically in-browser to WebP before upload.',
        ],
        proTip:
          '360° panoramas are completely optional and never block publication, even for Real Estate listings.',
        ctaLabel: 'Open Owner Workspace',
        ctaHref: '/workspace/owner',
      },
      {
        id: 'owner-wf-monetization',
        title: 'Default Free vs. One-Time Free Trial vs. Pro Plans & Pay-Per Renewals',
        category: 'Subscriptions & Pay-Per',
        flowBadges: ['Default Free Baseline', '1-Time Trial', 'Pro Subscription', 'Pay-Per Soft Expiry'],
        summary:
          'Understand how composable entitlements, public capability gates, and paid_until soft-expiry renewals work.',
        steps: [
          'Every owner starts with the Default Free Tier baseline so basic directory presence is never bricked.',
          'If you have not used your one-time trial (profiles.trial_used_at), you can activate an instant free trial on eligible Pro plans.',
          'Alternatively, use Pay-Per checkout for individual Real Estate plots (quoted dynamically by price slab + Sangam/sq.ft area band), Marketplace products, or Bulletins.',
          'When a Pay-Per item reaches its paid_until timestamp, it soft-expires from public discovery without deleting your data—renew in 1 tap from your workspace.',
        ],
        caution:
          'Changing your Shop UPI ID triggers re-verification; unchanged saves preserve your existing verified UPI status.',
        ctaLabel: 'View Plans & Quotas',
        ctaHref: '/workspace/owner',
      },
      {
        id: 'owner-wf-orders-enquiries',
        title: 'Fulfilling Vertical Orders, Site Visits, Enquiries & Reviews',
        category: 'Daily Operations',
        flowBadges: ['Realtime Alert', 'Verify Handover OTP', 'Approve Site Visit', 'Reply to Enquiry'],
        summary:
          'Process incoming shop baskets, kitchen tickets, encrypted PDF print jobs, room/turf check-ins, real estate visits, and customer messages.',
        steps: [
          'Watch your live Notification Bell or workspace tabs for new orders, bookings, site visit requests, enquiries, and reviews.',
          'For Print, Shop, Restaurant, and Venue/Hotel orders, verify the customer’s 6-digit handover/check-in OTP via the workspace verification modal (operators never see raw customer OTPs in the table).',
          'For Real Estate Visit Requests, tap "Approve Visit" to reveal your contact details to that verified buyer/tenant in real time.',
          'Reply to customer enquiries in /workspace/owner or /messages (persisted via reply_to_enquiry RPC and sent directly to the customer’s Bell inbox).',
        ],
        ctaLabel: 'Manage Orders & Enquiries',
        ctaHref: '/workspace/owner',
      },
      {
        id: 'owner-wf-staff-delegation',
        title: 'Delegating Staff with Granular Permissions & Scopes',
        category: 'Team Management',
        flowBadges: ['Search @username', 'Pick Scopes & Permissions', 'Quota Guard (max_staff)', 'Audit Logged'],
        summary:
          'Invite cashiers, print operators, kitchen managers, or property agents to operate specific listings safely.',
        steps: [
          'Open the Staff Delegation tab in /workspace/owner (or Step 4 of ListingEditorModal).',
          'Search for your team member by @username (or exact phone/email via lookup_user_for_delegation).',
          'Toggle specific permissions (can_edit_details, can_manage_media, can_manage_catalogue, can_reply_enquiries, can_reply_reviews) and vertical scopes (print_queue, booking_checkin, kitchen_shop_stock, property_visits).',
          'Active staff count is enforced server-side against your plan’s max_staff limit, and closing/archiving a parent listing automatically suspends its delegations.',
        ],
        ctaLabel: 'Open Team Delegation',
        ctaHref: '/workspace/owner',
      },
    ],
    rulesAndSafety: [
      {
        id: 'owner-rule-capabilities',
        title: 'Public Capability Gating',
        badge: 'Automatic UI Sync',
        description:
          'Public listing pages call get_listing_public_capabilities() so "Order Online", "Upload Print", or "Book Slot" buttons appear automatically when your entitlement and payment mode are active—and fall back to Call/WhatsApp/Enquire otherwise.',
      },
      {
        id: 'owner-rule-staff-lock',
        title: 'Owner-Only Billing & Payment Locks',
        badge: 'RLS Protected',
        description:
          'Delegated staff inherit your listing’s active Pro capabilities to fulfill orders, but RLS and triggers strictly block staff from altering payment_mode, Shop UPI VPA, listing_vertical, or hub_id.',
      },
    ],
    faqs: [
      {
        id: 'owner-faq-1',
        question: 'Why aren’t my Shop Products or Restaurant Dishes showing online ordering?',
        answer:
          'Ensure your account has an active commerce entitlement (via Pro plan, active trial, or Pay-Per pass), your listing status is published/active, and your payment mode / Shop UPI is configured.',
        keywords: ['shop', 'restaurant', 'menu', 'catalogue', 'online order', 'entitlement', 'plan'],
        deepLinkUrl: '/workspace/owner',
        deepLinkLabel: 'Check Owner Entitlements',
      },
      {
        id: 'owner-faq-2',
        question: 'Can I suggest a new subcategory if mine isn’t in the list?',
        answer:
          'Yes. In the 3-level Category Picker inside ListingEditorModal, you can suggest up to 5 new Level-3 leaf categories per 24 hours. Your listing can use it right away while your Hub Manager reviews it for public promotion.',
        keywords: ['category', 'subcategory', 'suggest', 'leaf', 'taxonomy'],
        deepLinkUrl: '/workspace/owner',
        deepLinkLabel: 'Open Listing Editor',
      },
    ],
  },

  staff: {
    id: 'staff',
    title: 'Delegated Staff Guide',
    shortTitle: 'Delegated Staff',
    tagline:
      'Operate assigned shops, print desks, kitchens, reception counters, and property visits inside /workspace/staff using your owner’s entitlements.',
    audienceBadge: 'Store Managers, Cashiers & Agents',
    entryHref: '/workspace/staff',
    entryLabel: 'Open Staff Desk',
    quickChecklist: [
      {
        id: 'staff-chk-1',
        label: 'Share Your @username with Your Business Owner',
        detail:
          'Ensure your @username and +91 phone are saved in /profile/edit so the business owner can invite you.',
        ctaLabel: 'Check My @username',
        ctaHref: '/profile/edit',
      },
      {
        id: 'staff-chk-2',
        label: 'Open /workspace/staff & Select Your Assigned Business',
        detail:
          'Switch to the Staff Desk hat and select which delegated business storefront you are operating.',
        ctaLabel: 'Open Staff Desk',
        ctaHref: '/workspace/staff',
      },
      {
        id: 'staff-chk-3',
        label: 'Review Your Active Permissions & Vertical Scopes',
        detail:
          'Check the badges on your Staff card (print_queue, booking_checkin, kitchen_shop_stock, property_visits, enquiries).',
        ctaLabel: 'View Assigned Scopes',
        ctaHref: '/workspace/staff',
      },
      {
        id: 'staff-chk-4',
        label: 'Keep Notification Bell Active for Team & Order Alerts',
        detail:
          'You receive instant Realtime notifications whenever a new order, booking, enquiry, or delegation update occurs on your assigned listing.',
        ctaLabel: 'Notification Preferences',
        ctaHref: '/settings#notifications',
      },
    ],
    workflows: [
      {
        id: 'staff-wf-daily-ops',
        title: 'Fulfilling Print Queues, Kitchen/Shop Orders & Booking Check-Ins',
        category: 'Counter & Queue Operations',
        flowBadges: ['Select Assigned Business', 'Process Queue', 'Verify Customer OTP', 'Complete Handover'],
        summary:
          'Run day-to-day counter operations across your permitted vertical scopes without needing owner credentials.',
        steps: [
          'Open /workspace/staff and pick the active listing from the Business Selector.',
          'If granted print_queue, download customer PDFs via short-lived 5-minute signed links, mark print jobs Ready, and verify the customer’s 6-digit Collection OTP at pickup.',
          'If granted kitchen_shop_stock, toggle product/dish stock availability, update item prices, and advance shop or restaurant order statuses.',
          'If granted booking_checkin or property_visits, verify guest Check-In OTPs for rooms/turfs or approve scheduled Real Estate site visits.',
        ],
        proTip:
          'Your Staff Desk automatically inherits the parent owner’s active subscription capabilities for that listing.',
        ctaLabel: 'Launch Staff Desk',
        ctaHref: '/workspace/staff',
      },
      {
        id: 'staff-wf-edit-enquiries',
        title: 'Editing Listing Details/Media & Replying to Customer Enquiries',
        category: 'Content & Customer Care',
        flowBadges: ['can_edit_details', 'can_manage_media', 'can_reply_enquiries', 'can_reply_reviews'],
        summary:
          'Update opening hours, gallery photos, and respond to customer enquiries or reviews when permitted by the owner.',
        steps: [
          'When granted can_edit_details or can_manage_media, open the Listing Editor in Staff Mode to update descriptions, hours, or compressed WebP gallery images.',
          'When granted can_reply_enquiries or the enquiries scope, reply to customer enquiries directly—your reply is saved to Supabase and notifies the customer immediately.',
          'When granted can_reply_reviews, post official merchant responses to customer reviews.',
        ],
        caution:
          'Billing controls, subscription upgrades, Pay-Per checkouts, Shop UPI VPA, and vertical switching are hidden and locked to the Business Owner.',
        ctaLabel: 'Open Staff Workspace',
        ctaHref: '/workspace/staff',
      },
    ],
    rulesAndSafety: [
      {
        id: 'staff-rule-rls',
        title: 'Database-Enforced Scope & Lifecycle Guards',
        badge: 'staff_has_listing_grant()',
        description:
          'Every database update checks your live staff_delegations row for active status, matching permission/scope key, and parent listing lifecycle_status IN (active, draining).',
      },
      {
        id: 'staff-rule-billing',
        title: 'Zero Financial Liability or UPI Tampering',
        badge: 'Guard Trigger',
        description:
          'Database triggers (guard_staff_listing_mutations_v18a) prevent staff sessions from modifying payment_mode, shop UPI addresses, verification flags, or ownership.',
      },
    ],
    faqs: [
      {
        id: 'staff-faq-1',
        question: 'Why did my Staff assignment change to "Suspended"?',
        answer:
          'If the business owner temporarily archives or closes the parent listing, all staff delegations on that listing automatically pause (suspended_parent_closed) until the owner reactivates the business.',
        keywords: ['staff', 'suspended', 'revoked', 'delegation', 'access'],
        deepLinkUrl: '/workspace/staff',
        deepLinkLabel: 'Check Staff Desk',
      },
      {
        id: 'staff-faq-2',
        question: 'Why can’t I change the Shop UPI ID or buy a subscription plan as Staff?',
        answer:
          'Financial settings, UPI payout addresses, and subscription/Pay-Per purchases are restricted strictly to the Business Owner account for security.',
        keywords: ['staff', 'upi', 'payment', 'plan', 'subscription', 'locked'],
        deepLinkUrl: '/workspace/staff',
        deepLinkLabel: 'Open Staff Desk',
      },
    ],
  },

  driver: {
    id: 'driver',
    title: 'Driver & Fleet Operator Guide',
    shortTitle: 'Driver & Fleet',
    tagline:
      'Accept escrow-funded Pick N Drop jobs across 5 fleet tiers, verify asymmetric handover OTPs, upload <=250KB WebP Proof-of-Delivery photos, and manage scheduled commuter vehicles & charters.',
    audienceBadge: 'Riders, Drivers & Charter Operators',
    entryHref: '/workspace/driver',
    entryLabel: 'Open Driver Console',
    quickChecklist: [
      {
        id: 'driver-chk-1',
        label: 'Submit Driver KYC & Pick Your Canonical Fleet Tier',
        detail:
          'Apply via /onboarding?track=driver with your driving license number (license_no) and vehicle class (Cycle Rickshaw, Scooty, E-Rickshaw, Mini Van, or Pickup Truck).',
        ctaLabel: 'Driver KYC Onboarding',
        ctaHref: '/onboarding?track=driver',
      },
      {
        id: 'driver-chk-2',
        label: 'Toggle Online & Available in Driver Console',
        detail:
          'Go online inside /workspace/driver so escrow-funded Pick N Drop jobs in your hub appear on your live Job Board.',
        ctaLabel: 'Open Driver Console',
        ctaHref: '/workspace/driver',
      },
      {
        id: 'driver-chk-3',
        label: 'Verify Handover OTPs & Upload Compressed WebP PODs',
        detail:
          'Enter the sender’s Pickup OTP at collection, then enter the recipient’s Dropoff OTP and snap a Proof-of-Delivery photo (auto-compressed <= 250 KB WebP) at delivery.',
        ctaLabel: 'Active Trips Desk',
        ctaHref: '/workspace/driver',
      },
      {
        id: 'driver-chk-4',
        label: 'List Scheduled Vehicles, Fixed Routes & Charter Stand Pins',
        detail:
          'Add your Winger, Bolero, Sumo, Bus, or Taxi under Vehicles & Charters with stand locality presets, MapCoordinatePicker pin, and per-seat/full-charter rates.',
        ctaLabel: 'Manage Vehicles & Charters',
        ctaHref: '/workspace/driver',
      },
    ],
    workflows: [
      {
        id: 'driver-wf-pnd-lifecycle',
        title: 'Claiming Pick N Drop Jobs, Zero-Trust OTPs & WebP POD Upload',
        category: 'Pick N Drop Dispatch',
        flowBadges: ['Claim Escrow Job', 'Pickup OTP', 'Dropoff OTP + <=250KB WebP POD', 'Escrow Payout'],
        summary:
          'Execute parcel, passenger, and LPG trips safely with atomic job locking and zero-trust OTP verification.',
        steps: [
          'Open /workspace/driver and toggle your duty status to Online. The Job Board lists funded orders matching your hub and fleet class.',
          'Tap "Accept Job" (atomic FOR UPDATE lock via driver_accept_job RPC) or accept jobs dispatched to you by a Mediator.',
          'At pickup, ask the sender for their 6-digit Pickup OTP and verify it via driver_verify_handover_otp—the trip advances to Picked Up / In Transit.',
          'At dropoff, verify the recipient’s 6-digit Dropoff OTP (and Return OTP for two-way trips) and capture a Proof-of-Delivery photo (automatically compressed client-side to <=250KB WebP into private delivery-pods storage).',
        ],
        caution:
          '5 consecutive wrong OTP attempts lock verification for 15 minutes. Never leave a parcel without completing Dropoff OTP verification.',
        ctaLabel: 'Open Driver Job Board',
        ctaHref: '/workspace/driver',
      },
      {
        id: 'driver-wf-scheduled-vehicles',
        title: 'Managing Scheduled Vehicles, Seat Routes, Availability Blocks & Charters',
        category: 'Scheduled Fleet',
        flowBadges: ['Stand Locality Pin', 'Per-Seat / Full Charter / Both', 'Calendar Blocks', 'Start & End OTPs'],
        summary:
          'Publish commuter vehicles and private charters on /vehicles and /bookings with conflict-free calendar blocks.',
        steps: [
          'In /workspace/driver, open the "Vehicles & Charters" tab and click "+ Add Vehicle Listing".',
          'Pick your vehicle type, booking mode (per_seat, full_vehicle, or both), stand locality (using quick locality chips or custom stand), and exact stand coordinates via MapCoordinatePicker.',
          'Add fixed commuter routes (Origin → Destination with per-seat & full-vehicle fare) or hourly/daily/per-km charter rates, plus compressed WebP vehicle photos.',
          'Add offline maintenance/personal availability blocks so customers never double-book, and verify passenger Start OTP / End OTP on trip day.',
        ],
        proTip:
          'Every public vehicle page (/vehicles/[id]) automatically generates a rich WhatsApp share card showing your vehicle photo, fare summary, and stand locality.',
        ctaLabel: 'Open Vehicles & Charters',
        ctaHref: '/workspace/driver',
      },
    ],
    rulesAndSafety: [
      {
        id: 'driver-rule-otp',
        title: 'Zero-Trust OTP Milestones Only',
        badge: 'get_driver_trip_otp_milestones',
        description:
          'Driver apps never query delivery_order_secrets or vehicle_booking_otps. You only see boolean verification milestones (Pickup Verified, Dropoff Verified) and submit customer-provided codes to the server RPC.',
      },
      {
        id: 'driver-rule-pod',
        title: 'Private Path-Confined POD Storage & 48h Purge',
        badge: 'delivery-pods RLS',
        description:
          'POD photos upload strictly to your assigned order folder inside the private delivery-pods bucket after OTP verification and auto-purge 48 hours after completion (unless a dispute is active).',
      },
    ],
    faqs: [
      {
        id: 'driver-faq-1',
        question: 'When is my driver payout released after I complete a trip?',
        answer:
          'Once you verify the Dropoff OTP and upload the POD photo, the trip moves to the Dispatch Mediator Escrow Queue. The mediator inspects the milestone/POD and releases your net driver payout.',
        keywords: ['driver', 'payout', 'earnings', 'escrow', 'release', 'pod'],
        deepLinkUrl: '/workspace/driver',
        deepLinkLabel: 'View Earnings & Payouts',
      },
      {
        id: 'driver-faq-2',
        question: 'What happens if I need to release a claimed trip before pickup?',
        answer:
          'You can release an unstarted trip back to the dispatch pool via driver_update_trip_status. Funded orders return to escrow_held for reassignment; unpaid orders return to awaiting_payment.',
        keywords: ['driver', 'release', 'cancel', 'unassign', 'trip'],
        deepLinkUrl: '/workspace/driver',
        deepLinkLabel: 'Open Active Trips',
      },
    ],
  },

  mediator: {
    id: 'mediator',
    title: 'Dispatch Mediator Guide',
    shortTitle: 'Dispatch Mediator',
    tagline:
      'Run the live 10-minute UPI verification queue, inspect private signed receipt proofs, dispatch drivers, monitor >15m SLA breaches, audit 60s signed PODs, and settle or refund escrow.',
    audienceBadge: 'Logistics & Escrow Operations Desk',
    entryHref: '/workspace/mediator',
    entryLabel: 'Open Mediator Desk',
    quickChecklist: [
      {
        id: 'mediator-chk-1',
        label: 'Monitor the 10-Minute UPI Verification Queue',
        detail:
          'Verify incoming 12-digit UTRs and open 120-second signed receipt proof images from the private payment-proofs vault.',
        ctaLabel: 'Open Verification Queue',
        ctaHref: '/workspace/mediator',
      },
      {
        id: 'mediator-chk-2',
        label: 'Watch the >15-Minute Unclaimed Dispatch SLA Banner',
        detail:
          'Funded Pick N Drop orders waiting >15 minutes without a driver trigger an urgent SLA alert for manual driver assignment.',
        ctaLabel: 'Live Dispatch Board',
        ctaHref: '/workspace/mediator',
      },
      {
        id: 'mediator-chk-3',
        label: 'Audit Zero-Secret OTP Milestones & 60s Signed PODs',
        detail:
          'Check pickup/dropoff verification timestamps and inspect private Proof-of-Delivery photos before releasing funds.',
        ctaLabel: 'Escrow & POD Audit',
        ctaHref: '/workspace/mediator',
      },
      {
        id: 'mediator-chk-4',
        label: 'Settle Driver Payouts, Freeze Disputes, or Refund Customers',
        detail:
          'Use mediator_resolve_escrow_payout with required confirmation notes to release payouts, freeze disputed orders, or refund cancelled bookings.',
        ctaLabel: 'Open Escrow Queue',
        ctaHref: '/workspace/mediator',
      },
    ],
    workflows: [
      {
        id: 'mediator-wf-upi-verify',
        title: 'Verifying Manual UPI UTRs & Private Receipt Proofs (10m SLA)',
        category: 'Payment Verification',
        flowBadges: ['12-Digit UTR Check', '120s Signed Proof URL', 'Customer Cancel Flag Check', 'Escrow Held'],
        summary:
          'Approve or reject customer UPI submissions across Pick N Drop orders and Scheduled Vehicle bookings.',
        steps: [
          'Open /workspace/mediator to view the Verification Queue sorted by submission time with live SLA timers.',
          'Check the normalized 12-digit UTR (protected by partial unique active UTR replay indexes on payment_intents and delivery_transactions).',
          'Click "View Receipt Proof" to generate a 120-second signed URL from the private payment-proofs bucket and cross-check bank credit.',
          'If a customer requested cancellation while payment was pending, a highlighted "Cancellation / Refund Requested" badge appears so you can reject/refund cleanly instead of dispatching.',
        ],
        caution:
          'Every approve or reject action requires <ConfirmDialog /> confirmation and writes an immutable 13-column row to public.audit_logs.',
        ctaLabel: 'Open UPI Verification Desk',
        ctaHref: '/workspace/mediator',
      },
      {
        id: 'mediator-wf-dispatch-sla',
        title: 'Manual Driver Dispatch, Fleet Filtering & >15m SLA Escalation',
        category: 'Fleet Dispatch',
        flowBadges: ['Escrow Funded', '>15m SLA Breach Alert', 'Filter Online Fleet Tier', 'Assign / Reassign Driver'],
        summary:
          'Keep intra-hub deliveries moving when self-claim volume is high or an order breaches the 15-minute claim window.',
        steps: [
          'Switch to the Live Dispatch tab in /workspace/mediator to see all escrow_held, driver_assigned, picked_up, and in_transit orders.',
          'Orders waiting >15 minutes after payment verification surface in the SLA Breach alert bar (via get_pnd_dispatch_sla_breaches).',
          'Filter KYC-approved drivers by fleet class (Cycle Rickshaw, Scooty, E-Rickshaw, Mini Van, Pickup Truck) and Online status, then click "Assign Driver" (mediator_dispatch_driver).',
        ],
        ctaLabel: 'Open Live Dispatch',
        ctaHref: '/workspace/mediator',
      },
      {
        id: 'mediator-wf-escrow-settlement',
        title: 'POD Inspection, Escrow Payout Release, Freeze & Customer Refunds',
        category: 'Escrow Settlement',
        flowBadges: ['Zero-Secret OTP Badges', '60s Signed POD Viewer', 'Release Payout / Freeze / Refund', 'Audit Trail'],
        summary:
          'Settle completed trips and vehicle charters or resolve customer cancellations and disputes safely.',
        steps: [
          'In the Escrow & Settlement queue, verify that Pickup and Dropoff OTP milestones show green verified timestamps (via get_mediator_otp_milestones).',
          'Open the 60-second signed Proof-of-Delivery photo from delivery-pods to confirm parcel/trip completion.',
          'Click "Release Payout" to credit the driver, "Freeze / Dispute" to pause 48h POD auto-purge during an investigation, or "Refund Customer" on funded orders that were cancelled before fulfillment.',
          'Completed vehicle charters whose escrow_status is still escrow_held remain visible in the queue until explicitly released.',
        ],
        proTip:
          'Database guards block double-payouts, refund-after-payout, or releasing funds on orders without a verified customer payment and assigned driver.',
        ctaLabel: 'Open Escrow Settlement',
        ctaHref: '/workspace/mediator',
      },
    ],
    rulesAndSafety: [
      {
        id: 'mediator-rule-zero-otp',
        title: 'Strict Zero-Plaintext OTP Separation',
        badge: 'RLS Enforced (v21a)',
        description:
          'Mediators have zero SELECT access to delivery_order_secrets or vehicle_booking_otps and cannot call verify_delivery_otp. Mediators only read verified timestamp milestones.',
      },
      {
        id: 'mediator-rule-hub-scope',
        title: 'Hub-Scoped Mediator Authorization',
        badge: 'is_hub_manager_for(hub_id)',
        description:
          'All mediator RPCs (mediator_verify_upi_payment, mediator_dispatch_driver, mediator_resolve_escrow_payout) enforce hub scope and log every action to public.audit_logs (workspace = mediator).',
      },
    ],
    faqs: [
      {
        id: 'mediator-faq-1',
        question: 'Can a mediator read a customer’s OTP over the phone if the driver asks?',
        answer:
          'No. By security design, mediators cannot view plaintext OTPs. Only the customer can view their OTP in /activity (or their offline profile cache) and read it to the driver at handover.',
        keywords: ['mediator', 'otp', 'driver', 'secret', 'handover'],
        deepLinkUrl: '/workspace/mediator',
        deepLinkLabel: 'Open Mediator Desk',
      },
      {
        id: 'mediator-faq-2',
        question: 'Does freezing a disputed order stop the 48-hour POD photo deletion?',
        answer:
          'Yes. Both purge_expired_delivery_pods() and /api/system/purge-media explicitly skip orders with status = disputed so POD photo evidence is preserved until the dispute is resolved.',
        keywords: ['dispute', 'freeze', 'pod', 'purge', '48h', 'evidence'],
        deepLinkUrl: '/workspace/mediator',
        deepLinkLabel: 'Open Escrow Desk',
      },
    ],
  },

  hub_manager: {
    id: 'hub_manager',
    title: 'Hub Manager Guide (Zone-Scoped Governance)',
    shortTitle: 'Hub Manager',
    tagline:
      'Operate regional moderation, partner KYC approvals, local suggested leaf categories, vehicle stands, bulletins, Official DD oodle print hubs, and escalated disputes strictly within your assigned hub_id.',
    audienceBadge: 'Regional City / District Operations Lead',
    entryHref: '/workspace/hub',
    entryLabel: 'Open Hub Manager Console',
    quickChecklist: [
      {
        id: 'hub-chk-1',
        label: 'Verify Assigned Hub Scope (`hub_managers.profile_id`)',
        detail:
          'Confirm your assigned service hub (e.g., Churachandpur or Aizawl) and active permissions (can_confirm_manual_payments, can_edit_rates) at the top of /workspace/hub.',
        ctaLabel: 'Open Hub Console',
        ctaHref: '/workspace/hub',
      },
      {
        id: 'hub-chk-2',
        label: 'Review Pending Partner, Driver & Advertiser KYC Applications',
        detail:
          'Inspect 120-second signed KYC documents from kyc-documents and approve, request changes, or reject (auto-purging rejected KYC blobs).',
        ctaLabel: 'Partner KYC Queue',
        ctaHref: '/workspace/hub',
      },
      {
        id: 'hub-chk-3',
        label: 'Moderate Local Listings, Vehicle Stands & Community Bulletins',
        detail:
          'Approve or reject submitted listings (/api/listings/review), verify local commuter vehicles, and moderate flagged bulletins in your hub.',
        ctaLabel: 'Moderation Queues',
        ctaHref: '/workspace/hub',
      },
      {
        id: 'hub-chk-4',
        label: 'Triage Local User-Suggested Level-3 Leaf Categories',
        detail:
          'Approve or reject local L3 category suggestions via hub_triage_suggested_category (global canonical category merges remain Superadmin-only).',
        ctaLabel: 'Triage Categories',
        ctaHref: '/workspace/hub',
      },
    ],
    workflows: [
      {
        id: 'hub-wf-kyc-listings',
        title: 'Reviewing Local Partner KYC & Business Listing Submissions',
        category: 'Regional KYC & Directory',
        flowBadges: ['120s Signed KYC Viewer', 'Approve + Auto-Trial', 'Reject + Blob Hard-Delete', 'Owner Notification'],
        summary:
          'Onboard verified local businesses, drivers, and advertisers while keeping storage free of rejected or orphaned files.',
        steps: [
          'Open /workspace/hub and navigate to Partner Applications or Listing Reviews.',
          'For KYC applications, inspect uploaded ID/license/shop proofs via 120-second signed URLs and use the highlighted Call/WhatsApp button if callback verification is needed.',
          'Approving a partner application promotes their role/hat and triggers one-time trial eligibility if configured; rejecting via POST /api/onboarding/review hard-deletes rejected storage blobs and notifies the applicant.',
          'Approving a pending listing via POST /api/listings/review promotes staged media to permanent_bound; rejecting scrubs media URLs and deletes temporary storage blobs.',
        ],
        ctaLabel: 'Open Hub Manager Console',
        ctaHref: '/workspace/hub',
      },
      {
        id: 'hub-wf-taxonomy-vehicles-bulletins',
        title: 'Local L3 Category Triage, Vehicle Stand Verification & Bulletin Moderation',
        category: 'Hub Operations',
        flowBadges: ['hub_triage_suggested_category', 'hub_manager_verify_vehicle_listing', 'hub_manager_moderate_bulletin'],
        summary:
          'Manage day-to-day regional content and fleet stands independently without accessing global Superadmin builders.',
        steps: [
          'In Suggested Categories, review pending Level-3 leaf categories submitted by owners in your hub and approve or reject them via hub_triage_suggested_category.',
          'In Fleet & Vehicles, verify or pause local vehicle listings via hub_manager_verify_vehicle_listing.',
          'In Bulletins & Featured Slots, moderate reported community bulletins via hub_manager_moderate_bulletin and manage hub-scoped featured placement requests.',
          'In Escalated Disputes & Audit Logs, resolve regional order disputes and inspect hub-scoped audit records (workspace = hub_manager).',
        ],
        caution:
          'Global canonical category merges (merge_suggested_category), subscription plan builders, global homepage containers, and role promotions to super_admin are locked strictly to Superadmin.',
        ctaLabel: 'Open Hub Triage Desk',
        ctaHref: '/workspace/hub',
      },
    ],
    rulesAndSafety: [
      {
        id: 'hub-rule-scope',
        title: 'Strict `is_hub_manager_for(hub_id)` Isolation',
        badge: 'Decoupled from Superadmin',
        description:
          'Hub Managers are matched strictly via hub_managers.profile_id (never user_id) and can only mutate records belonging to their assigned hub_id. Multi-city hubs (e.g., Churachandpur, Aizawl) operate with zero cross-hub bleed.',
      },
      {
        id: 'hub-rule-printswift',
        title: 'Official First-Party Print Hub Governance',
        badge: 'is_official_printswift',
        description:
          'Hub Managers can update pricing matrices, express ETAs, and Pick N Drop toggles for Official DD oodle Print hubs within their assigned city.',
      },
    ],
    faqs: [
      {
        id: 'hub-faq-1',
        question: 'What is the difference between a Hub Manager and a Superadmin?',
        answer:
          'A Hub Manager runs daily operations for their assigned city/hub (local listings, KYC, vehicle stands, bulletins, local L3 category triage, and hub rates/payments if granted). A Superadmin controls global platform architecture (Homepage Builder, global plans/Pay-Per pricing, canonical category merges, and role promotions).',
        keywords: ['hub manager', 'superadmin', 'difference', 'scope', 'hub_id', 'permissions'],
        deepLinkUrl: '/workspace/hub',
        deepLinkLabel: 'Open Hub Manager Desk',
      },
      {
        id: 'hub-faq-2',
        question: 'Can a Hub Manager also act as a Dispatch Mediator for their hub?',
        answer:
          'Yes. Active Hub Managers automatically hold the Dispatch Mediator hat for their assigned hub so they can verify UPI payments, dispatch drivers, and settle escrow.',
        keywords: ['hub manager', 'mediator', 'escrow', 'dispatch', 'hat'],
        deepLinkUrl: '/workspace/mediator',
        deepLinkLabel: 'Switch to Mediator Hat',
      },
    ],
  },

  advertiser: {
    id: 'advertiser',
    title: 'Advertiser & Event Organizer Guide',
    shortTitle: 'Advertiser',
    tagline:
      'Publish town announcements, job openings, pinned events, and sanitized YouTube video notices via subscription quotas or Pay-Per duration slabs, and request homepage featured placements.',
    audienceBadge: 'Event Organizers, Recruiters & Promoters',
    entryHref: '/workspace/advertiser',
    entryLabel: 'Open Advertiser Desk',
    quickChecklist: [
      {
        id: 'adv-chk-1',
        label: 'Open Advertiser Desk (/workspace/advertiser) or Apply via Onboarding',
        detail:
          'Access your Advertiser KPI summary (active bulletins, expiring within 48h, monthly post quota, and featured requests).',
        ctaLabel: 'Open Advertiser Desk',
        ctaHref: '/workspace/advertiser',
      },
      {
        id: 'adv-chk-2',
        label: 'Compose a Notice, Job, Event (with Venue Pin), or YouTube Bulletin',
        detail:
          'Use BulletinComposerModal with compressed WebP flyer upload, MapCoordinatePicker event venue pin, and rich-text formatting.',
        ctaLabel: 'Compose Bulletin',
        ctaHref: '/workspace/advertiser',
      },
      {
        id: 'adv-chk-3',
        label: 'Choose Plan Quota, One-Time Trial, or Pay-Per Duration Pass',
        detail:
          'Publish using your active subscription quota (with optional auto_verify_bulletins) or pick a Pay-Per duration slab (e.g., 3, 7, 15, or 30 days).',
        ctaLabel: 'Plans & Pay-Per',
        ctaHref: '/workspace/advertiser',
      },
      {
        id: 'adv-chk-4',
        label: 'Submit or Manage Featured Placement Requests',
        detail:
          'Request spotlight placement on the homepage or bulletin top rail via GetFeaturedModal and track approval status live.',
        ctaLabel: 'Featured Placements',
        ctaHref: '/workspace/advertiser',
      },
    ],
    workflows: [
      {
        id: 'adv-wf-publish-bulletin',
        title: 'Publishing Notices, Jobs, Pinned Events & YouTube Video Bulletins',
        category: 'Community Bulletins',
        flowBadges: ['Pick L2/L3 Category', 'WebP Flyer + Venue Pin', 'Plan Quota or Pay-Per', 'Auto-Verify / Review'],
        summary:
          'Reach local residents on /bulletin and the homepage Community Bulletin rail.',
        steps: [
          'In /workspace/advertiser (or /bulletin), click "+ Post Bulletin" to open BulletinComposerModal.',
          'Select your bulletin category (Announcement, Job Opening, Local Event, Deal/Offer, Public Notice), add a clear title and sanitized rich-text body, and upload a flyer (auto-compressed to <=350KB WebP).',
          'For Events, use MapCoordinatePicker to pin the exact venue coordinates so readers can launch Directions or Pick N Drop rides straight to your event.',
          'If adding a YouTube Video URL, ensure your plan includes YouTube Video Notice entitlement or select the youtube_boost add-on during Pay-Per checkout.',
        ],
        proTip:
          'Subscribers with auto_verify_bulletins enabled have their quota-covered bulletins published immediately without waiting in the moderation queue.',
        ctaLabel: 'Open Advertiser Workspace',
        ctaHref: '/workspace/advertiser',
      },
      {
        id: 'adv-wf-renew-featured',
        title: '1-Tap Soft-Expiry Renewals & Homepage Featured Requests',
        category: 'Monetization & Spotlight',
        flowBadges: ['Expiring <=48h Alert', '1-Tap Pay-Per Renew', 'GetFeaturedModal', 'Withdraw Anytime'],
        summary:
          'Extend expired or soon-to-expire posts without retyping and book featured homepage slots.',
        steps: [
          'When a bulletin’s paid_until or expires_at date passes, it soft-expires from public /bulletin feeds while remaining saved in your Advertiser Desk.',
          'Click "Renew / Extend via Pay-Per" on any soft-expired or expiring card to pre-fill PayPerCheckoutModal and extend visibility in one step.',
          'To spotlight an important event or business on the homepage, click "Request Featured Slot" (GetFeaturedModal), choose your slot section and duration, and submit.',
          'You can withdraw an unreviewed featured request anytime via the "Withdraw Request" action (withdraw_featured_request RPC).',
        ],
        ctaLabel: 'Manage Bulletins & Featured Slots',
        ctaHref: '/workspace/advertiser',
      },
    ],
    rulesAndSafety: [
      {
        id: 'adv-rule-expiry',
        title: 'Soft-Expiry Public Filtering (`is_monetized_item_publicly_visible`)',
        badge: 'Zero Data Loss',
        description:
          'Unpaid Pay-Per drafts stay in pending_payment until UTR verification completes. Once paid_until expires, the post hides cleanly from public feeds and search but remains editable and renewable in your workspace.',
      },
      {
        id: 'adv-rule-youtube',
        title: 'Server-Verified YouTube Entitlement Guard',
        badge: 'guard_bulletin_youtube_entitlement_v21b',
        description:
          'Database triggers verify that bulletins containing a youtube_url either belong to an advertiser with active YouTube entitlement or have an approved youtube_boost Pay-Per order.',
      },
    ],
    faqs: [
      {
        id: 'adv-faq-1',
        question: 'How do I share a direct link to my bulletin post on WhatsApp?',
        answer:
          'Tap the Share button on your bulletin card to copy `/bulletin?hub=<hub>&post=<id>`. Anyone opening that link on `/bulletin` will automatically open your full bulletin modal.',
        keywords: ['bulletin', 'share', 'whatsapp', 'link', 'post', 'event'],
        deepLinkUrl: '/bulletin',
        deepLinkLabel: 'Open Town Bulletin',
      },
      {
        id: 'adv-faq-2',
        question: 'Why is my Pay-Per bulletin showing "Pending Payment / Verification"?',
        answer:
          'Pay-Per bulletins go live automatically as soon as your submitted 12-digit UPI UTR is verified by the payments desk (even if auto-verify is enabled, unpaid drafts are never auto-published).',
        keywords: ['pay-per', 'bulletin', 'pending', 'utr', 'verify', 'publish'],
        deepLinkUrl: '/workspace/advertiser',
        deepLinkLabel: 'Check Pay-Per Orders',
      },
    ],
  },

  super_admin: {
    id: 'super_admin',
    title: 'Superadmin Guide (Platform Governance & Builders)',
    shortTitle: 'Superadmin',
    tagline:
      'Govern platform-wide homepage containers, the 3-level fixed-root category taxonomy, composable subscription plans, Pay-Per pricing studio, 3-tier payment policies, service hubs, and immutable audit logs.',
    audienceBadge: 'Dual-Locked Platform Architecture & Governance',
    entryHref: '/admin',
    entryLabel: 'Open Master Control',
    quickChecklist: [
      {
        id: 'sa-chk-1',
        label: 'Review Command Center Metrics & Privacy-Safe Telemetry',
        detail:
          'Inspect 7-day/30-day platform funnel metrics, pending queues, and active hub health via get_command_center_metrics.',
        ctaLabel: 'Open Master Control',
        ctaHref: '/admin',
      },
      {
        id: 'sa-chk-2',
        label: 'Configure Homepage Containers, 16-Tile Deck & Quick Jumps',
        detail:
          'Use HomepageBuilder with @dnd-kit SortablePreview to reorder homepage sections, intent chips, and featured slots.',
        ctaLabel: 'Homepage Builder',
        ctaHref: '/admin',
      },
      {
        id: 'sa-chk-3',
        label: 'Govern 3-Level Taxonomy & Merge Suggested Leaf Categories',
        detail:
          'Maintain the 11 locked Level-1 roots, manage official Level-2/Level-3 nodes, and merge duplicate user-suggested leaves via merge_suggested_category.',
        ctaLabel: 'Taxonomy Builder',
        ctaHref: '/admin',
      },
      {
        id: 'sa-chk-4',
        label: 'Manage Unified Subscription Plans, Pay-Per Studio & Payment Policies',
        detail:
          'Configure the single Default Free Tier, paid/trial/VIP targeted plans, Pay-Per price/Sangam slabs, and 3-tier Payment Feature Policies.',
        ctaLabel: 'Monetization Studio',
        ctaHref: '/admin',
      },
      {
        id: 'sa-chk-5',
        label: 'Assign Service Hubs, Hub Managers & Audit Immutable Ledger',
        detail:
          'Provision new city hubs, assign hub_managers (by profile_id), and audit the immutable 13-column public.audit_logs ledger.',
        ctaLabel: 'Hubs & Audit Logs',
        ctaHref: '/admin',
      },
    ],
    workflows: [
      {
        id: 'sa-wf-homepage-taxonomy',
        title: 'Homepage Builder & 3-Level Fixed-Root Category Governance',
        category: 'Discovery & Taxonomy',
        flowBadges: ['11 Locked L1 Roots', 'L2/L3 Official Tree', 'merge_suggested_category', 'Homepage Revalidate'],
        summary:
          'Control every public container on / and maintain a clean, duplicate-free 3-level category hierarchy across all hubs.',
        steps: [
          'In Master Control -> Homepage Builder, drag and reorder homepage containers, configure the 16-Tile Service Launcher shortcuts, and save (triggering POST /api/admin/revalidate-homepage).',
          'In Category Builder, manage Level-2 and Level-3 categories under the 11 immutable Level-1 system roots (8 listing verticals + marketplace, bulletin, vehicles).',
          'In Suggested Categories Review, approve, reject, or canonically merge user-suggested Level-3 leaves into existing official categories via merge_suggested_category (automatically repointing all listings, products, bulletins, and vehicles).',
        ],
        proTip:
          'Level-1 system roots are protected by trg_categories_v16b_guard and can never be deleted, demoted, or re-parented.',
        ctaLabel: 'Open Master Control',
        ctaHref: '/admin',
      },
      {
        id: 'sa-wf-monetization-payments',
        title: 'Composable Subscription Plans, Pay-Per Studio & 3-Tier Payment Policies',
        category: 'Monetization Engine',
        flowBadges: ['Default Free Floor', '1-Time Trial & VIP Plans', 'Sangam/Price Bands', '3-Tier Payment Matrix'],
        summary:
          'Configure recurring plans, granular Pay-Per pricing slabs, and Online UPI vs. Direct Manual payment rules.',
        steps: [
          'In Subscription Plans Builder, maintain the single immutable Default Free Tier (is_default_free = true), configure paid plans with trial_days and composable feature/quota matrices, or create VIP plans (visibility_type = selected_users).',
          'Use reset_user_trial_eligibility when customer support needs to grant a merchant a fresh one-time trial.',
          'In Pay-Per Monetization Studio, edit base fees, duration slabs, Real Estate price bands (min_inr/max_inr/surcharge_inr) and area bands (with Manipur Sangam = 2,500 sq.ft conversion), and verify pending Pay-Per UTR orders.',
          'In Payment Feature Policies, set platform/vertical/category payment rules (online_platform, direct_manual, both, or disabled).',
        ],
        ctaLabel: 'Open Monetization Builders',
        ctaHref: '/admin',
      },
      {
        id: 'sa-wf-hubs-roles-audit',
        title: 'Multi-Hub Expansion, Role Governance & Immutable 13-Column Audit Ledger',
        category: 'Governance & Security',
        flowBadges: ['service_hubs', 'hub_managers.profile_id', 'superadmin_set_user_role', '13-Column audit_logs'],
        summary:
          'Launch new cities, promote Hub Managers or Mediators, and inspect tamper-proof governance logs.',
        steps: [
          'In Service Hubs & Rates, create or configure regional hubs (center coordinates via MapCoordinatePicker, module switches, per-hub vehicle rates) and assign Hub Managers strictly via hub_managers.profile_id.',
          'In Users & Role Governance, promote or demote user roles (visitor, driver, staff, owner, mediator, hub_manager, admin) via superadmin_set_user_role.',
          'Use the "View As Role" switcher in the header/profile to test any role’s UI lens while retaining verified server-side super_admin dual-lock security.',
          'Inspect public.audit_logs (protected by trg_audit_logs_immutable blocking all UPDATE and DELETE even for service_role).',
        ],
        caution:
          'Immutable Superadmin accounts are guarded by trg_guard_immutable_superadmin and can never be demoted or deleted.',
        ctaLabel: 'Open Governance & Audit',
        ctaHref: '/admin',
      },
    ],
    rulesAndSafety: [
      {
        id: 'sa-rule-duallock',
        title: 'Server & Database Superadmin Dual-Lock',
        badge: 'is_super_admin()',
        description:
          'Client cookies (view_as_role) are never trusted for privilege escalation. Every global mutation verifies authenticated DB super_admin status via RLS and SECURITY DEFINER checks.',
      },
      {
        id: 'sa-rule-audit',
        title: 'Append-Only 13-Column `public.audit_logs` Contract',
        badge: 'trg_audit_logs_immutable',
        description:
          'All governance actions write to the exact 13 columns (id, timestamp, actor_id, actor_name, actor_role, workspace, action, target_id, target_name, details, target_table, metadata, created_at).',
      },
    ],
    faqs: [
      {
        id: 'sa-faq-1',
        question: 'How do I assign a Hub Manager to Churachandpur or a new city hub?',
        answer:
          'Open Master Control -> Hubs & Rates, select the target Service Hub, search the user profile, and assign them. The system upserts hub_managers(hub_id, profile_id) and promotes their profile role to hub_manager via superadmin_set_user_role.',
        keywords: ['superadmin', 'hub manager', 'assign', 'service hub', 'profile_id'],
        deepLinkUrl: '/admin',
        deepLinkLabel: 'Open Hubs & Rates',
      },
      {
        id: 'sa-faq-2',
        question: 'How does canonical merging of a suggested category work?',
        answer:
          'In Suggested Categories Review, pick "Merge into Official Category". The merge_suggested_category RPC atomically reassigns all listings, marketplace products, bulletins, and vehicles from the suggested leaf to the target official category and marks the suggestion merged.',
        keywords: ['merge', 'category', 'suggested', 'taxonomy', 'leaf'],
        deepLinkUrl: '/admin',
        deepLinkLabel: 'Open Category Review',
      },
    ],
  },
};

export const ALL_ROLE_GUIDES: readonly RoleGuideDefinition[] =
  ROLE_GUIDE_ORDER.map((id) => ROLE_GUIDES_MAP[id]);

/**
 * Normalizes any role, workspace hat, or query param into a valid `RoleGuideId`.
 */
export function resolveRoleGuideId(
  rawRoleOrHat?: string | null
): RoleGuideId {
  const cleaned = String(rawRoleOrHat || '')
    .trim()
    .toLowerCase();
  switch (cleaned) {
    case 'owner':
    case 'business':
    case 'merchant':
      return 'owner';
    case 'staff':
    case 'agent':
      return 'staff';
    case 'driver':
    case 'fleet':
    case 'rider':
      return 'driver';
    case 'mediator':
    case 'dispatch_mediator':
      return 'mediator';
    case 'hub_manager':
    case 'hub':
      return 'hub_manager';
    case 'advertiser':
    case 'bulletin':
    case 'bulletins':
    case 'organizer':
      return 'advertiser';
    case 'super_admin':
    case 'superadmin':
    case 'admin':
    case 'master_control':
      return 'super_admin';
    case 'visitor':
    case 'customer':
    case 'guest':
    default:
      return 'visitor';
  }
}

export function getRoleGuideById(roleOrHat?: string | null): RoleGuideDefinition {
  return ROLE_GUIDES_MAP[resolveRoleGuideId(roleOrHat)];
}

export interface GuideUserContext {
  isAuthenticated?: boolean;
  email?: string | null;
  role?: string | null;
  realRole?: string | null;
  isSuperAdmin?: boolean;
  hasOwnerHat?: boolean;
  hasStaffHat?: boolean;
  hasDriverHat?: boolean;
  hasMediatorHat?: boolean;
  hasHubManagerHat?: boolean;
  hasAdvertiserHat?: boolean;
  ownedListingsCount?: number;
  ownedVehiclesCount?: number;
  staffDelegationsCount?: number;
  managedHubsCount?: number;
  bulletinsCount?: number;
  driverActive?: boolean;
}

/**
 * Computes the strictly authorized set of Role Guides for a given user context.
 * Signed-out users and pure visitors receive ONLY `['visitor']`.
 */
export function getAllowedGuideRoles(
  userContext?: GuideUserContext | null
): RoleGuideId[] {
  if (!userContext) return ['visitor'];

  const role = String(userContext.role || '').trim().toLowerCase();
  const realRole = String(userContext.realRole || '').trim().toLowerCase();
  const isSuper =
    Boolean(userContext.isSuperAdmin) ||
    role === 'super_admin' ||
    role === 'superadmin' ||
    realRole === 'super_admin' ||
    realRole === 'superadmin';

  if (isSuper) {
    return [...ROLE_GUIDE_ORDER];
  }

  const isAdmin = role === 'admin' || realRole === 'admin';
  if (isAdmin) {
    return ROLE_GUIDE_ORDER.filter((r) => r !== 'super_admin');
  }

  const hasAnySession =
    Boolean(userContext.isAuthenticated) ||
    Boolean(role && role !== 'visitor') ||
    Boolean(realRole && realRole !== 'visitor');

  if (!hasAnySession) {
    return ['visitor'];
  }

  const hasOwner =
    Boolean(userContext.hasOwnerHat) ||
    role === 'owner' ||
    realRole === 'owner' ||
    (userContext.ownedListingsCount ?? 0) > 0 ||
    (userContext.ownedVehiclesCount ?? 0) > 0;

  const hasStaff =
    Boolean(userContext.hasStaffHat) ||
    role === 'staff' ||
    realRole === 'staff' ||
    (userContext.staffDelegationsCount ?? 0) > 0 ||
    hasOwner;

  const hasDriver =
    Boolean(userContext.hasDriverHat) ||
    Boolean(userContext.driverActive) ||
    role === 'driver' ||
    realRole === 'driver';

  const hasHubManager =
    Boolean(userContext.hasHubManagerHat) ||
    role === 'hub_manager' ||
    realRole === 'hub_manager' ||
    (userContext.managedHubsCount ?? 0) > 0;

  const hasMediator =
    Boolean(userContext.hasMediatorHat) ||
    role === 'mediator' ||
    realRole === 'mediator' ||
    hasHubManager;

  const hasAdvertiser =
    Boolean(userContext.hasAdvertiserHat) ||
    role === 'advertiser' ||
    realRole === 'advertiser' ||
    hasOwner ||
    (userContext.bulletinsCount ?? 0) > 0;

  const allowedSet = new Set<RoleGuideId>(['visitor']);
  if (hasOwner) allowedSet.add('owner');
  if (hasStaff) allowedSet.add('staff');
  if (hasDriver) allowedSet.add('driver');
  if (hasMediator) allowedSet.add('mediator');
  if (hasHubManager) allowedSet.add('hub_manager');
  if (hasAdvertiser) allowedSet.add('advertiser');

  return ROLE_GUIDE_ORDER.filter((r) => allowedSet.has(r));
}

export function getAssistantTopicsForAllowedRoles(
  allowedRoles: readonly RoleGuideId[],
  activeRoleOrHat?: string | null
): Array<{
  id: string;
  category: string;
  label: string;
  keywords: string[];
  response: string;
  deepLinkUrl: string | null;
}> {
  const uniqueAllowed: RoleGuideId[] =
    allowedRoles.length > 0
      ? ROLE_GUIDE_ORDER.filter((r) => allowedRoles.includes(r))
      : ['visitor'];
  const requestedActive = resolveRoleGuideId(activeRoleOrHat);
  const activeRoleId: RoleGuideId = uniqueAllowed.includes(requestedActive)
    ? requestedActive
    : uniqueAllowed[0] || 'visitor';

  const prioritizedOrder: RoleGuideId[] = [
    activeRoleId,
    ...uniqueAllowed.filter((r) => r !== activeRoleId),
  ];

  const topics: Array<{
    id: string;
    category: string;
    label: string;
    keywords: string[];
    response: string;
    deepLinkUrl: string | null;
  }> = [];

  for (const rId of prioritizedOrder) {
    const guide = ROLE_GUIDES_MAP[rId];
    for (const faq of guide.faqs) {
      topics.push({
        id: `role-faq-${rId}-${faq.id}`,
        category: guide.shortTitle,
        label: faq.question,
        keywords: [...faq.keywords, rId, guide.shortTitle.toLowerCase()],
        response: faq.answer,
        deepLinkUrl: faq.deepLinkUrl || guide.entryHref,
      });
    }
    for (const wf of guide.workflows) {
      topics.push({
        id: `role-wf-${rId}-${wf.id}`,
        category: `${guide.shortTitle} • ${wf.category}`,
        label: wf.title,
        keywords: [
          rId,
          wf.category.toLowerCase(),
          ...wf.title
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((t) => t.length >= 3),
          ...wf.flowBadges.map((b) => b.toLowerCase()),
        ],
        response: `${wf.summary}\n\nSteps:\n${wf.steps
          .map((s, idx) => `${idx + 1}. ${s}`)
          .join('\n')}${wf.proTip ? `\n\nTip: ${wf.proTip}` : ''}`,
        deepLinkUrl: wf.ctaHref || guide.entryHref,
      });
    }
  }

  return topics;
}

/**
 * Builds role-prioritized FAQ topics strictly scoped to the caller's allowed roles.
 */
export function getAssistantTopicsForRole(
  roleOrHat?: string | null,
  allowedRoles?: readonly RoleGuideId[]
): Array<{
  id: string;
  category: string;
  label: string;
  keywords: string[];
  response: string;
  deepLinkUrl: string | null;
}> {
  const fallbackAllowed: RoleGuideId[] =
    allowedRoles && allowedRoles.length > 0
      ? [...allowedRoles]
      : [resolveRoleGuideId(roleOrHat)];
  return getAssistantTopicsForAllowedRoles(fallbackAllowed, roleOrHat);
}

export const ROLE_GUIDE_CHECKLIST_STORAGE_KEY =
  'ddoodle_role_guide_checklist_v23a';

export function readRoleChecklistProgress(
  roleId: RoleGuideId
): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROLE_GUIDE_CHECKLIST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Record<string, boolean>>;
    return parsed?.[roleId] && typeof parsed[roleId] === 'object'
      ? parsed[roleId]
      : {};
  } catch {
    return {};
  }
}

export function toggleRoleChecklistItem(
  roleId: RoleGuideId,
  itemId: string
): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ROLE_GUIDE_CHECKLIST_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<string, Record<string, boolean>>)
      : {};
    const currentRoleMap =
      parsed?.[roleId] && typeof parsed[roleId] === 'object'
        ? { ...parsed[roleId] }
        : {};
    currentRoleMap[itemId] = !currentRoleMap[itemId];
    const nextAll = { ...parsed, [roleId]: currentRoleMap };
    window.localStorage.setItem(
      ROLE_GUIDE_CHECKLIST_STORAGE_KEY,
      JSON.stringify(nextAll)
    );
    return currentRoleMap;
  } catch {
    return {};
  }
}

export function resetRoleChecklistProgress(roleId: RoleGuideId): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(ROLE_GUIDE_CHECKLIST_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Record<string, boolean>>;
    delete parsed[roleId];
    window.localStorage.setItem(
      ROLE_GUIDE_CHECKLIST_STORAGE_KEY,
      JSON.stringify(parsed)
    );
  } catch {
    // Ignore storage errors
  }
}
