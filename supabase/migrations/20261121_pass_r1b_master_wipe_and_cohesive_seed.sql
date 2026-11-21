-- =============================================================================
-- DD OODLE — PASS R1-B: MASTER DATABASE WIPE & COHESIVE END-TO-END SEED
-- Preserves: auth.users, profiles, schema definitions, RLS policies, storage buckets
-- Seeds: Churachandpur (churachandpur) & Aizawl (aizawl) with all 8 verticals,
--        composable plans, operational hats, interconnected orders/bookings/visits,
--        4-source merchant settlements, and media_assets lifecycle rows.
-- 100% IDEMPOTENT & SELF-CONTAINED
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_admin_id uuid;
  v_ccpur_id uuid;
  v_aizawl_id uuid;
  v_vt_bike uuid;
  v_vt_auto uuid;
  v_vt_van uuid;
  v_vt_suv uuid;
  v_tbl text;

  -- Root category IDs
  v_cat_print uuid;
  v_cat_civic uuid;
  v_cat_book uuid;
  v_cat_hotel uuid;
  v_cat_rest uuid;
  v_cat_shop uuid;
  v_cat_re uuid;
  v_cat_gen uuid;

  -- Sub-category IDs
  v_sub_print_doc uuid;
  v_sub_civic_med uuid;
  v_sub_civic_gov uuid;
  v_sub_civic_util uuid;
  v_sub_book_turf uuid;
  v_sub_book_hall uuid;
  v_sub_hotel_std uuid;
  v_sub_rest_momo uuid;
  v_sub_rest_cafe uuid;
  v_sub_shop_groc uuid;
  v_sub_shop_elec uuid;
  v_sub_re_rent uuid;
  v_sub_re_plot uuid;
  v_sub_re_comm uuid;
  v_sub_gen_repair uuid;

  -- Composable plan IDs
  v_plan_print uuid;
  v_plan_book uuid;
  v_plan_stay uuid;
  v_plan_shop uuid;
  v_plan_rest uuid;
  v_plan_boost uuid;
  v_plan_agent uuid;
  v_plan_allinone uuid;
  v_plan_staff_addon uuid;

  -- Listing UUIDs (deterministic)
  v_l_print_official uuid := 'a0000000-0000-4000-8000-000000000101';
  v_l_print_partner  uuid := 'a0000000-0000-4000-8000-000000000102';
  v_l_print_free     uuid := 'a0000000-0000-4000-8000-000000000103';

  v_l_civic_hosp_cc  uuid := 'a0000000-0000-4000-8000-000000000201';
  v_l_civic_dc_cc    uuid := 'a0000000-0000-4000-8000-000000000202';
  v_l_civic_hosp_az  uuid := 'a0000000-0000-4000-8000-000000000203';
  v_l_civic_pwr_az   uuid := 'a0000000-0000-4000-8000-000000000204';

  v_l_book_turf      uuid := 'a0000000-0000-4000-8000-000000000301';
  v_l_book_hall      uuid := 'a0000000-0000-4000-8000-000000000302';
  v_l_hotel_cc       uuid := 'a0000000-0000-4000-8000-000000000303';
  v_l_hotel_az       uuid := 'a0000000-0000-4000-8000-000000000304';

  v_l_shop_mart      uuid := 'a0000000-0000-4000-8000-000000000401';
  v_l_shop_elec      uuid := 'a0000000-0000-4000-8000-000000000402';
  v_l_shop_free      uuid := 'a0000000-0000-4000-8000-000000000403';

  v_l_rest_zobite    uuid := 'a0000000-0000-4000-8000-000000000501';
  v_l_rest_bistro    uuid := 'a0000000-0000-4000-8000-000000000502';
  v_l_rest_free      uuid := 'a0000000-0000-4000-8000-000000000503';

  v_l_re_rent        uuid := 'a0000000-0000-4000-8000-000000000601';
  v_l_re_plot        uuid := 'a0000000-0000-4000-8000-000000000602';
  v_l_re_shop        uuid := 'a0000000-0000-4000-8000-000000000603';
  v_l_re_pg          uuid := 'a0000000-0000-4000-8000-000000000604';

  v_l_gen_hw         uuid := 'a0000000-0000-4000-8000-000000000701';
  v_l_gen_drive      uuid := 'a0000000-0000-4000-8000-000000000702';
  v_l_gen_custody    uuid := 'a0000000-0000-4000-8000-000000000703';

  -- Resource / Order / Delivery / Payment UUIDs
  v_res_turf_5v5     uuid := 'b0000000-0000-4000-8000-000000000101';
  v_res_hall_main    uuid := 'b0000000-0000-4000-8000-000000000102';
  v_res_hotel_dlx    uuid := 'b0000000-0000-4000-8000-000000000103';
  v_res_home_std     uuid := 'b0000000-0000-4000-8000-000000000104';

  v_del_parcel       uuid := 'c0000000-0000-4000-8000-000000000101';
  v_del_print        uuid := 'c0000000-0000-4000-8000-000000000102';
  v_del_shop         uuid := 'c0000000-0000-4000-8000-000000000103';
  v_del_food         uuid := 'c0000000-0000-4000-8000-000000000104';

  v_po_1             uuid := 'c1000000-0000-4000-8000-000000000101';
  v_po_2             uuid := 'c1000000-0000-4000-8000-000000000102';
  v_po_3             uuid := 'c1000000-0000-4000-8000-000000000103';
  v_po_4             uuid := 'c1000000-0000-4000-8000-000000000104';

  v_rb_1             uuid := 'c2000000-0000-4000-8000-000000000101';
  v_rb_2             uuid := 'c2000000-0000-4000-8000-000000000102';
  v_rb_3             uuid := 'c2000000-0000-4000-8000-000000000103';
  v_rb_4             uuid := 'c2000000-0000-4000-8000-000000000104';
  v_rb_5             uuid := 'c2000000-0000-4000-8000-000000000105';

  v_so_1             uuid := 'c3000000-0000-4000-8000-000000000101';
  v_so_2             uuid := 'c3000000-0000-4000-8000-000000000102';
  v_so_3             uuid := 'c3000000-0000-4000-8000-000000000103';

  v_ro_1             uuid := 'c4000000-0000-4000-8000-000000000101';
  v_ro_2             uuid := 'c4000000-0000-4000-8000-000000000102';
  v_ro_3             uuid := 'c4000000-0000-4000-8000-000000000103';
  v_ro_4             uuid := 'c4000000-0000-4000-8000-000000000104';

  v_vl_1             uuid := 'd0000000-0000-4000-8000-000000000101';
  v_vl_2             uuid := 'd0000000-0000-4000-8000-000000000102';
  v_vl_3             uuid := 'd0000000-0000-4000-8000-000000000103';
  v_vl_4             uuid := 'd0000000-0000-4000-8000-000000000104';

  v_pi_1             uuid := 'e0000000-0000-4000-8000-000000000101';
  v_pi_2             uuid := 'e0000000-0000-4000-8000-000000000102';
  v_pi_3             uuid := 'e0000000-0000-4000-8000-000000000103';
  v_pi_4             uuid := 'e0000000-0000-4000-8000-000000000104';
  v_pi_5             uuid := 'e0000000-0000-4000-8000-000000000105';
  v_pi_6             uuid := 'e0000000-0000-4000-8000-000000000106';
