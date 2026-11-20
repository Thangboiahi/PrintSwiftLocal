-- =============================================================================
-- Migration: 20261119_phase70a_multi_hub_seed.sql
-- Phase 70-A: Clean Multi-Hub Re-Seed (Churachandpur & Aizawl)
--
-- 100% Idempotent re-seed:
-- 1. Safely purges legacy [SAMPLE] rows (marketplace_products, vehicle_listings,
--    bulletins, reviews, enquiries, listings) with zero impact on real user data.
-- 2. Seeds 6 geographically dispersed Churachandpur listings + marketplace products.
-- 3. Seeds 5 geographically dispersed Aizawl listings + marketplace products.
-- 4. Seeds 3 scheduled vehicle listings (Intra-CCPur 4WD, Intra-Aizawl Taxi, Inter-Hub Cruiser).
-- 5. Seeds 3 multi-hub community bulletins (CCPur, Aizawl, and Inter-Hub Global).
-- 6. Seeds sample reviews, enquiries, pending hub_localities & category_suggestions.
-- =============================================================================

DO $$
DECLARE
  v_ccpur_id uuid;
  v_aizawl_id uuid;
  v_owner_id uuid;
  v_vt_4wd uuid;
  v_vt_taxi uuid;
  v_vt_winger uuid;

  -- Churachandpur listing IDs
  v_ccpur_l1 uuid := 'f0000000-0000-4000-8000-000000000001';
  v_ccpur_l2 uuid := 'f0000000-0000-4000-8000-000000000002';
  v_ccpur_l3 uuid := 'f0000000-0000-4000-8000-000000000003';
  v_ccpur_l4 uuid := 'f0000000-0000-4000-8000-000000000004';
  v_ccpur_l5 uuid := 'f0000000-0000-4000-8000-000000000005';
  v_ccpur_l6 uuid := 'f0000000-0000-4000-8000-000000000006';

  -- Aizawl listing IDs
  v_aizawl_l1 uuid := 'f0000000-0000-4000-8000-0000000000a1';
  v_aizawl_l2 uuid := 'f0000000-0000-4000-8000-0000000000a2';
  v_aizawl_l3 uuid := 'f0000000-0000-4000-8000-0000000000a3';
  v_aizawl_l4 uuid := 'f0000000-0000-4000-8000-0000000000a4';
  v_aizawl_l5 uuid := 'f0000000-0000-4000-8000-0000000000a5';

  -- Dynamic column helpers for reviews & enquiries
  v_rev_name_col text;
  v_rev_has_reply boolean;
  v_rev_has_user_id boolean;
  v_enq_contact_col text;
  v_enq_has_status boolean;

BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Resolve Hub IDs (Fallback to creation if hubs missing)
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;
  SELECT id INTO v_aizawl_id FROM public.service_hubs WHERE slug = 'aizawl' LIMIT 1;

  IF v_ccpur_id IS NULL THEN
    INSERT INTO public.service_hubs (
      slug, name, state, center_lat, center_lng, service_radius_km, default_zoom,
      supported_languages, default_language, status, is_default, sort_order
    ) VALUES (
      'churachandpur', 'Churachandpur', 'Manipur', 24.3333, 93.6833, 25.00, 14,
      ARRAY['en', 'paite', 'manipuri'], 'en', 'active', true, 1
    ) RETURNING id INTO v_ccpur_id;
  END IF;

  IF v_aizawl_id IS NULL THEN
    INSERT INTO public.service_hubs (
      slug, name, state, center_lat, center_lng, service_radius_km, default_zoom,
      supported_languages, default_language, status, is_default, sort_order
    ) VALUES (
      'aizawl', 'Aizawl', 'Mizoram', 23.7271, 92.7176, 25.00, 14,
      ARRAY['en', 'mizo'], 'en', 'active', false, 2
    ) RETURNING id INTO v_aizawl_id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Resolve or Ensure Sample Owner Profile
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_owner_id FROM public.profiles WHERE role IN ('owner', 'super_admin', 'admin') LIMIT 1;
  IF v_owner_id IS NULL THEN
    SELECT id INTO v_owner_id FROM public.profiles LIMIT 1;
  END IF;

  IF v_owner_id IS NULL THEN
    v_owner_id := 'a0000000-0000-0000-0000-000000000001'::uuid;
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (v_owner_id, 'PrintSwift Partner Services', 'sample.partner@printswift.local', 'owner')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. Resolve Vehicle Types
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_vt_4wd
  FROM public.vehicle_types
  WHERE slug IN ('four_wd', 'mini_van', 'two_wheeler')
  ORDER BY CASE WHEN slug = 'four_wd' THEN 1 WHEN slug = 'mini_van' THEN 2 ELSE 3 END
  LIMIT 1;

  SELECT id INTO v_vt_taxi
  FROM public.vehicle_types
  WHERE slug IN ('e_rickshaw', 'mini_van', 'two_wheeler')
  ORDER BY CASE WHEN slug = 'e_rickshaw' THEN 1 WHEN slug = 'mini_van' THEN 2 ELSE 3 END
  LIMIT 1;

  SELECT id INTO v_vt_winger
  FROM public.vehicle_types
  WHERE slug IN ('mini_van', 'four_wd', 'e_rickshaw')
  ORDER BY CASE WHEN slug = 'mini_van' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_vt_4wd IS NULL THEN
    SELECT id INTO v_vt_4wd FROM public.vehicle_types LIMIT 1;
  END IF;
  IF v_vt_taxi IS NULL THEN
    v_vt_taxi := v_vt_4wd;
  END IF;
  IF v_vt_winger IS NULL THEN
    v_vt_winger := v_vt_4wd;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. Clean Legacy Sample Records (100% Idempotent, leaves user data intact)
  -- ---------------------------------------------------------------------------
  DELETE FROM public.marketplace_products
  WHERE title ILIKE '[SAMPLE]%'
     OR listing_id IN (SELECT id FROM public.listings WHERE title ILIKE '[SAMPLE]%');

  DELETE FROM public.vehicle_listings
  WHERE title ILIKE '[SAMPLE]%';

  DELETE FROM public.bulletins
  WHERE title ILIKE '[SAMPLE]%';

  DELETE FROM public.reviews
  WHERE listing_id IN (SELECT id FROM public.listings WHERE title ILIKE '[SAMPLE]%');

  DELETE FROM public.enquiries
  WHERE listing_id IN (SELECT id FROM public.listings WHERE title ILIKE '[SAMPLE]%');

  DELETE FROM public.listings
  WHERE title ILIKE '[SAMPLE]%';

  DELETE FROM public.category_suggestions
  WHERE suggested_name IN ('Bamboo & Cane Crafts', 'Cold Storage & Warehouse');

  DELETE FROM public.hub_localities
  WHERE slug IN ('saikot_road_junction', 'electric_veng_upper')
    AND status = 'pending';

  -- ---------------------------------------------------------------------------
  -- 5. Seed Churachandpur Listings (6 Dispersed Locations)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_ccpur_l1, v_owner_id, 'Lamka Print & Media Group',
    '[SAMPLE] New Lamka Digital Print & Offset', 'business', 'Printing & Signage', 'published',
    'New Lamka', 'Tedim Road, Near Dorcas Hall Junction, New Lamka, Churachandpur, Manipur 795128',
    'High-speed digital printing, flex banners, offset wedding cards, and book binding.',
    'High-speed digital printing, flex banners, offset wedding cards, and book binding in central Lamka. Serving customers across Churachandpur with verified transparent pricing, quick turnaround, and digital UPI payments.',
    450, '+91 98620 11000', 'lamkaprint@sample-printswift.local',
    'https://picsum.photos/seed/printswift-biz-1/960/640',
    '["https://picsum.photos/seed/printswift-biz-1-a/960/640","https://picsum.photos/seed/printswift-biz-1-b/960/640"]'::jsonb,
    '{"lat":24.3120,"lng":93.6695}'::jsonb, 24.3120, 93.6695, 4.8, 12,
    '{"openingHours":"Mon–Sat: 8:30 AM – 7:00 PM","priceRange":"₹₹ · Moderate","deliveryInfo":"Same-day delivery in Lamka","highlights":["Verified Counter","UPI Accepted","Bulk Discounts"]}'::jsonb,
    v_ccpur_id, '+91 98620 11000'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_ccpur_l2, v_owner_id, 'LifeCare Health Services',
    '[SAMPLE] Tuibong LifeCare Pharmacy', 'business', 'Pharmacy & Health', 'published',
    'Tuibong', 'Tipaimukh Road Junction, Near Mini Secretariat, Tuibong, Churachandpur, Manipur 795128',
    '24x7 prescription pharmacy, health supplies, and diagnostic rapid kits.',
    'Complete prescription medications, cold-chain vaccines, baby essentials, and first-aid kits located conveniently near the Mini Secretariat junction in Tuibong.',
    300, '+91 98620 11001', 'tuibongpharm@sample-printswift.local',
    'https://picsum.photos/seed/printswift-biz-2/960/640',
    '["https://picsum.photos/seed/printswift-biz-2-a/960/640","https://picsum.photos/seed/printswift-biz-2-b/960/640"]'::jsonb,
    '{"lat":24.3485,"lng":93.6940}'::jsonb, 24.3485, 93.6940, 4.9, 18,
    '{"openingHours":"Open 24 Hours Daily","priceRange":"₹₹ · Moderate","deliveryInfo":"Emergency night delivery across Tuibong","highlights":["24x7 Counter","Cold-Chain Storage","Wheelchair Accessible"]}'::jsonb,
    v_ccpur_id, '+91 98620 11001'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_ccpur_l3, v_owner_id, 'Hillview Realty Advisors',
    '[SAMPLE] Rengkai Hillview Plots & Homes', 'real_estate', 'Plots & Land', 'published',
    'Rengkai', 'Rengkai Bridge Road, Near Nehru Marg Crossing, Rengkai, Churachandpur, Manipur 795128',
    'Surveyed residential plots and duplex home rentals with hill road access.',
    'Clear patta land titles, verified boundaries, scenic hillside frontage, and reliable water supply connections in the peaceful locality of Rengkai.',
    3500000, '+91 98620 11002', 'realty.rengkai@sample-printswift.local',
    'https://picsum.photos/seed/printswift-re-43/960/640',
    '["https://picsum.photos/seed/printswift-re-43-a/960/640","https://picsum.photos/seed/printswift-re-43-b/960/640"]'::jsonb,
    '{"lat":24.3240,"lng":93.7025}'::jsonb, 24.3240, 93.7025, 4.7, 8,
    '{"openingHours":"Mon–Sat: 9:00 AM – 5:00 PM","priceRange":"₹₹₹ · High","highlights":["Verified Patta","Boundary Marked","Direct Owner Deal"]}'::jsonb,
    v_ccpur_id, '+91 98620 11002'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_ccpur_l4, v_owner_id, 'Zenhang Community Co-op',
    '[SAMPLE] Zenhang Lamka Fresh Mart', 'business', 'Groceries & Mart', 'published',
    'Zenhang Lamka', 'Zenhang Bazar Street, Near Community Hall, Zenhang Lamka, Churachandpur, Manipur 795128',
    'Organic hill spices, cold-pressed oils, fresh vegetables, and pantry staples.',
    'Daily fresh supplies direct from local village farmers. Premium ginger, turmeric, smoked bamboo shoot, hill honey, and staple groceries.',
    250, '+91 98620 11003', 'freshmart.zenhang@sample-printswift.local',
    'https://picsum.photos/seed/printswift-biz-6/960/640',
    '["https://picsum.photos/seed/printswift-biz-6-a/960/640","https://picsum.photos/seed/printswift-biz-6-b/960/640"]'::jsonb,
    '{"lat":24.3390,"lng":93.6790}'::jsonb, 24.3390, 93.6790, 4.6, 15,
    '{"openingHours":"Mon–Sat: 7:00 AM – 8:00 PM","priceRange":"₹ · Budget Friendly","deliveryInfo":"Pick-n-Drop doorstep delivery supported","highlights":["Locally Sourced","Zero Chemicals","Fresh Stock Daily"]}'::jsonb,
    v_ccpur_id, '+91 98620 11003'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_ccpur_l5, v_owner_id, 'Hebron Auto Works',
    '[SAMPLE] Hebron Veng Auto & Diagnostics', 'services', 'Auto Workshop', 'published',
    'Hebron Veng', 'Hebron Veng Road, Near Junction Point, Churachandpur, Manipur 795128',
    '4WD suspension tuning, computerized wheel alignment, and engine diagnostics.',
    'Specialized 4WD mechanic shop for Bolero, Scorpio, Gypsy, and commercial pickup vehicles operating across rugged hill routes in southern Manipur.',
    800, '+91 98620 11004', 'hebronauto@sample-printswift.local',
    'https://picsum.photos/seed/printswift-biz-10/960/640',
    '["https://picsum.photos/seed/printswift-biz-10-a/960/640","https://picsum.photos/seed/printswift-biz-10-b/960/640"]'::jsonb,
    '{"lat":24.3355,"lng":93.6620}'::jsonb, 24.3355, 93.6620, 4.5, 9,
    '{"openingHours":"Mon–Sat: 8:00 AM – 6:00 PM","priceRange":"₹₹ · Moderate","highlights":["4WD Specialists","Hydraulic Lift","Genuine Spare Parts"]}'::jsonb,
    v_ccpur_id, '+91 98620 11004'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_ccpur_l6, v_owner_id, 'Central Tech Solutions',
    '[SAMPLE] Central Lamka Tech & Repair', 'services', 'Phone Repair', 'published',
    'Central Lamka', 'Main Bazar, Central Lamka, Churachandpur, Manipur 795128',
    'Smartphone screen replacement, chip-level laptop repairs, and authentic accessories.',
    'Expert device repairs with genuine display modules, battery replacements, ultrasonic board cleaning, and fast USB-C chargers.',
    500, '+91 98620 11005', 'centraltech@sample-printswift.local',
    'https://picsum.photos/seed/printswift-biz-7/960/640',
    '["https://picsum.photos/seed/printswift-biz-7-a/960/640","https://picsum.photos/seed/printswift-biz-7-b/960/640"]'::jsonb,
    '{"lat":24.3333,"lng":93.6833}'::jsonb, 24.3333, 93.6833, 4.9, 24,
    '{"openingHours":"Mon–Sat: 9:00 AM – 7:30 PM","priceRange":"₹₹ · Moderate","highlights":["Express 60-min Repair","6-Month Warranty","Genuine Spares"]}'::jsonb,
    v_ccpur_id, '+91 98620 11005'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  -- ---------------------------------------------------------------------------
  -- 6. Seed Churachandpur Marketplace Products (Inherits CCPur hub_id)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.marketplace_products (
    listing_id, owner_id, title, description, price, unit, category, in_stock, thumbnail_url, hub_id
  ) VALUES
    (v_ccpur_l1, v_owner_id, '[SAMPLE] A4 Color Flyers (100 pcs)', 'Premium 130 GSM glossy color flyer prints (pack of 100) with edge-to-edge full resolution.', 450.00, 'pack', 'stationery_print', true, 'https://picsum.photos/seed/mp-flyers/400/400', v_ccpur_id),
    (v_ccpur_l1, v_owner_id, '[SAMPLE] Custom Vinyl Banner', 'Durable outdoor UV-resistant eyeletted vinyl banner (6ft x 3ft) for events and shop fronts.', 850.00, 'piece', 'stationery_print', true, 'https://picsum.photos/seed/mp-banner/400/400', v_ccpur_id),
    (v_ccpur_l2, v_owner_id, '[SAMPLE] First-Aid & Wellness Kit', 'Complete family emergency first-aid kit with antiseptic, sterile gauze, bandages, and thermal probe.', 599.00, 'kit', 'home_kitchen', true, 'https://picsum.photos/seed/mp-firstaid/400/400', v_ccpur_id),
    (v_ccpur_l4, v_owner_id, '[SAMPLE] Local Organic Ginger (2kg)', 'Fresh hill-harvested organic ginger with intense aroma, fiber-rich density, and sharp pungency.', 180.00, 'kg', 'local_produce', true, 'https://picsum.photos/seed/mp-ginger/400/400', v_ccpur_id),
    (v_ccpur_l4, v_owner_id, '[SAMPLE] Hill Honey Jar', 'Raw wild forest honey harvested sustainably from Manipur hills (500g glass jar).', 350.00, 'jar', 'local_produce', true, 'https://picsum.photos/seed/mp-honey/400/400', v_ccpur_id),
    (v_ccpur_l6, v_owner_id, '[SAMPLE] Fast USB-C GaN Charger', '65W Dual-port GaN fast charger with intelligent heat dissipation, surge protection, and braided cable.', 799.00, 'piece', 'electronics', true, 'https://picsum.photos/seed/mp-gancharger/400/400', v_ccpur_id);

  -- ---------------------------------------------------------------------------
  -- 7. Seed Aizawl Listings (5 Dispersed Locations)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_aizawl_l1, v_owner_id, 'Aizawl Commercial Press',
    '[SAMPLE] Zarkawt Book & Print House', 'business', 'Printing & Signage', 'published',
    'Zarkawt', 'Zarkawt Main Road, Opposite Millennium Centre, Aizawl, Mizoram 796007',
    'Commercial offset printing, academic binding, and custom stationery in central Aizawl.',
    'High-volume offset printing, thesis hardcover binding, corporate stationery, and customized festive greeting cards located directly in the heart of Zarkawt.',
    400, '+91 98620 22001', 'zarkawtprint@sample-printswift.local',
    'https://picsum.photos/seed/printswift-aizawl-1/960/640',
    '["https://picsum.photos/seed/printswift-aizawl-1-a/960/640","https://picsum.photos/seed/printswift-aizawl-1-b/960/640"]'::jsonb,
    '{"lat":23.7295,"lng":92.7185}'::jsonb, 23.7295, 92.7185, 4.9, 16,
    '{"openingHours":"Mon–Sat: 9:00 AM – 7:00 PM","priceRange":"₹₹ · Moderate","deliveryInfo":"Pick-n-Drop delivery across Aizawl city","highlights":["Near Millennium Centre","Fast Binding","UPI Accepted"]}'::jsonb,
    v_aizawl_id, '+91 98620 22001'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_aizawl_l2, v_owner_id, 'Dawrpui Merchants Guild',
    '[SAMPLE] Dawrpui Central Mart', 'business', 'Groceries & Mart', 'published',
    'Dawrpui', 'Bara Bazar Road, Dawrpui, Aizawl, Mizoram 796001',
    'Mizo traditional textiles, bamboo handicrafts, organic produce, and daily household supplies.',
    'A premier cultural and daily essentials emporium located at Bara Bazar, Dawrpui. Handcrafted bamboo storage, handloom puans, and hill seasonings.',
    350, '+91 98620 22002', 'dawrpui.mart@sample-printswift.local',
    'https://picsum.photos/seed/printswift-aizawl-2/960/640',
    '["https://picsum.photos/seed/printswift-aizawl-2-a/960/640","https://picsum.photos/seed/printswift-aizawl-2-b/960/640"]'::jsonb,
    '{"lat":23.7360,"lng":92.7140}'::jsonb, 23.7360, 92.7140, 4.8, 22,
    '{"openingHours":"Mon–Sat: 8:00 AM – 7:30 PM","priceRange":"₹₹ · Moderate","highlights":["Authentic Puan","Mountain Bamboo","Wholesale Rates"]}'::jsonb,
    v_aizawl_id, '+91 98620 22002'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_aizawl_l3, v_owner_id, 'Chanmari Health Trust',
    '[SAMPLE] Chanmari Ridge Clinic & Lab', 'services', 'Diagnostic & Pathology Lab', 'published',
    'Chanmari', 'Chanmari West Road, Near Ridge Point, Aizawl, Mizoram 796007',
    'Computerized blood diagnostics, digital ECG, and preventive family health checkups.',
    'State-of-the-art pathology testing, computerized biochemical analyzer reports delivered via WhatsApp, and prompt on-site physician consultations.',
    650, '+91 98620 22003', 'chanmari.lab@sample-printswift.local',
    'https://picsum.photos/seed/printswift-aizawl-3/960/640',
    '["https://picsum.photos/seed/printswift-aizawl-3-a/960/640","https://picsum.photos/seed/printswift-aizawl-3-b/960/640"]'::jsonb,
    '{"lat":23.7235,"lng":92.7215}'::jsonb, 23.7235, 92.7215, 4.9, 14,
    '{"openingHours":"Mon–Sat: 7:30 AM – 6:00 PM","priceRange":"₹₹ · Moderate","highlights":["Same-Day Reports","Home Sample Pickup","Digital Reports"]}'::jsonb,
    v_aizawl_id, '+91 98620 22003'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_aizawl_l4, v_owner_id, 'Highland Property Group',
    '[SAMPLE] Khatla Highland Realty', 'real_estate', 'Residential Rental', 'published',
    'Khatla', 'Khatla South Avenue, Near Secretariat Complex, Aizawl, Mizoram 796001',
    'Scenic mountain-view apartments, independent houses, and commercial leases in Khatla.',
    'Verified rental houses, commercial showroom spaces, and hillside plots with excellent approach roads near the administrative hub in Khatla.',
    18000, '+91 98620 22004', 'khatla.realty@sample-printswift.local',
    'https://picsum.photos/seed/printswift-aizawl-4/960/640',
    '["https://picsum.photos/seed/printswift-aizawl-4-a/960/640","https://picsum.photos/seed/printswift-aizawl-4-b/960/640"]'::jsonb,
    '{"lat":23.7310,"lng":92.7080}'::jsonb, 23.7310, 92.7080, 4.6, 7,
    '{"openingHours":"Mon–Sat: 9:30 AM – 6:00 PM","priceRange":"₹₹₹ · High","highlights":["Secretariat Proximity","Panoramic Views","Water Connection"]}'::jsonb,
    v_aizawl_id, '+91 98620 22004'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  INSERT INTO public.listings (
    id, owner_id, owner_name, title, category, subcategory, status,
    locality, address, short_description, description, price,
    contact_phone, contact_email, cover_image, gallery_images,
    coordinates, lat, lng, rating, review_count, business_details, hub_id, phone
  ) VALUES (
    v_aizawl_l5, v_owner_id, 'Highway Motors Aizawl',
    '[SAMPLE] Bawngkawn Highway Motors', 'services', 'Auto Workshop', 'published',
    'Bawngkawn', 'Bawngkawn Junction, NH-54 Highway Approach, Aizawl, Mizoram 796014',
    'Hill-terrain vehicle maintenance, emergency brake overhaul, and computerized wheel balancing.',
    'Northern highway hub vehicle workshop offering 24-hour towing assistance, 4x4 transmission maintenance, and tire alignment.',
    950, '+91 98620 22005', 'bawngkawn.motors@sample-printswift.local',
    'https://picsum.photos/seed/printswift-aizawl-5/960/640',
    '["https://picsum.photos/seed/printswift-aizawl-5-a/960/640","https://picsum.photos/seed/printswift-aizawl-5-b/960/640"]'::jsonb,
    '{"lat":23.7520,"lng":92.7260}'::jsonb, 23.7520, 92.7260, 4.7, 11,
    '{"openingHours":"Mon–Sat: 7:30 AM – 8:00 PM","priceRange":"₹₹ · Moderate","highlights":["Highway Breakdown Van","Computerized Balancing","Brake Lathe"]}'::jsonb,
    v_aizawl_id, '+91 98620 22005'
  ) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, hub_id = EXCLUDED.hub_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng;

  -- ---------------------------------------------------------------------------
  -- 8. Seed Aizawl Marketplace Products (Inherits Aizawl hub_id)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.marketplace_products (
    listing_id, owner_id, title, description, price, unit, category, in_stock, thumbnail_url, hub_id
  ) VALUES
    (v_aizawl_l1, v_owner_id, '[SAMPLE] Spiral Binding & Print Pack', 'Hard-back clear-acetate spiral binding pack with 80 GSM bond paper (50 pages).', 120.00, 'set', 'stationery_print', true, 'https://picsum.photos/seed/mp-binding/400/400', v_aizawl_id),
    (v_aizawl_l2, v_owner_id, '[SAMPLE] Mizo Traditional Shawl', 'Authentic handwoven Puan / Mizo traditional shawl with intricate black-and-red geometric motifs.', 2200.00, 'piece', 'fashion_traditional_wear', true, 'https://picsum.photos/seed/mp-shawl/400/400', v_aizawl_id),
    (v_aizawl_l2, v_owner_id, '[SAMPLE] Bamboo Craft Basket', 'Fine handcrafted Mizoram mountain bamboo storage basket with tightly woven lid.', 450.00, 'piece', 'home_kitchen', true, 'https://picsum.photos/seed/mp-bamboo/400/400', v_aizawl_id);

  -- ---------------------------------------------------------------------------
  -- 9. Seed Scheduled Vehicle Listings (Intra-CCPur, Intra-Aizawl & Inter-Hub)
  -- ---------------------------------------------------------------------------
  IF v_vt_4wd IS NOT NULL THEN
    INSERT INTO public.vehicle_listings (
      owner_id, vehicle_type_id, title, description, stand_locality,
      lat, lng, booking_mode, total_seats, pricing_model,
      rate_daily_inr, rate_hourly_inr, rate_per_km_inr,
      advance_percent, with_driver, features, thumbnail_url,
      is_active, is_verified, origin_hub_id, destination_hub_ids
    ) VALUES (
      v_owner_id, v_vt_4wd,
      '[SAMPLE] CCPur Hill Cruiser 4WD Charter',
      'Heavy-duty 4x4 Bolero Camper for village tours, hill terrain charters, and wedding fleets across Churachandpur district.',
      'Tuibong', 24.3485, 93.6940, 'full_vehicle', 6, 'daily',
      3200.00, 400.00, 22.00,
      20, true, ARRAY['4WD High/Low', 'Roof Carrier', 'First-Aid Kit', 'Experienced Driver'],
      'https://picsum.photos/seed/vehicle-ccpur-4wd/640/480',
      true, true, v_ccpur_id, '{}'::uuid[]
    );

    INSERT INTO public.vehicle_listings (
      owner_id, vehicle_type_id, title, description, stand_locality,
      lat, lng, booking_mode, total_seats, pricing_model,
      rate_daily_inr, rate_hourly_inr, rate_per_km_inr,
      advance_percent, with_driver, features, thumbnail_url,
      is_active, is_verified, origin_hub_id, destination_hub_ids
    ) VALUES (
      v_owner_id, v_vt_taxi,
      '[SAMPLE] Aizawl Peak Hill Taxi',
      'Comfortable hatchback taxi navigating steep Aizawl ridges, Millennium Centre shopping trips, and airport transfers.',
      'Chanmari', 23.7235, 92.7215, 'both', 4, 'hourly',
      3500.00, 450.00, 25.00,
      15, true, ARRAY['Hill-Assisted Brakes', 'Luggage Boot', 'Clean Interior', 'Music System'],
      'https://picsum.photos/seed/vehicle-aizawl-taxi/640/480',
      true, true, v_aizawl_id, '{}'::uuid[]
    );

    INSERT INTO public.vehicle_listings (
      owner_id, vehicle_type_id, title, description, stand_locality,
      lat, lng, booking_mode, total_seats, pricing_model,
      rate_daily_inr, rate_hourly_inr, rate_per_km_inr,
      fixed_routes, advance_percent, with_driver, features, thumbnail_url,
      is_active, is_verified, origin_hub_id, destination_hub_ids
    ) VALUES (
      v_owner_id, v_vt_winger,
      '[SAMPLE] Inter-Hub Express Cruiser (CCPur ↔ Aizawl)',
      'Scheduled cross-border luxury Winger traveler operating between Churachandpur Counter and Aizawl Zarkawt Counter.',
      'Central Lamka', 24.3333, 93.6833, 'per_seat', 10, 'fixed_route',
      5500.00, NULL, NULL,
      '[{"from":"Churachandpur","to":"Aizawl","duration_hours":6.5,"fare_inr":1200,"departure_time":"06:30 AM"},{"from":"Aizawl","to":"Churachandpur","duration_hours":6.5,"fare_inr":1200,"departure_time":"07:00 AM"}]'::jsonb,
      25, true, ARRAY['AC Captain Seats', 'USB Charging Ports', 'Parcel Luggage Bay', 'Scheduled Departures'],
      'https://picsum.photos/seed/vehicle-interhub-cruiser/640/480',
      true, true, v_ccpur_id, ARRAY[v_aizawl_id]
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- 10. Seed Multi-Hub Bulletins (Bypass quota trigger safely for seed rows)
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.bulletins DISABLE TRIGGER USER;

  BEGIN
    INSERT INTO public.bulletins (
      author_id, linked_listing_id, category, title, excerpt, content_json,
      contact_channels, status, is_pinned, hub_id, target_hub_ids, is_global
    ) VALUES (
      v_owner_id, v_ccpur_l2, 'event',
      '[SAMPLE] Lamka Community Health & Wellness Camp',
      'Free pediatric and general health consultations this Saturday at Tuibong Community Hall.',
      '{"ops":[{"insert":"Free pediatric, orthopedic, and general health checkup camp organized in partnership with local Tuibong medical practitioners.\n\nDate: Saturday, 9:00 AM to 3:00 PM\nVenue: Tuibong Community Hall\nFree basic medications and consultations available to all Lamka residents.\n"}]}'::jsonb,
      '{"phone":"+91 98620 11001","whatsapp":"9862011001"}'::jsonb,
      'published', true, v_ccpur_id, ARRAY[v_ccpur_id], false
    );

    INSERT INTO public.bulletins (
      author_id, linked_listing_id, category, title, excerpt, content_json,
      contact_channels, status, is_pinned, hub_id, target_hub_ids, is_global
    ) VALUES (
      v_owner_id, v_aizawl_l1, 'event',
      '[SAMPLE] Aizawl Tech Freelancers & Creators Meetup',
      'Monthly informal meetup for digital creators, developers, and print designers in Zarkawt.',
      '{"ops":[{"insert":"Join local creators and freelancers for coffee, collaboration, and networking.\n\nLocation: Zarkawt Central Cafe\nTime: Friday 5:00 PM\nAll students and professionals welcome!\n"}]}'::jsonb,
      '{"phone":"+91 98620 22001","email":"zarkawtprint@sample-printswift.local"}'::jsonb,
      'published', false, v_aizawl_id, ARRAY[v_aizawl_id], false
    );

    INSERT INTO public.bulletins (
      author_id, linked_listing_id, category, title, excerpt, content_json,
      contact_channels, status, is_pinned, hub_id, target_hub_ids, is_global
    ) VALUES (
      v_owner_id, NULL, 'announcement',
      '[SAMPLE] Churachandpur ↔ Aizawl Inter-Hub Express Parcel Service Launched',
      'Same-day and next-day inter-hub parcel, document, and cargo delivery now active between Churachandpur and Aizawl.',
      '{"ops":[{"insert":"PrintSwift Local has expanded inter-hub connectivity! Packages dropped off by 8:00 AM at either hub counter are dispatched same-day via verified express cruisers.\n\nStandard Parcel (up to 5kg): ₹180\nDocument Express: ₹90\nPickup and drop supported via Pick-n-Drop riders in both cities.\n"}]}'::jsonb,
      '{"phone":"+91 98620 11000","website":"https://printswift.local"}'::jsonb,
      'published', true, v_ccpur_id, ARRAY[v_ccpur_id, v_aizawl_id], true
    );
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.bulletins ENABLE TRIGGER USER;
    RAISE;
  END;

  ALTER TABLE public.bulletins ENABLE TRIGGER USER;

  -- ---------------------------------------------------------------------------
  -- 11. Seed Sample Reviews & Enquiries (Schema-Safe Column Detection)
  -- ---------------------------------------------------------------------------
  SELECT column_name INTO v_rev_name_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'reviews'
    AND column_name IN ('reviewer_name', 'author_name', 'user_name', 'display_name', 'name')
  ORDER BY CASE column_name
    WHEN 'reviewer_name' THEN 1
    WHEN 'author_name' THEN 2
    WHEN 'user_name' THEN 3
    WHEN 'display_name' THEN 4
    ELSE 5
  END
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'owner_reply'
  ) INTO v_rev_has_reply;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'user_id'
  ) INTO v_rev_has_user_id;

  IF v_rev_name_col IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO public.reviews (listing_id, %I, rating, comment%s%s) VALUES
        ($1, $2, 5, $3%s%s),
        ($4, $5, 5, $6%s%s),
        ($7, $8, 5, $9%s%s),
        ($10, $11, 5, $12%s%s)',
      v_rev_name_col,
      CASE WHEN v_rev_has_reply THEN ', owner_reply' ELSE '' END,
      CASE WHEN v_rev_has_user_id THEN ', user_id' ELSE '' END,
      CASE WHEN v_rev_has_reply THEN ', ''Thank you Thangboi! Glad we could deliver in time for your event.''' ELSE '' END,
      CASE WHEN v_rev_has_user_id THEN format(', %L::uuid', v_owner_id) ELSE '' END,
      CASE WHEN v_rev_has_reply THEN ', ''Thank you for the review! Always happy to serve our community around the clock.''' ELSE '' END,
      CASE WHEN v_rev_has_user_id THEN format(', %L::uuid', v_owner_id) ELSE '' END,
      CASE WHEN v_rev_has_reply THEN ', ''Chibai Lalnunmawia! We appreciate your support and feedback.''' ELSE '' END,
      CASE WHEN v_rev_has_user_id THEN format(', %L::uuid', v_owner_id) ELSE '' END,
      CASE WHEN v_rev_has_reply THEN ', ''Ka lawm e! We take pride in sourcing directly from local weavers.''' ELSE '' END,
      CASE WHEN v_rev_has_user_id THEN format(', %L::uuid', v_owner_id) ELSE '' END
    ) USING
      v_ccpur_l1, 'Thangboi Guite', 'Super fast flex banner printing! Color fidelity was spot on for our church event.',
      v_ccpur_l2, 'Chingnu Tombing', '24x7 availability is a lifesaver in Tuibong. Courteous staff and genuine medicines.',
      v_aizawl_l1, 'Lalnunmawia', 'Best book binding in Zarkawt. Very neat finish and reasonable student pricing.',
      v_aizawl_l2, 'Zonunsanga', 'Authentic handwoven puan collection and very friendly counter staff.';
  ELSE
    INSERT INTO public.reviews (listing_id, rating, comment)
    VALUES
      (v_ccpur_l1, 5, 'Super fast flex banner printing! Color fidelity was spot on for our church event.'),
      (v_ccpur_l2, 5, '24x7 availability is a lifesaver in Tuibong. Courteous staff and genuine medicines.'),
      (v_aizawl_l1, 5, 'Best book binding in Zarkawt. Very neat finish and reasonable student pricing.'),
      (v_aizawl_l2, 5, 'Authentic handwoven puan collection and very friendly counter staff.');
  END IF;

  SELECT column_name INTO v_enq_contact_col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'enquiries'
    AND column_name IN ('sender_contact', 'contact', 'phone', 'sender_email', 'email')
  ORDER BY CASE column_name
    WHEN 'sender_contact' THEN 1
    WHEN 'contact' THEN 2
    WHEN 'phone' THEN 3
    WHEN 'sender_email' THEN 4
    ELSE 5
  END
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enquiries' AND column_name = 'status'
  ) INTO v_enq_has_status;

  IF v_enq_contact_col IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO public.enquiries (listing_id, sender_name, %I, message%s) VALUES
        ($1, $2, $3, $4%s),
        ($5, $6, $7, $8%s)',
      v_enq_contact_col,
      CASE WHEN v_enq_has_status THEN ', status' ELSE '' END,
      CASE WHEN v_enq_has_status THEN ', ''new''' ELSE '' END,
      CASE WHEN v_enq_has_status THEN ', ''new''' ELSE '' END
    ) USING
      v_ccpur_l1, 'Lianmuan Tonsing', '+91 98624 31209', 'Hi, can you print 250 copies of A4 booklet catalogs by Friday afternoon? Please confirm pricing.',
      v_aizawl_l2, 'Malsawmtluangi', '+91 87875 12345', 'Hello! Do you have the black and white diamond pattern puan in stock? Would like to pick up tomorrow.';
  ELSE
    INSERT INTO public.enquiries (listing_id, sender_name, message)
    VALUES
      (v_ccpur_l1, 'Lianmuan Tonsing', 'Hi, can you print 250 copies of A4 booklet catalogs by Friday afternoon? Please confirm pricing.'),
      (v_aizawl_l2, 'Malsawmtluangi', 'Hello! Do you have the black and white diamond pattern puan in stock? Would like to pick up tomorrow.');
  END IF;

  -- ---------------------------------------------------------------------------
  -- 12. Seed Sample Pending Localities & Category Suggestions (For Admin Queue Testing)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.hub_localities (
    hub_id, slug, display_name, aliases, lat, lng, source, status
  ) VALUES (
    v_ccpur_id, 'saikot_road_junction', 'Saikot Road Junction',
    ARRAY['Saikot Point', 'Saikot Morh'], 24.3210, 93.7120, 'user_submitted', 'pending'
  ) ON CONFLICT (hub_id, slug) DO NOTHING;

  INSERT INTO public.hub_localities (
    hub_id, slug, display_name, aliases, lat, lng, source, status
  ) VALUES (
    v_aizawl_id, 'electric_veng_upper', 'Electric Veng Upper',
    ARRAY['Electric Veng Bazar', 'Upper Electric'], 23.7380, 92.7110, 'user_submitted', 'pending'
  ) ON CONFLICT (hub_id, slug) DO NOTHING;

  INSERT INTO public.category_suggestions (
    entity_type, suggested_name, normalized_name, hub_id, status
  ) VALUES (
    'product', 'Bamboo & Cane Crafts', 'bamboo & cane crafts', v_aizawl_id, 'pending'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO public.category_suggestions (
    entity_type, suggested_name, normalized_name, hub_id, status
  ) VALUES (
    'listing', 'Cold Storage & Warehouse', 'cold storage & warehouse', v_ccpur_id, 'pending'
  ) ON CONFLICT DO NOTHING;

END;
$$;