BEGIN
  -- ===========================================================================
  -- STEP 1: RESOLVE REAL ADMIN PROFILE & SAFE DOMAIN WIPE (PRESERVING auth.users & profiles)
  -- ===========================================================================
  SELECT id INTO v_admin_id
  FROM public.profiles
  WHERE lower(COALESCE(role, '')) IN ('super_admin', 'admin')
  ORDER BY CASE WHEN lower(COALESCE(role, '')) = 'super_admin' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No existing profile found in public.profiles. Sign up at least one user before running Pass R1-B Master Seed.';
  END IF;

  -- Safely truncate domain & transactional tables (skipping any table not present)
  FOREACH v_tbl IN ARRAY ARRAY[
    'media_assets',
    'merchant_settlements',
    'payment_intents',
    'property_visit_requests',
    'listing_real_estate_profiles',
    'restaurant_table_reservations',
    'restaurant_orders',
    'restaurant_menu_items',
    'listing_restaurant_profiles',
    'shop_orders',
    'listing_shop_profiles',
    'resource_bookings',
    'listing_booking_resources',
    'listing_hotel_profiles',
    'civic_correction_reports',
    'print_order_events',
    'print_order_files',
    'print_orders',
    'listing_print_profiles',
    'delivery_order_events',
    'delivery_transactions',
    'delivery_order_secrets',
    'delivery_orders',
    'vehicle_bookings',
    'vehicle_listings',
    'bulletin_post_passes',
    'bulletin_reports',
    'bulletins',
    'user_subscriptions',
    'subscription_plans',
    'promo_codes',
    'app_announcements',
    'marketplace_products',
    'staff_delegations',
    'reviews',
    'enquiries',
    'user_saved_items',
    'notifications',
    'driver_profiles',
    'listings',
    'hub_localities',
    'categories'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', v_tbl);
    END IF;
  END LOOP;

  -- ===========================================================================
  -- STEP 2: HUBS, LOCALITIES & 2-LEVEL TAXONOMY
  -- ===========================================================================
  INSERT INTO public.service_hubs (
    slug, name, state, center_lat, center_lng, service_radius_km, default_zoom,
    supported_languages, default_language, status, is_default, sort_order, module_switches
  ) VALUES
    (
      'churachandpur', 'Churachandpur', 'Manipur', 24.3333, 93.6833, 25, 14,
      ARRAY['en','paite','manipuri']::text[], 'en', 'active', true, 1,
      '{"explore":true,"marketplace":true,"bulletin":true,"pick_n_drop":true,"vehicle_bookings":true,"print_orders":true,"booking_venues":true,"hotel_stays":true,"shop_orders":true,"food_orders":true,"real_estate":true}'::jsonb
    ),
    (
      'aizawl', 'Aizawl', 'Mizoram', 23.7271, 92.7176, 25, 14,
      ARRAY['en','mizo']::text[], 'en', 'active', false, 2,
      '{"explore":true,"marketplace":true,"bulletin":true,"pick_n_drop":true,"vehicle_bookings":true,"print_orders":true,"booking_venues":true,"hotel_stays":true,"shop_orders":true,"food_orders":true,"real_estate":true}'::jsonb
    )
  ON CONFLICT (slug) DO UPDATE SET
    module_switches = EXCLUDED.module_switches,
    status = 'active';

  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;
  SELECT id INTO v_aizawl_id FROM public.service_hubs WHERE slug = 'aizawl' LIMIT 1;

  -- 8 Curated Localities per Hub
  INSERT INTO public.hub_localities (hub_id, slug, display_name, lat, lng, source, status) VALUES
    (v_ccpur_id, 'tuibong', 'Tuibong', 24.3441, 93.6942, 'admin', 'verified'),
    (v_ccpur_id, 'lamka-bazar', 'Lamka Bazar', 24.3335, 93.6833, 'admin', 'verified'),
    (v_ccpur_id, 'new-lamka', 'New Lamka', 24.3318, 93.6794, 'admin', 'verified'),
    (v_ccpur_id, 'rengkai', 'Rengkai', 24.3264, 93.6890, 'admin', 'verified'),
    (v_ccpur_id, 'hiangtam-lamka', 'Hiangtam Lamka', 24.3350, 93.6815, 'admin', 'verified'),
    (v_ccpur_id, 'zenhang-lamka', 'Zenhang Lamka', 24.3372, 93.6752, 'admin', 'verified'),
    (v_ccpur_id, 'mission-veng', 'Mission Veng', 24.3302, 93.6848, 'admin', 'verified'),
    (v_ccpur_id, 'pearsonmun', 'Pearsonmun', 24.3210, 93.6710, 'admin', 'verified'),
    (v_aizawl_id, 'dawrpui', 'Dawrpui', 23.7279, 92.7196, 'admin', 'verified'),
    (v_aizawl_id, 'zarkawt', 'Zarkawt', 23.7325, 92.7180, 'admin', 'verified'),
    (v_aizawl_id, 'khatla', 'Khatla', 23.7204, 92.7128, 'admin', 'verified'),
    (v_aizawl_id, 'chanmari', 'Chanmari', 23.7368, 92.7199, 'admin', 'verified'),
    (v_aizawl_id, 'bara-bazar', 'Bara Bazar', 23.7271, 92.7185, 'admin', 'verified'),
    (v_aizawl_id, 'chaltlang', 'Chaltlang', 23.7485, 92.7240, 'admin', 'verified'),
    (v_aizawl_id, 'kulikawn', 'Kulikawn', 23.7115, 92.7160, 'admin', 'verified'),
    (v_aizawl_id, 'aizawl-venglai', 'Aizawl Venglai', 23.7295, 92.7155, 'admin', 'verified')
  ON CONFLICT (hub_id, slug) DO NOTHING;

  -- Complete 2-Level Categories Tree (All 8 Verticals)
  INSERT INTO public.categories (entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active) VALUES
    ('listing', NULL, 0, 'printing_digital_services', 'Print & Digital Services', 'Printer', '#0D9488', 10, true),
    ('listing', NULL, 0, 'public_govt_services', 'Public & Govt Services', 'Landmark', '#334155', 20, true),
    ('listing', NULL, 0, 'venues_turfs_bookings', 'Venues, Turfs & Halls', 'CalendarDays', '#059669', 30, true),
    ('listing', NULL, 0, 'hotels_homestays', 'Hotels & Homestays', 'BedDouble', '#4F46E5', 40, true),
    ('listing', NULL, 0, 'restaurants_cafes', 'Restaurants & Cafés', 'UtensilsCrossed', '#EA580C', 50, true),
    ('listing', NULL, 0, 'shops_catalogues', 'Shops & Daily Stores', 'ShoppingBag', '#0284C7', 60, true),
    ('listing', NULL, 0, 'real_estate_properties', 'Real Estate & Properties', 'Home', '#7C3AED', 70, true),
    ('listing', NULL, 0, 'general_services', 'Local Services & Trades', 'Wrench', '#475569', 80, true)
  ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_cat_print FROM public.categories WHERE entity_type='listing' AND slug='printing_digital_services';
  SELECT id INTO v_cat_civic FROM public.categories WHERE entity_type='listing' AND slug='public_govt_services';
  SELECT id INTO v_cat_book  FROM public.categories WHERE entity_type='listing' AND slug='venues_turfs_bookings';
  SELECT id INTO v_cat_hotel FROM public.categories WHERE entity_type='listing' AND slug='hotels_homestays';
  SELECT id INTO v_cat_rest  FROM public.categories WHERE entity_type='listing' AND slug='restaurants_cafes';
  SELECT id INTO v_cat_shop  FROM public.categories WHERE entity_type='listing' AND slug='shops_catalogues';
  SELECT id INTO v_cat_re    FROM public.categories WHERE entity_type='listing' AND slug='real_estate_properties';
  SELECT id INTO v_cat_gen   FROM public.categories WHERE entity_type='listing' AND slug='general_services';

  INSERT INTO public.categories (entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active) VALUES
    ('listing', v_cat_print, 1, 'document_xerox_print', 'Document & Xerox Print', 'Printer', '#0D9488', 10, true),
    ('listing', v_cat_civic, 1, 'emergency_medical', 'Hospitals & Emergency', 'HeartPulse', '#B91C1C', 10, true),
    ('listing', v_cat_civic, 1, 'government_office', 'Govt Offices & Secretariat', 'Landmark', '#334155', 20, true),
    ('listing', v_cat_civic, 1, 'utility_power_water', 'Power & Water Helplines', 'Zap', '#D97706', 30, true),
    ('listing', v_cat_book,  1, 'sports_turfs_arenas', 'Sports Turfs & Arenas', 'Trophy', '#059669', 10, true),
    ('listing', v_cat_book,  1, 'event_community_halls', 'Event & Community Halls', 'Building2', '#059669', 20, true),
    ('listing', v_cat_hotel, 1, 'hotels_homestays_stays', 'Hotels & Homestays', 'BedDouble', '#4F46E5', 10, true),
    ('listing', v_cat_rest,  1, 'fast_food_momos', 'Fast Food & Momos', 'Flame', '#EA580C', 10, true),
    ('listing', v_cat_rest,  1, 'cafes_bakeries', 'Cafés & Bakeries', 'Coffee', '#EA580C', 20, true),
    ('listing', v_cat_shop,  1, 'groceries_kirana', 'Groceries & Pharmacy', 'ShoppingBasket', '#0284C7', 10, true),
    ('listing', v_cat_shop,  1, 'electronics_mobile', 'Electronics & Mobile', 'Smartphone', '#0284C7', 20, true),
    ('listing', v_cat_re,    1, 'houses_apartments_rent', 'Houses & Flats for Rent', 'Home', '#7C3AED', 10, true),
    ('listing', v_cat_re,    1, 'plots_land_sale', 'Plots & Land for Sale', 'Map', '#7C3AED', 20, true),
    ('listing', v_cat_re,    1, 'commercial_shops_lease', 'Commercial Shops & Lease', 'Building2', '#7C3AED', 30, true),
    ('listing', v_cat_gen,   1, 'hardware_repairs', 'Hardware & Repairs', 'Wrench', '#475569', 10, true)
  ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_sub_print_doc FROM public.categories WHERE entity_type='listing' AND slug='document_xerox_print';
  SELECT id INTO v_sub_civic_med FROM public.categories WHERE entity_type='listing' AND slug='emergency_medical';
  SELECT id INTO v_sub_civic_gov FROM public.categories WHERE entity_type='listing' AND slug='government_office';
  SELECT id INTO v_sub_civic_util FROM public.categories WHERE entity_type='listing' AND slug='utility_power_water';
  SELECT id INTO v_sub_book_turf FROM public.categories WHERE entity_type='listing' AND slug='sports_turfs_arenas';
  SELECT id INTO v_sub_book_hall FROM public.categories WHERE entity_type='listing' AND slug='event_community_halls';
  SELECT id INTO v_sub_hotel_std FROM public.categories WHERE entity_type='listing' AND slug='hotels_homestays_stays';
  SELECT id INTO v_sub_rest_momo FROM public.categories WHERE entity_type='listing' AND slug='fast_food_momos';
  SELECT id INTO v_sub_rest_cafe FROM public.categories WHERE entity_type='listing' AND slug='cafes_bakeries';
  SELECT id INTO v_sub_shop_groc FROM public.categories WHERE entity_type='listing' AND slug='groceries_kirana';
  SELECT id INTO v_sub_shop_elec FROM public.categories WHERE entity_type='listing' AND slug='electronics_mobile';
  SELECT id INTO v_sub_re_rent   FROM public.categories WHERE entity_type='listing' AND slug='houses_apartments_rent';
  SELECT id INTO v_sub_re_plot   FROM public.categories WHERE entity_type='listing' AND slug='plots_land_sale';
  SELECT id INTO v_sub_re_comm   FROM public.categories WHERE entity_type='listing' AND slug='commercial_shops_lease';
  SELECT id INTO v_sub_gen_repair FROM public.categories WHERE entity_type='listing' AND slug='hardware_repairs';

  -- ===========================================================================
  -- STEP 3: 9 COMPOSABLE SUBSCRIPTION PLANS, PROMO CODES & BANNERS
  -- ===========================================================================
  INSERT INTO public.subscription_plans (
    slug, name, price_inr, max_active_bulletins, max_monthly_posts, max_images_per_post,
    allow_youtube, duration_days, is_active, plan_scope, billing_cycle, is_addon,
    entitlements, features, limits
  ) VALUES
    ('print_pro_monthly', 'Print & Digital Pro', 499, 2, 10, 6, false, 30, true, 'print_pro', 'monthly', false,
      '{"print_ordering":true,"custom_digital_quotes":true,"escrow_enabled":true}'::jsonb,
      '{"print_online_orders":true,"print_custom_digital":true,"pick_n_drop_dispatch":true,"counter_qr_posters":true,"staff_delegation":true}'::jsonb,
      '{"max_active_listings":2,"max_staff_members":3,"max_media_per_listing":10}'::jsonb),
    ('booking_pro_monthly', 'Booking Venue Pro', 599, 2, 10, 6, false, 30, true, 'booking_pro', 'monthly', false,
      '{"booking_venues":true,"escrow_enabled":true}'::jsonb,
      '{"booking_slots":true,"counter_qr_posters":true,"staff_delegation":true}'::jsonb,
      '{"max_active_listings":2,"max_booking_resources":10,"max_staff_members":3}'::jsonb),
    ('stay_pro_monthly', 'Hotel & Homestay Pro', 799, 2, 10, 8, false, 30, true, 'stay_pro', 'monthly', false,
      '{"hotel_stays":true,"escrow_enabled":true}'::jsonb,
      '{"hotel_multi_room":true,"counter_qr_posters":true,"staff_delegation":true}'::jsonb,
      '{"max_active_listings":2,"max_booking_resources":25,"max_staff_members":5}'::jsonb),
    ('catalogue_pro_monthly', 'Shop Catalogue Pro', 499, 2, 10, 6, false, 30, true, 'catalogue_pro', 'monthly', false,
      '{"catalogue_ordering":true,"pick_n_drop_dispatch":true}'::jsonb,
      '{"shop_basket_checkout":true,"pick_n_drop_dispatch":true,"counter_qr_posters":true,"staff_delegation":true}'::jsonb,
      '{"max_active_listings":2,"max_catalogue_items":500,"max_staff_members":4}'::jsonb),
    ('restaurant_pro_monthly', 'Restaurant & Café Pro', 699, 2, 10, 8, false, 30, true, 'restaurant_pro', 'monthly', false,
      '{"restaurant_ordering":true,"table_reservations":true,"pick_n_drop_dispatch":true}'::jsonb,
      '{"restaurant_menu_ordering":true,"restaurant_table_booking":true,"pick_n_drop_dispatch":true,"counter_qr_posters":true,"staff_delegation":true}'::jsonb,
      '{"max_active_listings":2,"max_menu_items":300,"max_staff_members":5}'::jsonb),
    ('real_estate_boost_30d', 'Real Estate 30-Day Verified Boost', 299, 0, 0, 8, false, 30, true, 'real_estate_boost', '30d', true,
      '{"verified_boost_pin":true,"duration_days":30}'::jsonb,
      '{"real_estate_verified_boost":true,"featured_map_pin":true}'::jsonb,
      '{"active_boost_slots":1}'::jsonb),
    ('agent_pro_monthly', 'Agent Pro Monthly (15 Properties)', 799, 3, 15, 10, false, 30, true, 'agent_pro', 'monthly', false,
      '{"real_estate_pro":true,"max_active_properties":15}'::jsonb,
      '{"real_estate_verified_boost":true,"featured_map_pin":true,"bulletin_posting":true,"staff_delegation":true}'::jsonb,
      '{"max_active_listings":15,"active_boost_slots":3,"max_staff_members":3}'::jsonb),
    ('merchant_all_in_one_monthly', 'Merchant All-in-One Bundle', 1499, 10, 50, 12, true, 30, true, 'merchant_all_in_one', 'monthly', false,
      '{"print_ordering":true,"booking_venues":true,"hotel_stays":true,"catalogue_ordering":true,"restaurant_ordering":true,"real_estate_pro":true}'::jsonb,
      '{"print_online_orders":true,"print_custom_digital":true,"booking_slots":true,"hotel_multi_room":true,"shop_basket_checkout":true,"restaurant_menu_ordering":true,"restaurant_table_booking":true,"pick_n_drop_dispatch":true,"real_estate_verified_boost":true,"bulletin_posting":true,"counter_qr_posters":true,"staff_delegation":true,"featured_map_pin":true}'::jsonb,
      '{"max_active_listings":-1,"max_catalogue_items":-1,"max_menu_items":-1,"max_booking_resources":-1,"max_staff_members":15,"max_monthly_bulletins":50,"max_media_per_listing":20,"active_boost_slots":5}'::jsonb),
    ('addon_staff_seats_5', '+5 Staff Seats Add-On', 199, 0, 0, 0, false, 30, true, 'addon_pack', 'monthly', true,
      '{"extra_staff_seats":5}'::jsonb,
      '{"staff_delegation":true}'::jsonb,
      '{"max_staff_members":5}'::jsonb)
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO v_plan_print       FROM public.subscription_plans WHERE slug='print_pro_monthly';
  SELECT id INTO v_plan_book        FROM public.subscription_plans WHERE slug='booking_pro_monthly';
  SELECT id INTO v_plan_stay        FROM public.subscription_plans WHERE slug='stay_pro_monthly';
  SELECT id INTO v_plan_shop        FROM public.subscription_plans WHERE slug='catalogue_pro_monthly';
  SELECT id INTO v_plan_rest        FROM public.subscription_plans WHERE slug='restaurant_pro_monthly';
  SELECT id INTO v_plan_boost       FROM public.subscription_plans WHERE slug='real_estate_boost_30d';
  SELECT id INTO v_plan_agent       FROM public.subscription_plans WHERE slug='agent_pro_monthly';
  SELECT id INTO v_plan_allinone    FROM public.subscription_plans WHERE slug='merchant_all_in_one_monthly';
  SELECT id INTO v_plan_staff_addon FROM public.subscription_plans WHERE slug='addon_staff_seats_5';

  INSERT INTO public.promo_codes (
    code, description, discount_type, discount_value, max_discount_inr, min_order_inr,
    applies_to, max_uses, used_count, starts_at, expires_at, is_active
  ) VALUES
    ('LAMKA50', 'Flat ₹50 off Pick N Drop & Local Orders in Churachandpur', 'flat', 50, 50, 150,
      ARRAY['pick_n_drop','shop_order','restaurant_order','print_order']::text[], 500, 12, now() - interval '5 days', now() + interval '60 days', true),
    ('AIZAWL10', '10% off Hotels, Venues & Food Orders (up to ₹150)', 'percent', 10, 150, 300,
      ARRAY['resource_booking','restaurant_order','shop_order']::text[], 300, 8, now() - interval '2 days', now() + interval '45 days', true)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO public.app_announcements (
    type, badge_label, message, promo_code, cta_label, cta_url, priority, is_dismissible, is_active, created_by
  ) VALUES
    ('offer', '0% COMMISSION', 'Order fresh Momos, groceries & document prints directly from Lamka & Aizawl shops with Pick N Drop.', 'LAMKA50', 'Explore Map', '/', 10, true, true, v_admin_id),
    ('info', 'NEW VERTICAL', 'Book local sports turfs, homestays & verified Patta properties directly on DD oodle.', NULL, 'View Activity', '/activity', 5, true, true, v_admin_id);

  -- ===========================================================================
  -- STEP 4: MULTI-VERTICAL LISTINGS ACROSS CHURACHANDPUR & AIZAWL
  -- ===========================================================================

  -- 4A. Print & Digital (3 listings)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record
  ) VALUES
    (v_l_print_official, v_admin_id, 'PrintSwift Official', '[SAMPLE] PrintSwift Express Hub — Lamka', 'service', 'Document & Xerox Print', v_sub_print_doc, 'published', 'active',
      'Lamka Bazar', 'Tedim Road, Opposite Main Bazar, Churachandpur 795128', 'Official PrintSwift counter for express 30-min B&W/Color PDF printing, spiral binding & sealed Pick N Drop.', 'First-party PrintSwift digital print hub with verified color laser, duplex, A3, lamination, and sealed envelope courier dispatch.', 5, '+91 98620 11001', '+91 98620 11001',
      'https://picsum.photos/seed/dd-print-official/960/640', '[]'::jsonb, '{"lat":24.3338,"lng":93.6836}'::jsonb, 24.3338, 93.6836, 4.9, 64, v_ccpur_id, 'print_digital', false),
    (v_l_print_partner, v_admin_id, 'Zomi Digital Press', '[SAMPLE] Zomi Digital Print & Binding', 'service', 'Document & Xerox Print', v_sub_print_doc, 'published', 'active',
      'Tuibong', 'Near DC Office Gate, Tuibong, Churachandpur 795128', 'Subscribed Print Pro partner: dual-rail checkout up to ₹300, color/duplex/binding & custom digital design quotes.', 'Trusted Tuibong digital press offering exam notes printing, spiral binding, lamination, and custom flex/card design quotes.', 3, '+91 98620 11002', '+91 98620 11002',
      'https://picsum.photos/seed/dd-print-partner/960/640', '[]'::jsonb, '{"lat":24.3435,"lng":93.6938}'::jsonb, 24.3435, 93.6938, 4.7, 29, v_ccpur_id, 'print_digital', false),
    (v_l_print_free, v_admin_id, 'Chanmari Xerox Point', '[SAMPLE] Chanmari Basic Xerox & Scan', 'service', 'Document & Xerox Print', v_sub_print_doc, 'published', 'active',
      'Chanmari', 'Chanmari West Junction, Aizawl 796007', 'Walk-in photocopy, passport photo & scanning shop (Free basic listing — Call/Walk-in).', 'Neighborhood xerox and lamination shop in Chanmari.', 2, '+91 98630 11003', '+91 98630 11003',
      'https://picsum.photos/seed/dd-print-free/960/640', '[]'::jsonb, '{"lat":23.7362,"lng":92.7192}'::jsonb, 23.7362, 92.7192, 4.4, 11, v_aizawl_id, 'print_digital', false);

  INSERT INTO public.listing_print_profiles (
    listing_id, hub_id, is_first_party_printswift, is_accepting_orders, turnaround_badge,
    verified_capabilities, pricing_config, payment_policy
  ) VALUES
    (v_l_print_official, v_ccpur_id, true, true, 'express_30m',
      '{"bw_a4":true,"color_a4":true,"duplex":true,"a3_large":true,"spiral_binding":true,"lamination":true,"custom_digital_jobs":true,"sealed_envelope":true}'::jsonb,
      '{"bw_a4_per_page":3,"color_a4_per_page":12,"duplex_discount_pct":15,"spiral_binding_inr":40,"lamination_inr":30}'::jsonb,
      '{"allow_direct_pay":true,"direct_pay_max_inr":300,"allow_escrow":true}'::jsonb),
    (v_l_print_partner, v_ccpur_id, false, true, 'same_day',
      '{"bw_a4":true,"color_a4":true,"duplex":true,"spiral_binding":true,"custom_digital_jobs":true}'::jsonb,
      '{"bw_a4_per_page":2.5,"color_a4_per_page":10,"duplex_discount_pct":10,"spiral_binding_inr":35}'::jsonb,
      '{"allow_direct_pay":true,"direct_pay_max_inr":300,"allow_escrow":true,"shop_upi_id":"zomipress@upi","shop_upi_name":"Zomi Digital Press","shop_upi_verified":true}'::jsonb);

  -- 4B. Public & Civic (4 listings — 2 CCPur, 2 Aizawl)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record, vertical_summary
  ) VALUES
    (v_l_civic_hosp_cc, v_admin_id, 'District Health', '[SAMPLE] Churachandpur District Hospital (24×7)', 'public_place', 'Hospitals & Emergency', v_sub_civic_med, 'published', 'active',
      'Lamka Bazar', 'Hospital Road, IB Road, Churachandpur 795128', '24×7 District Emergency Casualty, Blood Bank, Maternity & OPD services.', 'Primary district government hospital serving Churachandpur with 24×7 emergency ambulance desk.', 0, '+91 3874 233108', '+91 3874 233108',
      'https://picsum.photos/seed/dd-ccpur-hosp/960/640', '[]'::jsonb, '{"lat":24.3312,"lng":93.6852}'::jsonb, 24.3312, 93.6852, 4.5, 18, v_ccpur_id, 'public_civic', true,
      '{"department_type":"emergency_medical","is_24x7":true,"emergency_phone":"+91 3874 233108","has_active_alert":false}'::jsonb),
    (v_l_civic_dc_cc, v_admin_id, 'DC Office CCPur', '[SAMPLE] Mini Secretariat — DC Office Tuibong', 'public_place', 'Govt Offices & Secretariat', v_sub_civic_gov, 'published', 'active',
      'Tuibong', 'Mini Secretariat Complex, Tuibong, Churachandpur 795128', 'Income/Tribe/Domicile certificates, land patta desk & citizen facilitation center.', 'Deputy Commissioner office complex in Tuibong. Bring Aadhaar, passport photos & application printout.', 0, '+91 3874 234200', '+91 3874 234200',
      'https://picsum.photos/seed/dd-ccpur-dc/960/640', '[]'::jsonb, '{"lat":24.3458,"lng":93.6948}'::jsonb, 24.3458, 93.6948, 4.3, 14, v_ccpur_id, 'public_civic', true,
      '{"department_type":"government_office","is_24x7":false,"show_nearby_print_helper":true,"document_checklists":["Aadhaar Card Photocopy","2 Passport Size Photos","Village Authority Recommendation Letter"]}'::jsonb),
    (v_l_civic_hosp_az, v_admin_id, 'Aizawl Civil Hospital', '[SAMPLE] Aizawl Civil Hospital (24×7)', 'public_place', 'Hospitals & Emergency', v_sub_civic_med, 'published', 'active',
      'Dawrpui', 'Bara Bazar Main Road, Dawrpui, Aizawl 796001', '24×7 Emergency Casualty, Trauma Care, Blood Bank & Specialty OPD.', 'State referral government hospital in central Aizawl.', 0, '+91 389 2322318', '+91 389 2322318',
      'https://picsum.photos/seed/dd-aizawl-hosp/960/640', '[]'::jsonb, '{"lat":23.7289,"lng":92.7191}'::jsonb, 23.7289, 92.7191, 4.6, 22, v_aizawl_id, 'public_civic', true,
      '{"department_type":"emergency_medical","is_24x7":true,"emergency_phone":"+91 389 2322318","has_active_alert":false}'::jsonb),
    (v_l_civic_pwr_az, v_admin_id, 'P&E Mizoram', '[SAMPLE] P&E Power Helpline — Khatla Sub-Station', 'public_place', 'Power & Water Helplines', v_sub_civic_util, 'published', 'active',
      'Khatla', 'Power House Road, Khatla, Aizawl 796001', '24×7 power outage helpline, transformer fault reporting & billing desk.', 'Power & Electricity Department fault response control room for central Aizawl.', 0, '1912', '1912',
      'https://picsum.photos/seed/dd-aizawl-pwr/960/640', '[]'::jsonb, '{"lat":23.7219,"lng":92.7141}'::jsonb, 23.7219, 92.7141, 4.2, 9, v_aizawl_id, 'public_civic', true,
      jsonb_build_object('department_type','utility_power_water','is_24x7',true,'has_active_alert',true,'live_civic_alert','Scheduled 11kV feeder maintenance in Khatla & Dawrpui from 10:00 AM to 12:30 PM.','alert_expires_at',(now() + interval '3 days')::text));

  INSERT INTO public.civic_correction_reports (
    hub_id, listing_id, reporter_id, report_type, details, status
  ) VALUES
    (v_ccpur_id, v_l_civic_dc_cc, v_admin_id, 'timings_change', 'Certificate counter now closes at 3:30 PM on Saturdays.', 'pending'),
    (v_ccpur_id, v_l_civic_hosp_cc, v_admin_id, 'phone_update', 'Verified updated emergency landline extension.', 'approved'),
    (v_aizawl_id, v_l_civic_pwr_az, v_admin_id, 'other', 'Duplicate report about feeder timing.', 'rejected');

  -- 4C. Booking Venues (2) & Hotels (2)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record
  ) VALUES
    (v_l_book_turf, v_admin_id, 'Lamka Arena', '[SAMPLE] Lamka Arena 5v5 / 7v7 Football Turf', 'sports', 'Sports Turfs & Arenas', v_sub_book_turf, 'published', 'active',
      'Rengkai', 'Rengkai Road, Churachandpur 795128', 'FIFA-grade synthetic football turf with LED floodlights, drinking water & instant hourly slot booking.', 'Premier evening & weekend football turf in Rengkai with online slot locks and Check-In OTP.', 800, '+91 98620 22001', '+91 98620 22001',
      'https://picsum.photos/seed/dd-lamka-turf/960/640', '[]'::jsonb, '{"lat":24.3268,"lng":93.6884}'::jsonb, 24.3268, 93.6884, 4.9, 41, v_ccpur_id, 'booking_venue', false),
    (v_l_book_hall, v_admin_id, 'Tuibong Community Hall', '[SAMPLE] Tuibong Community Event Hall', 'business', 'Event & Community Halls', v_sub_book_hall, 'published', 'active',
      'Tuibong', 'Main Bazar Road, Tuibong, Churachandpur 795128', '400-seat event & wedding hall with PA sound system add-on, generator backup & parking.', 'Spacious community banquet and conference hall bookable for half-day or full-day events.', 6500, '+91 98620 22002', '+91 98620 22002',
      'https://picsum.photos/seed/dd-tuibong-hall/960/640', '[]'::jsonb, '{"lat":24.3432,"lng":93.6951}'::jsonb, 24.3432, 93.6951, 4.6, 17, v_ccpur_id, 'booking_venue', false),
    (v_l_hotel_cc, v_admin_id, 'Hillcrest Hospitality', '[SAMPLE] Hillcrest Heritage Hotel — Lamka', 'business', 'Hotels & Homestays', v_sub_hotel_std, 'published', 'active',
      'New Lamka', 'Tedim Road, New Lamka, Churachandpur 795128', 'Comfortable hill hotel with Wi-Fi, 24x7 hot water, power backup, parking & multi-room nightly inventory.', 'Clean, family-friendly hotel in New Lamka with instant room confirmation and Check-In OTP.', 1800, '+91 98620 22003', '+91 98620 22003',
      'https://picsum.photos/seed/dd-hillcrest-hotel/960/640', '[]'::jsonb, '{"lat":24.3324,"lng":93.6801}'::jsonb, 24.3324, 93.6801, 4.8, 33, v_ccpur_id, 'hotel_stay', false),
    (v_l_hotel_az, v_admin_id, 'Zarkawt Homestay', '[SAMPLE] Zarkawt Ridge Homestay — Aizawl', 'business', 'Hotels & Homestays', v_sub_hotel_std, 'published', 'active',
      'Zarkawt', 'Zarkawt Main Ridge, Aizawl 796007', 'Panoramic valley-view homestay with home-cooked Mizo breakfast, Wi-Fi & hot water.', 'Warm hillside homestay in Zarkawt ideal for business travelers and families.', 1500, '+91 98630 22004', '+91 98630 22004',
      'https://picsum.photos/seed/dd-zarkawt-stay/960/640', '[]'::jsonb, '{"lat":23.7329,"lng":92.7182}'::jsonb, 23.7329, 92.7182, 4.9, 27, v_aizawl_id, 'hotel_stay', false);

  INSERT INTO public.listing_hotel_profiles (
    listing_id, hub_id, stay_type, check_in_time, check_out_time, amenities, verified_amenities, is_accepting_bookings
  ) VALUES
    (v_l_hotel_cc, v_ccpur_id, 'hotel', '12:00 PM', '11:00 AM',
      '{"wifi":true,"parking":true,"hot_water":true,"power_backup":true,"ac":true,"heater":true,"in_house_kitchen":true,"early_checkin":false}'::jsonb,
      '{"wifi":true,"parking":true,"hot_water":true,"power_backup":true}'::jsonb, true),
    (v_l_hotel_az, v_aizawl_id, 'homestay', '1:00 PM', '11:00 AM',
      '{"wifi":true,"parking":false,"hot_water":true,"power_backup":true,"ac":false,"heater":true,"in_house_kitchen":true,"early_checkin":true}'::jsonb,
      '{"wifi":true,"hot_water":true,"in_house_kitchen":true}'::jsonb, true);

  INSERT INTO public.listing_booking_resources (
    id, listing_id, hub_id, resource_vertical, name, description, pricing_unit,
    base_rate_inr, peak_rate_inr, peak_start_hour, peak_end_hour, open_hour, close_hour,
    total_units, max_guests, addons, is_active, sort_order
  ) VALUES
    (v_res_turf_5v5, v_l_book_turf, v_ccpur_id, 'booking_venue', '5v5 / 7v7 Floodlit Pitch', 'Main synthetic grass pitch with evening floodlights.', 'hourly', 800, 1100, 18, 22, 6, 22, 1, 14, '[{"key":"bibs_ball","label":"Match Ball & Bibs","price_inr":100,"per_unit":false}]'::jsonb, true, 10),
    (v_res_hall_main, v_l_book_hall, v_ccpur_id, 'booking_venue', 'Main Banquet & Event Hall', '400-guest indoor hall with stage & chairs.', 'half_day', 6500, NULL, NULL, NULL, 7, 22, 1, 400, '[{"key":"pa_system","label":"PA Sound & 2 Mics","price_inr":1500,"per_unit":false}]'::jsonb, true, 10),
    (v_res_hotel_dlx, v_l_hotel_cc, v_ccpur_id, 'hotel_stay', 'Deluxe Valley Room', 'Queen bed, attached geyser bath, Wi-Fi & balcony.', 'nightly', 1800, 2100, NULL, NULL, 0, 24, 5, 2, '[{"key":"extra_bed","label":"Extra Mattress","price_inr":400,"per_unit":true}]'::jsonb, true, 10),
    (v_res_home_std, v_l_hotel_az, v_aizawl_id, 'hotel_stay', 'Ridge View Family Suite', 'Spacious hill suite with breakfast included.', 'nightly', 1500, 1800, NULL, NULL, 0, 24, 3, 3, '[{"key":"airport_drop","label":"Lengpui Drop Assist","price_inr":1200,"per_unit":false}]'::jsonb, true, 10);

  -- 4D. Shops & Catalogues (3 listings — 2 subscribed, 1 free)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record
  ) VALUES
    (v_l_shop_mart, v_admin_id, 'Tuibong Daily Mart', '[SAMPLE] Tuibong Daily Mart & Pharmacy', 'business', 'Groceries & Pharmacy', v_sub_shop_groc, 'published', 'active',
      'Tuibong', 'Main Bazar Road, Tuibong, Churachandpur 795128', 'Daily groceries, organic hill staples & OTC pharmacy with 15-min pickup or Pick N Drop.', 'Neighborhood supermarket & wellness counter in Tuibong with live stock toggles.', 150, '+91 98620 33001', '+91 98620 33001',
      'https://picsum.photos/seed/dd-tuibong-mart/960/640', '[]'::jsonb, '{"lat":24.3441,"lng":93.6942}'::jsonb, 24.3441, 93.6942, 4.8, 31, v_ccpur_id, 'shop_catalogue', false),
    (v_l_shop_elec, v_admin_id, 'Khatla Tech Store', '[SAMPLE] Khatla Fresh & Electronics Store', 'business', 'Electronics & Mobile', v_sub_shop_elec, 'published', 'active',
      'Khatla', 'New Secretariat Road, Khatla, Aizawl 796001', 'Fast chargers, power banks, surge guards & Mizo hill coffee with Pick N Drop delivery.', 'Trusted Khatla electronics and daily essentials storefront.', 299, '+91 98630 33002', '+91 98630 33002',
      'https://picsum.photos/seed/dd-khatla-elec/960/640', '[]'::jsonb, '{"lat":23.7204,"lng":92.7128}'::jsonb, 23.7204, 92.7128, 4.7, 19, v_aizawl_id, 'shop_catalogue', false),
    (v_l_shop_free, v_admin_id, 'Mission Veng Bookstall', '[SAMPLE] Mission Veng Stationery Showcase', 'business', 'Groceries & Pharmacy', v_sub_shop_groc, 'published', 'active',
      'Mission Veng', 'Mission Veng Road, Churachandpur 795128', 'School notebooks, exam guides & stationery (Free Showcase — Call to enquire).', 'Local stationery and school supply shop.', 80, '+91 98620 33003', '+91 98620 33003',
      'https://picsum.photos/seed/dd-bookstall/960/640', '[]'::jsonb, '{"lat":24.3304,"lng":93.6851}'::jsonb, 24.3304, 93.6851, 4.5, 8, v_ccpur_id, 'shop_catalogue', false);

  INSERT INTO public.listing_shop_profiles (
    listing_id, hub_id, is_accepting_orders, allow_counter_pickup, allow_pick_n_drop,
    min_order_inr, packaging_fee_inr, prep_time_mins, store_verified, pickup_instructions
  ) VALUES
    (v_l_shop_mart, v_ccpur_id, true, true, true, 50, 10, 15, true, 'Show 4-digit Pickup OTP at Billing Counter 2.'),
    (v_l_shop_elec, v_aizawl_id, true, true, true, 100, 10, 15, true, 'Collect from express desk near main entrance.'),
    (v_l_shop_free, v_ccpur_id, true, true, false, 0, 0, 20, false, 'Call before walk-in pickup.');

  INSERT INTO public.marketplace_products (
    listing_id, owner_id, hub_id, title, description, price, unit, unit_label, category, shop_category_tag, in_stock, is_active, sort_order
  ) VALUES
    (v_l_shop_mart, v_admin_id, v_ccpur_id, 'Local Sticky Rice (Chak-Hao)', 'Aromatic local sticky rice.', 160, 'kg', '1 kg', 'Groceries', 'Groceries', true, true, 10),
    (v_l_shop_mart, v_admin_id, v_ccpur_id, 'Organic Hill Forest Honey', 'Unfiltered raw honey in glass jar.', 380, 'jar', '500g Jar', 'Groceries', 'Groceries', true, true, 20),
    (v_l_shop_mart, v_admin_id, v_ccpur_id, 'Mustard Cooking Oil', 'Pure cold-pressed mustard oil.', 185, 'litre', '1 Litre', 'Groceries', 'Groceries', true, true, 30),
    (v_l_shop_mart, v_admin_id, v_ccpur_id, 'ORS Hydration Pack (5 Sachets)', 'WHO-formula oral rehydration salts.', 110, 'pack', 'Pack of 5', 'Health', 'Medicines', true, true, 40),
    (v_l_shop_mart, v_admin_id, v_ccpur_id, 'First-Aid Antiseptic Kit', 'Compact home first-aid kit.', 240, 'kit', '1 Kit', 'Health', 'Medicines', false, true, 50),
    (v_l_shop_elec, v_admin_id, v_aizawl_id, '33W USB-C Fast Wall Charger', 'BIS-certified 33W PD charger.', 599, 'unit', '1 Unit', 'Electronics', 'Accessories', true, true, 10),
    (v_l_shop_elec, v_admin_id, v_aizawl_id, '10,000 mAh Slim Power Bank', 'Dual USB-A + Type-C fast power bank.', 1099, 'unit', '1 Unit', 'Electronics', 'Accessories', true, true, 20),
    (v_l_shop_elec, v_admin_id, v_aizawl_id, 'Mizo Arabica Ground Coffee', 'Medium-roast Mizoram hill coffee.', 320, 'pack', '250g Pack', 'Groceries', 'Groceries', true, true, 30),
    (v_l_shop_elec, v_admin_id, v_aizawl_id, '4-Socket Surge Extension', 'Heavy-duty spike guard.', 450, 'piece', '1 Piece', 'Electronics', 'Accessories', true, true, 40),
    (v_l_shop_free, v_admin_id, v_ccpur_id, 'A4 Spiral Notebook (Pack of 3)', '300-page ruled notebooks.', 210, 'pack', 'Pack of 3', 'Stationery', 'Stationery', true, true, 10);

  -- 4E. Restaurants & Cafés (3 listings — 2 subscribed, 1 free)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record
  ) VALUES
    (v_l_rest_zobite, v_admin_id, 'Zo-Bite Kitchen', '[SAMPLE] Zo-Bite Café & Momo Kitchen', 'business', 'Fast Food & Momos', v_sub_rest_momo, 'published', 'active',
      'New Lamka', 'Tedim Road, New Lamka, Churachandpur 795128', 'Hand-folded pork & veg momos, smoky thukpa, iced coffee, table reservations & hot Pick N Drop.', 'Popular New Lamka momo café serving steaming dumplings, noodle bowls, and freshly brewed hill coffee.', 250, '+91 98620 44001', '+91 98620 44001',
      'https://picsum.photos/seed/dd-zobite/960/640', '[]'::jsonb, '{"lat":24.3318,"lng":93.6794}'::jsonb, 24.3318, 93.6794, 4.9, 48, v_ccpur_id, 'restaurant_food', false),
    (v_l_rest_bistro, v_admin_id, 'Highland Bistro', '[SAMPLE] Dawrpui Highland Bistro & Bakery', 'business', 'Cafés & Bakeries', v_sub_rest_cafe, 'published', 'active',
      'Dawrpui', 'Bara Bazar Main Street, Dawrpui, Aizawl 796001', 'Fresh sourdough croissants, Mizo Bai platters, espresso & hot-food Pick N Drop delivery.', 'Cozy central Aizawl bakery and bistro offering takeaway, hot-food courier, and table booking.', 400, '+91 98630 44002', '+91 98630 44002',
      'https://picsum.photos/seed/dd-bistro/960/640', '[]'::jsonb, '{"lat":23.7279,"lng":92.7196}'::jsonb, 23.7279, 92.7196, 4.8, 36, v_aizawl_id, 'restaurant_food', false),
    (v_l_rest_free, v_admin_id, 'Pearsonmun Tea Corner', '[SAMPLE] Pearsonmun Hill Tea Corner', 'business', 'Cafés & Bakeries', v_sub_rest_cafe, 'published', 'active',
      'Pearsonmun', 'Pearsonmun Junction, Churachandpur 795128', 'Evening tea, samosas & local snacks (Free menu preview — Walk-in only).', 'Cozy roadside tea stall in Pearsonmun.', 100, '+91 98620 44003', '+91 98620 44003',
      'https://picsum.photos/seed/dd-teacorner/960/640', '[]'::jsonb, '{"lat":24.3215,"lng":93.6716}'::jsonb, 24.3215, 93.6716, 4.4, 7, v_ccpur_id, 'restaurant_food', false);

  INSERT INTO public.listing_restaurant_profiles (
    listing_id, hub_id, cuisines, avg_cost_for_two_inr, is_pure_veg, is_kitchen_open, prep_time_mins,
    allow_takeaway, allow_pick_n_drop, allow_table_booking, max_table_party_size, packaging_fee_inr,
    min_order_inr, fssai_license_no, fssai_verified, pickup_instructions
  ) VALUES
    (v_l_rest_zobite, v_ccpur_id, ARRAY['Local','Momos','Café','Tibetan']::text[], 350, false, true, 20, true, true, true, 12, 15, 100, '21524001000481', true, 'Collect from front takeaway window.'),
    (v_l_rest_bistro, v_aizawl_id, ARRAY['Bakery','Café','Mizo Local']::text[], 450, false, true, 25, true, true, true, 10, 20, 120, '21824001000219', true, 'Pickup at ground floor bakery counter.'),
    (v_l_rest_free, v_ccpur_id, ARRAY['Tea','Snacks']::text[], 120, true, true, 15, true, false, false, 4, 0, 0, NULL, false, 'Walk-in counter only.');

  INSERT INTO public.restaurant_menu_items (
    listing_id, hub_id, category_name, name, description, diet_type, base_price_inr,
    variants, addons, meal_slot, is_bestseller, is_spicy, in_stock, sort_order
  ) VALUES
    (v_l_rest_zobite, v_ccpur_id, 'Momos', 'Steamed Pork Momo', 'Hand-folded dumplings with fiery Raja mirchi dip.', 'non_veg', 110, '[{"key":"half","label":"Half (5 pcs)","price_inr":110},{"key":"full","label":"Full (10 pcs)","price_inr":200}]'::jsonb, '[{"key":"chutney","label":"Extra Chutney","price_inr":20}]'::jsonb, 'all_day', true, true, true, 10),
    (v_l_rest_zobite, v_ccpur_id, 'Momos', 'Steamed Veg Momo', 'Fresh cabbage & ginger dumplings.', 'veg', 90, '[{"key":"half","label":"Half (5 pcs)","price_inr":90},{"key":"full","label":"Full (10 pcs)","price_inr":160}]'::jsonb, '[{"key":"chutney","label":"Extra Chutney","price_inr":20}]'::jsonb, 'all_day', false, false, true, 20),
    (v_l_rest_zobite, v_ccpur_id, 'Noodles', 'Smoked Pork Thukpa', 'Hearty hill noodle soup with smoked pork.', 'non_veg', 180, '[]'::jsonb, '[{"key":"egg","label":"Add Boiled Egg","price_inr":25}]'::jsonb, 'all_day', true, true, true, 30),
    (v_l_rest_zobite, v_ccpur_id, 'Rice', 'Egg Fried Rice', 'Wok-tossed basmati with double egg.', 'egg', 140, '[{"key":"half","label":"Half","price_inr":140},{"key":"full","label":"Full","price_inr":240}]'::jsonb, '[]'::jsonb, 'lunch', false, false, true, 40),
    (v_l_rest_zobite, v_ccpur_id, 'Starters', 'Crispy Chilli Chicken', 'Boneless chicken in garlic chilli glaze.', 'non_veg', 220, '[]'::jsonb, '[]'::jsonb, 'dinner', true, true, true, 50),
    (v_l_rest_zobite, v_ccpur_id, 'Beverages', 'Lamka Iced Americano', 'Cold-brewed regional Arabica coffee.', 'veg', 120, '[]'::jsonb, '[{"key":"cream","label":"Sweet Cream","price_inr":30}]'::jsonb, 'all_day', false, false, false, 60),
    (v_l_rest_bistro, v_aizawl_id, 'Mains', 'Mizo Smoked Pork & Bai Platter', 'Steamed rice with bamboo-shoot Bai & smoked pork.', 'non_veg', 260, '[]'::jsonb, '[{"key":"rice","label":"Extra Rice","price_inr":40}]'::jsonb, 'lunch', true, true, true, 10),
    (v_l_rest_bistro, v_aizawl_id, 'Bakery', 'Butter Croissant', 'Flaky laminated French pastry.', 'egg', 110, '[]'::jsonb, '[]'::jsonb, 'breakfast', true, false, true, 20),
    (v_l_rest_bistro, v_aizawl_id, 'Bakery', 'Blueberry Cheesecake', 'Creamy cheesecake with hill berry compote.', 'veg', 180, '[]'::jsonb, '[]'::jsonb, 'all_day', true, false, true, 30),
    (v_l_rest_bistro, v_aizawl_id, 'Mains', 'Herb Grilled Chicken Bowl', 'Grilled chicken with garlic rice & greens.', 'non_veg', 290, '[]'::jsonb, '[]'::jsonb, 'all_day', false, false, true, 40),
    (v_l_rest_bistro, v_aizawl_id, 'Beverages', 'Mizoram Single-Origin Cappuccino', 'Double espresso with velvety steamed milk.', 'veg', 140, '[]'::jsonb, '[]'::jsonb, 'all_day', false, false, true, 50),
    (v_l_rest_free, v_ccpur_id, 'Snacks', 'Masala Chai & Samosa Pair', 'Hot spiced tea with two crispy samosas.', 'veg', 50, '[]'::jsonb, '[]'::jsonb, 'all_day', true, false, true, 10);

  -- 4F. Real Estate (4 listings — 2 CCPur, 2 Aizawl)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record
  ) VALUES
    (v_l_re_rent, v_admin_id, 'Tuibong Homeowner', '[SAMPLE] 2 BHK Family House near Tuibong Main Road', 'real_estate', 'Houses & Flats for Rent', v_sub_re_rent, 'published', 'active',
      'Tuibong', 'Near Tuibong Main Road, Churachandpur 795128', 'Bright 2 BHK family house with 24x7 water, car road & parking (30-day Featured Boost).', 'Well-ventilated 2 BHK independent ground-floor house 150m off Tuibong Main Road.', 11000, '+91 98620 77101', '+91 98620 77101',
      'https://picsum.photos/seed/dd-re-rent/960/640', '[]'::jsonb, '{"lat":24.3452,"lng":93.6958}'::jsonb, 24.3452, 93.6958, 4.8, 7, v_ccpur_id, 'real_estate', false),
    (v_l_re_plot, v_admin_id, 'Lamka Land Trust', '[SAMPLE] Clear Patta Residential Plot — Lamka Hill View', 'real_estate', 'Plots & Land for Sale', v_sub_re_plot, 'published', 'active',
      'New Lamka', 'Hill View Lane, New Lamka, Churachandpur 795128', 'Clear Patta 40x60 ft residential plot with car road & Hub-verified Patta.', 'Ready-to-build 40x60 ft plot in New Lamka with blacktopped road frontage.', 2850000, '+91 98620 77102', '+91 98620 77102',
      'https://picsum.photos/seed/dd-re-plot/960/640', '[]'::jsonb, '{"lat":24.3296,"lng":93.6761}'::jsonb, 24.3296, 93.6761, 4.9, 5, v_ccpur_id, 'real_estate', false),
    (v_l_re_shop, v_admin_id, 'Dawrpui Commercial', '[SAMPLE] Ground Floor Commercial Shop — Dawrpui Market', 'real_estate', 'Commercial Shops & Lease', v_sub_re_comm, 'published', 'active',
      'Dawrpui', 'Bara Bazar Main Street, Dawrpui, Aizawl 796001', '380 sq.ft ground-floor retail shop with shutter & power backup (Site Verified ✓).', 'Prime ground-floor retail shop space on Dawrpui Main Street.', 18000, '+91 98630 88201', '+91 98630 88201',
      'https://picsum.photos/seed/dd-re-shop/960/640', '[]'::jsonb, '{"lat":23.7285,"lng":92.7191}'::jsonb, 23.7285, 92.7191, 4.7, 9, v_aizawl_id, 'real_estate', false),
    (v_l_re_pg, v_admin_id, 'Khatla Residency', '[SAMPLE] Semi-Furnished 1 BHK / PG Flat — Khatla', 'real_estate', 'Houses & Flats for Rent', v_sub_re_rent, 'published', 'active',
      'Khatla', 'Secretariat Link Lane, Khatla, Aizawl 796001', 'Cozy 1 BHK flat with 24x7 water & two-wheeler lane (freshness expiring in 2 days).', 'Ideal for working professionals near New Secretariat, Khatla.', 9500, '+91 98630 88202', '+91 98630 88202',
      'https://picsum.photos/seed/dd-re-pg/960/640', '[]'::jsonb, '{"lat":23.7212,"lng":92.7134}'::jsonb, 23.7212, 92.7134, 4.6, 6, v_aizawl_id, 'real_estate', false);

  INSERT INTO public.listing_real_estate_profiles (
    listing_id, hub_id, deal_type, property_type, price_inr, price_period, deposit_inr,
    is_negotiable, bedrooms, bathrooms, area_sqft, land_area_text, furnishing, patta_status,
    water_supply, road_access, power_backup, parking_available, listed_by_role,
    show_exact_pin, contact_reveal_policy, patta_verified, site_verified,
    verified_boost_expires_at, availability_status, last_confirmed_available_at, freshness_expires_at
  ) VALUES
    (v_l_re_rent, v_ccpur_id, 'rent', 'house', 11000, 'monthly', 15000, true, 2, 2, 1050, '1,050 sq.ft', 'semi_furnished', 'not_applicable', '24x7', 'car_accessible', true, true, 'owner', false, 'after_visit_accept', false, true, now() + interval '30 days', 'available', now(), now() + interval '30 days'),
    (v_l_re_plot, v_ccpur_id, 'sale', 'plot_land', 2850000, 'total', NULL, true, NULL, NULL, 2400, '40 x 60 ft', 'not_applicable', 'verified_patta', 'municipal', 'car_accessible', false, true, 'owner', false, 'direct_call', true, true, NULL, 'available', now(), now() + interval '30 days'),
    (v_l_re_shop, v_aizawl_id, 'lease', 'commercial_shop', 18000, 'monthly', 36000, true, NULL, 1, 380, '380 sq.ft', 'unfurnished', 'leasehold', 'municipal', 'car_accessible', true, false, 'agent', true, 'direct_call', false, true, NULL, 'available', now(), now() + interval '30 days'),
    (v_l_re_pg, v_aizawl_id, 'pg_hostel', 'room_pg', 9500, 'monthly', 10000, true, 1, 1, 560, '560 sq.ft', 'semi_furnished', 'not_applicable', '24x7', 'two_wheeler_only', false, false, 'owner', false, 'after_visit_accept', false, false, NULL, 'available', now() - interval '28 days', now() + interval '2 days');

  -- 4G. General Listings (2 active + 1 custody_admin archived w/ suspended staff)
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, category_id, status, lifecycle_status, archived_at, archive_reason,
    locality, address, short_description, description, price, contact_phone, phone,
    cover_image, gallery_images, coordinates, lat, lng, rating, review_count, hub_id, listing_vertical, is_civic_record
  ) VALUES
    (v_l_gen_hw, v_admin_id, 'Hiangtam Hardware', '[SAMPLE] Hiangtam Hardware & Inverter Repair', 'service', 'Hardware & Repairs', v_sub_gen_repair, 'published', 'active', NULL, NULL,
      'Hiangtam Lamka', 'Main Road, Hiangtam Lamka, Churachandpur 795128', 'Plumbing hardware, inverter battery service & electrician dispatch.', 'Full-service neighborhood hardware & electrical repair workshop.', 350, '+91 98620 99001', '+91 98620 99001',
      'https://picsum.photos/seed/dd-hw/960/640', '[]'::jsonb, '{"lat":24.3352,"lng":93.6819}'::jsonb, 24.3352, 93.6819, 4.6, 12, v_ccpur_id, 'general', false),
    (v_l_gen_drive, v_admin_id, 'Chaltlang Driving School', '[SAMPLE] Chaltlang Hill Driving Academy', 'service', 'Hardware & Repairs', v_sub_gen_repair, 'published', 'active', NULL, NULL,
      'Chaltlang', 'Chaltlang Main Road, Aizawl 796012', 'Licensed 4-wheeler & 2-wheeler hill driving lessons with RTO test prep.', 'Certified driving instructors for steep hill roads and RTO licensing.', 3500, '+91 98630 99002', '+91 98630 99002',
      'https://picsum.photos/seed/dd-drive/960/640', '[]'::jsonb, '{"lat":23.7481,"lng":92.7235}'::jsonb, 23.7481, 92.7235, 4.8, 15, v_aizawl_id, 'general', false),
    (v_l_gen_custody, v_admin_id, 'Former Owner', '[SAMPLE] Old Bazar Cycle Workshop (Admin Custody)', 'service', 'Hardware & Repairs', v_sub_gen_repair, 'archived', 'custody_admin', now() - interval '3 days', 'Owner relocated — held in Super-Admin custody for transfer test.',
      'Lamka Bazar', 'Old Bazar Lane, Churachandpur 795128', 'Archived sample business in Admin Custody for testing ownership transfer & suspended staff cleanup.', 'Sample custody record.', 100, '+91 98620 99003', '+91 98620 99003',
      'https://picsum.photos/seed/dd-custody/960/640', '[]'::jsonb, '{"lat":24.3340,"lng":93.6840}'::jsonb, 24.3340, 93.6840, 4.0, 2, v_ccpur_id, 'general', false);

  INSERT INTO public.staff_delegations (
    listing_id, staff_id, granted_by_owner_id, permissions, vertical_scopes, status
  ) VALUES
    (v_l_gen_custody, v_admin_id, v_admin_id, '["edit_details","reply_enquiries"]'::jsonb, '{"print_ops":true,"booking_desk":true,"kitchen_shop":true,"visit_desk":true,"enquiries":true}'::jsonb, 'suspended_parent_closed');

  -- ===========================================================================
  -- STEP 5: INTERCONNECTED ORDERS, BOOKINGS, VISITS, DRIVER HAT, FLEET & FINANCE
  -- ===========================================================================

  -- 5A. Independent Driver Hat for Admin
  INSERT INTO public.driver_profiles (user_id, hub_id, vehicle_type, vehicle_reg_no, kyc_status, is_online, is_active)
  VALUES (v_admin_id, v_ccpur_id, 'two_wheeler', 'MN-02-DD-4821', 'verified', true, true)
  ON CONFLICT (user_id) DO NOTHING;

  -- Resolve vehicle_type IDs for delivery_orders & vehicle_listings
  SELECT id INTO v_vt_bike FROM public.vehicle_types ORDER BY base_fare_inr ASC LIMIT 1;
  SELECT id INTO v_vt_auto FROM public.vehicle_types ORDER BY base_fare_inr ASC OFFSET 1 LIMIT 1;
  SELECT id INTO v_vt_van  FROM public.vehicle_types ORDER BY base_fare_inr DESC LIMIT 1;
  v_vt_auto := COALESCE(v_vt_auto, v_vt_bike);
  v_vt_van  := COALESCE(v_vt_van, v_vt_bike);
  v_vt_suv  := v_vt_van;

  -- 5B. Pick N Drop Delivery Orders (4 variations: General, Print Sealed, Shop Pickup, Hot Food)
  IF v_vt_bike IS NOT NULL THEN
    INSERT INTO public.delivery_orders (
      id, order_code, hub_id, customer_id, vehicle_type_id, service_mode, trip_type,
      declared_value_inr, prohibited_items_waiver, pickup_address, sender_phone,
      dropoff_address, recipient_name, recipient_phone, distance_km, quoted_fare_inr,
      quote_expires_at, status, sealed_package_required, is_food_order
    ) VALUES
      (v_del_parcel, 'PND-2611-1001', v_ccpur_id, v_admin_id, v_vt_bike, 'parcel', 'one_way', 500, true, 'Lamka Bazar Main Gate', '+91 98620 10001', 'Tuibong DC Colony', 'Lian', '+91 98620 10002', 3.2, 65, now() + interval '1 day', 'escrow_held', false, false),
      (v_del_print,  'PND-2611-1002', v_ccpur_id, v_admin_id, v_vt_bike, 'parcel', 'one_way', 300, true, 'Zomi Digital Print, Tuibong', '+91 98620 11002', 'New Lamka Sector 2', 'Muan', '+91 98620 10003', 2.8, 55, now() + interval '1 day', 'escrow_held', true, false),
      (v_del_shop,   'PND-2611-1003', v_ccpur_id, v_admin_id, v_vt_bike, 'parcel', 'one_way', 600, true, 'Tuibong Daily Mart', '+91 98620 33001', 'Rengkai Road', 'Siam', '+91 98620 10004', 3.5, 70, now() + interval '1 day', 'escrow_held', false, false),
      (v_del_food,   'PND-2611-1004', v_ccpur_id, v_admin_id, v_vt_bike, 'parcel', 'one_way', 400, true, 'Zo-Bite Café, New Lamka', '+91 98620 44001', 'Hiangtam Lamka', 'Vung', '+91 98620 10005', 2.1, 50, now() + interval '1 day', 'escrow_held', false, true);

    INSERT INTO public.delivery_order_secrets (order_id, pickup_otp, dropoff_otp) VALUES
      (v_del_parcel, '4120', '8831'),
      (v_del_print,  '5219', '9042'),
      (v_del_shop,   '6384', '7155'),
      (v_del_food,   '7491', '3368')
    ON CONFLICT (order_id) DO NOTHING;

    -- 5C. Scheduled Vehicles (4 listings) + 2 Bookings
    INSERT INTO public.vehicle_listings (
      id, owner_id, hub_id, vehicle_type_id, title, description, stand_locality,
      lat, lng, booking_mode, total_seats, pricing_model, base_price_inr, advance_percent, is_active
    ) VALUES
      (v_vl_1, v_admin_id, v_ccpur_id, v_vt_suv,  '[SAMPLE] Inter-Hub Sumo Cruiser (CCPur ↔ Aizawl)', 'Daily hill cruiser with experienced highway driver & luggage carrier.', 'Lamka Bazar Stand', 24.3335, 93.6833, 'both', 9, 'fixed_route', 650, 30, true),
      (v_vl_2, v_admin_id, v_ccpur_id, v_vt_van,  '[SAMPLE] Tuibong Shifting Mini-Van (Pickup)', 'Covered mini-van ideal for house shifting, furniture & bulk shop stock.', 'Tuibong Stand', 24.3441, 93.6942, 'full_vehicle', 2, 'hourly', 450, 25, true),
      (v_vl_3, v_admin_id, v_aizawl_id, v_vt_auto, '[SAMPLE] Lengpui Airport Express Cab — Aizawl', 'Punctual AC sedan pickup/drop between Dawrpui & Lengpui Airport.', 'Dawrpui Stand', 23.7279, 92.7196, 'full_vehicle', 4, 'fixed_route', 1400, 30, true),
      (v_vl_4, v_admin_id, v_aizawl_id, v_vt_bike, '[SAMPLE] Zarkawt Scooter Rental (Daily)', 'Well-maintained 125cc scooter for local errands & hill commute.', 'Zarkawt', 23.7325, 92.7180, 'full_vehicle', 2, 'daily', 500, 20, true);

    INSERT INTO public.vehicle_bookings (
      booking_code, hub_id, vehicle_listing_id, customer_id, booking_mode, seats_booked,
      start_time, end_time, pickup_location, dropoff_location, total_fare_inr, advance_amount_inr, balance_due_inr, status
    ) VALUES
      ('VHB-2611-2001', v_ccpur_id, v_vl_1, v_admin_id, 'per_seat', 2, now() + interval '1 day', now() + interval '1 day 6 hours', 'Lamka Bazar Stand', 'Dawrpui Aizawl', 1300, 390, 910, 'confirmed'),
      ('VHB-2611-2002', v_ccpur_id, v_vl_2, v_admin_id, 'full_vehicle', 1, now() + interval '2 days', now() + interval '2 days 3 hours', 'Tuibong Main Road', 'New Lamka', 1350, 340, 1010, 'pending_payment_confirm');
  END IF;

  -- 5D. Print Orders (4 variations) + Files + Events
  INSERT INTO public.print_orders (
    id, order_code, hub_id, listing_id, customer_id, is_first_party_order, job_mode,
    customer_instructions, quoted_amount_inr, platform_fee_inr, payment_rail, handover_mode,
    linked_delivery_order_id, sealed_envelope_requested, collection_otp_hash, collection_otp_display_for_customer,
    quote_status, payment_status, fulfillment_status, settlement_status, purge_status, purge_scheduled_at
  ) VALUES
    (v_po_1, 'PRT-2611-3001', v_ccpur_id, v_l_print_official, v_admin_id, true, 'instant_print', '20 pages B&W duplex, staple top-left.', 55, 0, 'direct_counter', 'walk_in_pickup', NULL, false, encode(digest('1234','sha256'),'hex'), '1234', 'accepted', 'unpaid', 'ready_for_pickup', 'not_applicable', 'active', NULL),
    (v_po_2, 'PRT-2611-3002', v_ccpur_id, v_l_print_partner,  v_admin_id, false, 'instant_print', 'Confidential land patta color copies in sealed envelope.', 240, 12, 'platform_escrow', 'pick_n_drop', v_del_print, true, encode(digest('5678','sha256'),'hex'), '5678', 'accepted', 'escrow_held', 'printing', 'locked', 'active', NULL),
    (v_po_3, 'PRT-2611-3003', v_ccpur_id, v_l_print_partner,  v_admin_id, false, 'custom_digital', 'Need 200 glossy business cards designed & printed.', NULL, 0, 'platform_escrow', 'walk_in_pickup', NULL, false, NULL, NULL, 'awaiting_shop_quote', 'not_required_yet', 'draft', 'not_applicable', 'active', NULL),
    (v_po_4, 'PRT-2611-3004', v_ccpur_id, v_l_print_partner,  v_admin_id, false, 'instant_print', 'Spiral-bound college project report.', 180, 9, 'platform_escrow', 'walk_in_pickup', NULL, false, encode(digest('9012','sha256'),'hex'), '9012', 'accepted', 'escrow_held', 'collected', 'settled', 'scheduled', now() + interval '12 hours');

  INSERT INTO public.print_order_files (
    print_order_id, storage_path, display_label_masked, mime_type, file_size_bytes, server_verified_pages, purge_status
  ) VALUES
    (v_po_1, 'print-vault/sample/notes-a4.pdf', 'Exam_Notes_****.pdf', 'application/pdf', 420000, 20, 'active'),
    (v_po_2, 'print-vault/sample/patta-doc.pdf', 'Land_Patta_****.pdf', 'application/pdf', 890000, 8, 'active');

  INSERT INTO public.print_order_events (print_order_id, actor_id, event_type, payload) VALUES
    (v_po_1, v_admin_id, 'ready_for_pickup', '{"note":"Ready at Express Counter 1"}'::jsonb),
    (v_po_2, v_admin_id, 'printing_started', '{"sealed_envelope":true}'::jsonb);

  -- 5E. Resource Bookings (5 variations: confirmed, checked_in, walk_in_block, pending_payment, completed)
  INSERT INTO public.resource_bookings (
    id, booking_code, hub_id, listing_id, resource_id, customer_id, is_walk_in_block,
    guest_name, guest_phone, start_at, end_at, units_booked, guests_count,
    base_amount_inr, addons_amount_inr, total_amount_inr, advance_amount_inr, balance_at_venue_inr, convenience_fee_inr,
    payment_rail, checkin_otp_hash, checkin_otp_display_for_customer,
    booking_status, payment_status, settlement_status
  ) VALUES
    (v_rb_1, 'DDB-2611-4001', v_ccpur_id, v_l_book_turf, v_res_turf_5v5, v_admin_id, false, 'Thangboi FC', '+91 98620 50001', now() + interval '1 day', now() + interval '1 day 2 hours', 1, 10, 1600, 100, 1700, 510, 1190, 15, 'platform_escrow', encode(digest('2468','sha256'),'hex'), '2468', 'confirmed', 'advance_escrow_held', 'locked'),
    (v_rb_2, 'DDB-2611-4002', v_ccpur_id, v_l_hotel_cc,  v_res_hotel_dlx, v_admin_id, false, 'Mercy Lal', '+91 98620 50002', now() - interval '2 hours', now() + interval '22 hours', 1, 2, 1800, 0, 1800, 1800, 0, 54, 'platform_escrow', encode(digest('1357','sha256'),'hex'), '1357', 'checked_in', 'fully_prepaid_escrow', 'eligible'),
    (v_rb_3, 'DDB-2611-4003', v_ccpur_id, v_l_book_turf, v_res_turf_5v5, v_admin_id, true,  'Phone Walk-In Match', '+91 98620 50003', now() + interval '4 hours', now() + interval '5 hours', 1, 10, 800, 0, 800, 0, 800, 0, 'direct_counter', NULL, NULL, 'blocked', 'unpaid', 'not_applicable'),
    (v_rb_4, 'DDB-2611-4004', v_aizawl_id, v_l_hotel_az, v_res_home_std, v_admin_id, false, 'David Zote', '+91 98630 50004', now() + interval '3 days', now() + interval '5 days', 1, 2, 3000, 0, 3000, 900, 2100, 27, 'platform_escrow', encode(digest('8642','sha256'),'hex'), '8642', 'pending_payment', 'unpaid', 'not_applicable'),
    (v_rb_5, 'DDB-2611-4005', v_ccpur_id, v_l_book_hall, v_res_hall_main, v_admin_id, false, 'Youth Fellowship', '+91 98620 50005', now() - interval '5 days', now() - interval '4 days 18 hours', 1, 250, 6500, 1500, 8000, 2400, 5600, 72, 'platform_escrow', encode(digest('9753','sha256'),'hex'), '9753', 'completed', 'advance_escrow_held', 'settled');

  -- 5F. Shop Orders (3 variations)
  INSERT INTO public.shop_orders (
    id, order_code, hub_id, listing_id, customer_id, items_snapshot,
    subtotal_inr, packaging_fee_inr, delivery_fee_inr, total_amount_inr,
    handover_mode, linked_delivery_order_id, payment_rail,
    pickup_otp_hash, pickup_otp_display_for_customer,
    order_status, payment_status, settlement_status
  ) VALUES
    (v_so_1, 'DDS-2611-5001', v_ccpur_id, v_l_shop_mart, v_admin_id, '[{"product_id":"p1","title":"Local Sticky Rice (Chak-Hao)","qty":2,"unit_price_inr":160,"line_total_inr":320}]'::jsonb, 320, 10, 0, 330, 'counter_pickup', NULL, 'direct_counter', encode(digest('3141','sha256'),'hex'), '3141', 'ready_for_pickup', 'unpaid', 'not_applicable'),
    (v_so_2, 'DDS-2611-5002', v_ccpur_id, v_l_shop_mart, v_admin_id, '[{"product_id":"p2","title":"Organic Hill Forest Honey","qty":1,"unit_price_inr":380,"line_total_inr":380},{"product_id":"p3","title":"Mustard Cooking Oil","qty":1,"unit_price_inr":185,"line_total_inr":185}]'::jsonb, 565, 10, 70, 645, 'pick_n_drop', v_del_shop, 'platform_escrow', encode(digest('2718','sha256'),'hex'), '2718', 'packing', 'escrow_held', 'locked'),
    (v_so_3, 'DDS-2611-5003', v_aizawl_id, v_l_shop_elec, v_admin_id, '[{"product_id":"p4","title":"33W USB-C Fast Wall Charger","qty":1,"unit_price_inr":599,"line_total_inr":599}]'::jsonb, 599, 10, 0, 609, 'counter_pickup', NULL, 'platform_escrow', encode(digest('1618','sha256'),'hex'), '1618', 'completed', 'escrow_held', 'eligible');

  -- 5G. Restaurant Orders (4 variations) + Table Reservations (3 variations)
  INSERT INTO public.restaurant_orders (
    id, order_code, hub_id, listing_id, customer_id, items_snapshot,
    subtotal_inr, packaging_fee_inr, delivery_fee_inr, total_amount_inr,
    fulfillment_mode, linked_delivery_order_id, payment_rail, estimated_prep_mins,
    pickup_otp_hash, pickup_otp_display_for_customer, cooking_instructions,
    kitchen_status, payment_status, settlement_status
  ) VALUES
    (v_ro_1, 'DDF-2611-6001', v_ccpur_id, v_l_rest_zobite, v_admin_id, '[{"menu_item_id":"m1","name":"Steamed Pork Momo","diet_type":"non_veg","variant_label":"Full (10 pcs)","qty":1,"unit_price_inr":200,"line_total_inr":200}]'::jsonb, 200, 15, 0, 215, 'takeaway', NULL, 'direct_counter', 20, encode(digest('4411','sha256'),'hex'), '4411', 'Extra spicy chutney please', 'new_order', 'unpaid', 'not_applicable'),
    (v_ro_2, 'DDF-2611-6002', v_ccpur_id, v_l_rest_zobite, v_admin_id, '[{"menu_item_id":"m3","name":"Smoked Pork Thukpa","diet_type":"non_veg","qty":2,"unit_price_inr":180,"line_total_inr":360}]'::jsonb, 360, 15, 50, 425, 'pick_n_drop', v_del_food, 'platform_escrow', 20, encode(digest('5522','sha256'),'hex'), '5522', 'Pack soup separately', 'preparing', 'escrow_held', 'locked'),
    (v_ro_3, 'DDF-2611-6003', v_aizawl_id, v_l_rest_bistro, v_admin_id, '[{"menu_item_id":"m7","name":"Mizo Smoked Pork & Bai Platter","diet_type":"non_veg","qty":1,"unit_price_inr":260,"line_total_inr":260},{"menu_item_id":"m9","name":"Blueberry Cheesecake","diet_type":"veg","qty":1,"unit_price_inr":180,"line_total_inr":180}]'::jsonb, 440, 20, 0, 460, 'takeaway', NULL, 'platform_escrow', 25, encode(digest('6633','sha256'),'hex'), '6633', NULL, 'ready_for_pickup', 'escrow_held', 'locked'),
    (v_ro_4, 'DDF-2611-6004', v_aizawl_id, v_l_rest_bistro, v_admin_id, '[{"menu_item_id":"m8","name":"Butter Croissant","diet_type":"egg","qty":3,"unit_price_inr":110,"line_total_inr":330}]'::jsonb, 330, 20, 0, 350, 'takeaway', NULL, 'platform_escrow', 20, encode(digest('7744','sha256'),'hex'), '7744', NULL, 'completed', 'escrow_held', 'settled');

  INSERT INTO public.restaurant_table_reservations (
    reservation_code, hub_id, listing_id, customer_id, guest_name, guest_phone, party_size, reserved_for, special_request, status
  ) VALUES
    ('DDT-2611-7001', v_ccpur_id, v_l_rest_zobite, v_admin_id, 'Kim & Family', '+91 98620 60001', 4, now() + interval '5 hours', 'Corner window table', 'requested'),
    ('DDT-2611-7002', v_aizawl_id, v_l_rest_bistro, v_admin_id, 'Rema Zote', '+91 98630 60002', 2, now() + interval '1 day', 'Quiet coffee booth', 'confirmed'),
    ('DDT-2611-7003', v_ccpur_id, v_l_rest_zobite, v_admin_id, 'Pau Lun', '+91 98620 60003', 6, now() - interval '30 minutes', 'Birthday dessert', 'seated');

  -- 5H. Real Estate Site Visit Requests (3 variations)
  INSERT INTO public.property_visit_requests (
    request_code, hub_id, listing_id, requester_id, requester_name, requester_phone,
    preferred_date, preferred_slot, message, status, owner_note, contact_revealed
  ) VALUES
    ('DDV-2611-8001', v_ccpur_id, v_l_re_rent, v_admin_id, 'Ginlian', '+91 98620 70001', (current_date + 1), 'morning', 'Looking for family shift next month.', 'requested', NULL, false),
    ('DDV-2611-8002', v_ccpur_id, v_l_re_plot, v_admin_id, 'Hminga', '+91 98620 70002', (current_date + 2), 'afternoon', 'Want to inspect road access & patta copy.', 'accepted', 'Welcome at 2 PM near Hill View Lane gate.', true),
    ('DDV-2611-8003', v_aizawl_id, v_l_re_shop, v_admin_id, 'Malsawma', '+91 98630 70003', (current_date - 2), 'evening', 'Checking retail frontage.', 'completed', 'Visited and discussed lease terms.', true);

  -- 5I. Bulletins (4), Reviews, Enquiries, Saved Items & Notifications
  INSERT INTO public.bulletins (
    author_id, hub_id, linked_listing_id, category, title, content_json, excerpt, status, is_pinned, expires_at
  ) VALUES
    (v_admin_id, v_ccpur_id, v_l_book_turf, 'event', 'Lamka 5v5 Night Football Cup — Registrations Open', '{"text":"Register your 7-player squad before Friday evening. Floodlights & trophies included."}'::jsonb, 'Night 5v5 tournament at Lamka Arena Turf.', 'published', true, now() + interval '14 days'),
    (v_admin_id, v_ccpur_id, v_l_shop_mart, 'advertisement', 'Fresh Harvest Chak-Hao & Raw Forest Honey Back In Stock', '{"text":"Order online from Tuibong Daily Mart with 15-min pickup or Pick N Drop."}'::jsonb, 'Organic hill staples restocked in Tuibong.', 'published', false, now() + interval '10 days'),
    (v_admin_id, v_aizawl_id, v_l_rest_bistro, 'announcement', 'Sunday Sourdough & Mizo Bai Brunch at Dawrpui Bistro', '{"text":"Reserve your table online on DD oodle — zero booking fee."}'::jsonb, 'Fresh bakery brunch in central Aizawl.', 'published', true, now() + interval '7 days'),
    (v_admin_id, v_aizawl_id, NULL, 'job', 'Hiring: 2 Delivery Riders & Kitchen Helper (Aizawl Hub)', '{"text":"Flexible hours, verified payouts, two-wheeler preferred. Apply via DD oodle Hub Office."}'::jsonb, 'Local rider & kitchen openings in Aizawl.', 'published', false, now() + interval '21 days');

  INSERT INTO public.reviews (listing_id, author_id, author_name, rating, comment) VALUES
    (v_l_rest_zobite, v_admin_id, 'Local Explorer', 5, 'Best steamed pork momos in New Lamka and super fast hot delivery!'),
    (v_l_book_turf,   v_admin_id, 'Local Explorer', 5, 'Smooth turf surface and instant Check-In OTP worked cleanly.'),
    (v_l_hotel_az,    v_admin_id, 'Local Explorer', 5, 'Spotless rooms and gorgeous Zarkawt valley sunrise.');

  INSERT INTO public.enquiries (listing_id, sender_name, sender_contact, message, status) VALUES
    (v_l_gen_hw, 'Siam', '+91 98620 81001', 'Do you repair Luminous 900VA inverters on-site?', 'new'),
    (v_l_book_hall, 'Lian', '+91 98620 81002', 'Is generator fuel included in full-day hall booking?', 'replied');

  INSERT INTO public.user_saved_items (user_id, item_type, item_id, hub_id) VALUES
    (v_admin_id, 'listing', v_l_rest_zobite, v_ccpur_id),
    (v_admin_id, 'listing', v_l_re_rent, v_ccpur_id),
    (v_admin_id, 'listing', v_l_hotel_az, v_aizawl_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.notifications (user_id, title, message, type, is_read) VALUES
    (v_admin_id, 'Welcome to Unified DD oodle', 'Churachandpur & Aizawl hubs are live across all 8 verticals.', 'system', false),
    (v_admin_id, 'Site Visit Accepted', 'Your visit DDV-2611-8002 for Lamka Hill View Plot has been accepted.', 'booking', false);

  -- 5J. User Subscriptions (Active + Expired + Custom Override example)
  INSERT INTO public.user_subscriptions (user_id, plan_id, listing_id, status, starts_at, expires_at, entitlement_overrides) VALUES
    (v_admin_id, v_plan_allinone, NULL, 'active', now() - interval '5 days', now() + interval '25 days', '{"limits":{"max_staff_members":20}}'::jsonb),
    (v_admin_id, v_plan_print, v_l_print_partner, 'active', now() - interval '10 days', now() + interval '20 days', '{}'::jsonb),
    (v_admin_id, v_plan_shop, v_l_shop_mart, 'active', now() - interval '3 days', now() + interval '27 days', '{}'::jsonb),
    (v_admin_id, v_plan_rest, v_l_rest_zobite, 'active', now() - interval '3 days', now() + interval '27 days', '{}'::jsonb),
    (v_admin_id, v_plan_book, v_l_book_turf, 'expired', now() - interval '40 days', now() - interval '10 days', '{}'::jsonb);

  -- 5K. Unified Payment Intents (Razorpay + Manual UPI pending/verified)
  INSERT INTO public.payment_intents (
    id, intent_code, user_id, hub_id, purpose, reference_id,
    print_order_id, resource_booking_id, shop_order_id, restaurant_order_id, real_estate_listing_id,
    amount_inr, base_amount_inr, convenience_fee_inr, provider, upi_utr_ref, status, expires_at
  ) VALUES
    (v_pi_1, 'PSL-R1001', v_admin_id, v_ccpur_id, 'print_order_with_delivery', v_po_2, v_po_2, NULL, NULL, NULL, NULL, 295, 295, 0, 'razorpay', NULL, 'succeeded', now() + interval '1 day'),
    (v_pi_2, 'PSL-R1002', v_admin_id, v_ccpur_id, 'resource_booking', v_rb_1, NULL, v_rb_1, NULL, NULL, NULL, 525, 510, 15, 'manual_upi', 'UTR429188271601', 'succeeded', now() + interval '1 day'),
    (v_pi_3, 'PSL-R1003', v_admin_id, v_ccpur_id, 'shop_order_with_delivery', v_so_2, NULL, NULL, v_so_2, NULL, NULL, 645, 645, 0, 'razorpay', NULL, 'succeeded', now() + interval '1 day'),
    (v_pi_4, 'PSL-R1004', v_admin_id, v_ccpur_id, 'restaurant_order_with_delivery', v_ro_2, NULL, NULL, NULL, v_ro_2, NULL, 425, 425, 0, 'manual_upi', 'UTR429188271604', 'pending_manual', now() + interval '1 day'),
    (v_pi_5, 'PSL-R1005', v_admin_id, v_ccpur_id, 'real_estate_boost_30d', v_l_re_rent, NULL, NULL, NULL, NULL, v_l_re_rent, 299, 299, 0, 'manual_upi', 'UTR429188271605', 'succeeded', now() + interval '1 day'),
    (v_pi_6, 'PSL-R1006', v_admin_id, v_aizawl_id, 'resource_booking', v_rb_4, NULL, v_rb_4, NULL, NULL, NULL, 927, 900, 27, 'manual_upi', NULL, 'awaiting_payment', now() + interval '1 hour');

  -- 5L. Unified 4-Source Merchant Settlements (locked, eligible, settled)
  INSERT INTO public.merchant_settlements (
    hub_id, listing_id, owner_id, print_order_id, resource_booking_id, shop_order_id, restaurant_order_id,
    settlement_source, gross_amount_inr, platform_fee_inr, net_payable_inr, status, utr_reference, settled_at
  ) VALUES
    (v_ccpur_id, v_l_print_partner, v_admin_id, v_po_2, NULL, NULL, NULL, 'print_order', 240, 12, 228, 'locked', NULL, NULL),
    (v_ccpur_id, v_l_print_partner, v_admin_id, v_po_4, NULL, NULL, NULL, 'print_order', 180, 9, 171, 'settled', 'SET-UTR-9901', now() - interval '1 day'),
    (v_ccpur_id, v_l_hotel_cc,      v_admin_id, NULL, v_rb_2, NULL, NULL, 'resource_booking', 1800, 54, 1746, 'eligible', NULL, NULL),
    (v_ccpur_id, v_l_book_hall,     v_admin_id, NULL, v_rb_5, NULL, NULL, 'resource_booking', 2400, 72, 2328, 'settled', 'SET-UTR-9902', now() - interval '2 days'),
    (v_ccpur_id, v_l_shop_mart,     v_admin_id, NULL, NULL, v_so_2, NULL, 'shop_order', 575, 0, 575, 'locked', NULL, NULL),
    (v_aizawl_id, v_l_shop_elec,    v_admin_id, NULL, NULL, v_so_3, NULL, 'shop_order', 609, 0, 609, 'eligible', NULL, NULL),
    (v_ccpur_id, v_l_rest_zobite,   v_admin_id, NULL, NULL, NULL, v_ro_2, 'restaurant_order', 375, 0, 375, 'locked', NULL, NULL),
    (v_aizawl_id, v_l_rest_bistro,  v_admin_id, NULL, NULL, NULL, v_ro_4, 'restaurant_order', 350, 0, 350, 'settled', 'SET-UTR-9903', now() - interval '1 day');

  -- 5M. Media Asset Registry Sample Rows (Active + Expired Temp Draft + Marked for Deletion)
  INSERT INTO public.media_assets (
    bucket_id, storage_path, public_url, uploaded_by, hub_id, file_size_bytes, mime_type,
    entity_type, entity_id, retention_class, status, expires_at
  ) VALUES
    ('listing-images', 'seed/listings/zobite-cover.jpg', 'https://picsum.photos/seed/dd-zobite/960/640', v_admin_id, v_ccpur_id, 184320, 'image/jpeg', 'listing_cover', v_l_rest_zobite, 'permanent_bound', 'active', NULL),
    ('listing-images', 'seed/drafts/abandoned-upload-01.jpg', NULL, v_admin_id, v_ccpur_id, 512000, 'image/jpeg', 'listing_gallery', NULL, 'temp_draft', 'pending_attach', now() - interval '2 days'),
    ('listing-images', 'seed/archived/old-cover-reclaim.jpg', NULL, v_admin_id, v_ccpur_id, 348160, 'image/jpeg', 'listing_cover', v_l_gen_custody, 'permanent_bound', 'marked_for_deletion', now() - interval '1 hour')
  ON CONFLICT (storage_path) DO NOTHING;

END;
$$;
