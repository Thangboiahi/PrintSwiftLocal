-- =============================================================================
-- DD oodle — Idempotent Churachandpur Demo Content Seed
-- File: supabase/seed_demo_content.sql
--
-- Populates realistic Churachandpur (Lamka) content so no homepage pillar renders
-- empty or mismatched:
--   1. Reconciles all 5 Pick N Drop Fleet Types (including Cycle Rickshaw) for Churachandpur.
--   2. Marks 6 verified Churachandpur places as Featured (in `public.featured_slots`
--      + `is_featured_demo = true`) so "Featured Places" renders real cards.
--   3. Seeds 3 active Community Bulletins (1 job post, 1 district event, 1 YouTube
--      video notice) so "Active Bulletins" is > 0.
--   4. Diversifies Marketplace products (9 items) across 3 distinct local
--      Churachandpur shops so Marketplace items match the total count.
--
-- Safe to run multiple times in Supabase SQL Editor (100% idempotent).
-- =============================================================================

DO $$
DECLARE
  v_hub_id uuid;
  v_owner_id uuid;
  v_advertiser_id uuid;
  v_admin_id uuid;
  v_shop_handloom_id uuid;
  v_shop_organic_id uuid;
  v_shop_tech_id uuid;
  v_place_cafe_id uuid;
  v_place_turf_id uuid;
  v_place_hotel_id uuid;
  v_featured_ids uuid[];
  v_lid uuid;
  v_priority integer := 1;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 0. Resolve Churachandpur Hub & Seed Actor Profiles
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_hub_id
  FROM public.service_hubs
  WHERE slug = 'churachandpur'
  LIMIT 1;

  IF v_hub_id IS NULL THEN
    INSERT INTO public.service_hubs (
      slug, name, state, center_lat, center_lng, service_radius_km, default_zoom,
      status, is_default, sort_order
    )
    VALUES (
      'churachandpur', 'Churachandpur (Lamka)', 'Manipur',
      24.3330, 93.6790, 25, 14, 'active', true, 1
    )
    RETURNING id INTO v_hub_id;
  END IF;

  SELECT id INTO v_admin_id
  FROM public.profiles
  WHERE lower(email) IN ('thangboiahi@gmail.com', 'admin.test@ddoodle.in')
     OR role IN ('super_admin', 'admin')
  ORDER BY CASE WHEN lower(email) = 'thangboiahi@gmail.com' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT id INTO v_owner_id
  FROM public.profiles
  WHERE lower(email) = 'owner.test@ddoodle.in'
  LIMIT 1;
  v_owner_id := COALESCE(v_owner_id, v_admin_id, (SELECT id FROM public.profiles LIMIT 1));

  SELECT id INTO v_advertiser_id
  FROM public.profiles
  WHERE lower(email) = 'advertiser.test@ddoodle.in'
  LIMIT 1;
  v_advertiser_id := COALESCE(v_advertiser_id, v_admin_id, v_owner_id);

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'No rows exist in public.profiles yet. Run scripts/seed-test-role-accounts.mjs or create at least one user before running seed_demo_content.sql.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1. Reconcile All 5 Fleet Tiers (Cycle Rickshaw -> Pickup Truck)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.vehicle_types (
    slug, name, icon, base_fare_inr, per_km_rate_inr, wait_per_10min_inr,
    free_wait_minutes, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, is_active
  )
  VALUES
    ('cycle_rickshaw', 'Cycle Rickshaw', 'bike', 30.00, 8.00, 10.00, 15, 1.75, 80, '90 x 70 x 70 cm', ARRAY['parcel', 'gas'], true),
    ('two_wheeler', 'Scooty / Two-Wheeler', 'bike', 40.00, 10.00, 15.00, 15, 1.75, 15, '40 x 30 x 30 cm', ARRAY['parcel', 'passenger', 'gas'], true),
    ('e_rickshaw', 'E-Rickshaw / Auto', 'car-taxi-front', 70.00, 15.00, 20.00, 15, 1.75, 150, '100 x 80 x 80 cm', ARRAY['parcel', 'passenger', 'gas'], true),
    ('mini_van', 'Mini Van / Alto', 'car', 120.00, 20.00, 25.00, 15, 1.75, 300, '130 x 100 x 90 cm', ARRAY['parcel', 'passenger'], true),
    ('pickup_truck', 'Pickup Truck / Bolero', 'truck', 250.00, 30.00, 40.00, 20, 1.75, 1000, '220 x 150 x 120 cm', ARRAY['parcel', 'gas'], true)
  ON CONFLICT (slug) DO UPDATE
  SET
    name = EXCLUDED.name,
    base_fare_inr = EXCLUDED.base_fare_inr,
    per_km_rate_inr = EXCLUDED.per_km_rate_inr,
    supported_modes = EXCLUDED.supported_modes,
    is_active = true;

  INSERT INTO public.hub_vehicle_rates (
    hub_id, vehicle_type_id, is_enabled_in_hub, base_fare_inr, per_km_rate_inr,
    wait_per_10min_inr, free_wait_minutes, two_way_multiplier
  )
  SELECT
    v_hub_id, vt.id, true, vt.base_fare_inr, vt.per_km_rate_inr,
    vt.wait_per_10min_inr, vt.free_wait_minutes, vt.two_way_multiplier
  FROM public.vehicle_types vt
  WHERE vt.is_active = true
  ON CONFLICT (hub_id, vehicle_type_id) DO UPDATE
  SET is_enabled_in_hub = true, updated_at = now();

  -- ---------------------------------------------------------------------------
  -- 2. Ensure 6 Verified Churachandpur Shops/Places Exist & Feature Them
  -- ---------------------------------------------------------------------------
  -- Shop 1: Lamka Handloom & Puandum Emporium
  SELECT id INTO v_shop_handloom_id
  FROM public.listings
  WHERE hub_id = v_hub_id AND title = 'Lamka Handloom & Puandum Emporium'
  LIMIT 1;

  IF v_shop_handloom_id IS NULL THEN
    INSERT INTO public.listings (
      owner_id, owner_name, hub_id, title, category, subcategory, listing_vertical,
      status, lifecycle_status, verification_status, locality, address,
      description, short_description, contact_phone, phone,
      cover_image, coordinates, lat, lng, rating, review_count, is_featured_demo
    ) VALUES (
      v_owner_id, 'Thangaihte Business Owner', v_hub_id,
      'Lamka Handloom & Puandum Emporium', 'business', 'Handloom & Textiles', 'shop_catalogue',
      'published', 'active', 'verified', 'New Lamka',
      'Tedim Road, Near Police Point, New Lamka, Churachandpur 795128',
      'Authentic handwoven Puandum, Khiangkawi shawls, and tribal textiles crafted by Churachandpur weavers with same-day local delivery.',
      'Handwoven Puandum, shawls & tribal textiles in New Lamka.',
      '+91 98620 41001', '+91 98620 41001',
      'https://picsum.photos/seed/dd-lamka-handloom/960/640',
      '{"lat":24.3346,"lng":93.6988}'::jsonb, 24.3346, 93.6988, 4.9, 38, true
    ) RETURNING id INTO v_shop_handloom_id;
  END IF;

  -- Shop 2: Tuibong Fresh Organic Mart
  SELECT id INTO v_shop_organic_id
  FROM public.listings
  WHERE hub_id = v_hub_id AND title = 'Tuibong Fresh Organic Mart'
  LIMIT 1;

  IF v_shop_organic_id IS NULL THEN
    INSERT INTO public.listings (
      owner_id, owner_name, hub_id, title, category, subcategory, listing_vertical,
      status, lifecycle_status, verification_status, locality, address,
      description, short_description, contact_phone, phone,
      cover_image, coordinates, lat, lng, rating, review_count, is_featured_demo
    ) VALUES (
      v_owner_id, 'Tuibong Growers Co-op', v_hub_id,
      'Tuibong Fresh Organic Mart', 'business', 'Groceries & Organic Produce', 'shop_catalogue',
      'published', 'active', 'verified', 'Tuibong',
      'Tuibong Main Bazar, Opposite DC Road Junction, Churachandpur 795128',
      'Daily hill-grown organic turmeric, black rice, wild forest honey, and fresh farm vegetables sourced directly from Churachandpur hills.',
      'Organic black rice, hill honey & fresh farm produce in Tuibong.',
      '+91 98620 41002', '+91 98620 41002',
      'https://picsum.photos/seed/dd-tuibong-organic/960/640',
      '{"lat":24.3508,"lng":93.7072}'::jsonb, 24.3508, 93.7072, 4.8, 29, true
    ) RETURNING id INTO v_shop_organic_id;
  END IF;

  -- Shop 3: Rengkai Tech & Home Hardware
  SELECT id INTO v_shop_tech_id
  FROM public.listings
  WHERE hub_id = v_hub_id AND title = 'Rengkai Tech & Home Hardware'
  LIMIT 1;

  IF v_shop_tech_id IS NULL THEN
    INSERT INTO public.listings (
      owner_id, owner_name, hub_id, title, category, subcategory, listing_vertical,
      status, lifecycle_status, verification_status, locality, address,
      description, short_description, contact_phone, phone,
      cover_image, coordinates, lat, lng, rating, review_count, is_featured_demo
    ) VALUES (
      v_owner_id, 'Rengkai Enterprises', v_hub_id,
      'Rengkai Tech & Home Hardware', 'business', 'Electronics & Hardware', 'shop_catalogue',
      'published', 'active', 'verified', 'Rengkai',
      'Rengkai Main Bazar Road, Churachandpur 795128',
      'Inverter backup kits, LED lighting, mobile accessories, and household electrical supplies with doorstep Pick N Drop dispatch.',
      'Solar LEDs, inverter backups & electronics in Rengkai.',
      '+91 98620 41003', '+91 98620 41003',
      'https://picsum.photos/seed/dd-rengkai-tech/960/640',
      '{"lat":24.3271,"lng":93.7051}'::jsonb, 24.3271, 93.7051, 4.7, 24, true
    ) RETURNING id INTO v_shop_tech_id;
  END IF;

  -- Place 4: Hillcrest Brew & Kitchen (Restaurant/Cafe)
  SELECT id INTO v_place_cafe_id
  FROM public.listings
  WHERE hub_id = v_hub_id AND title = 'Hillcrest Brew & Kitchen'
  LIMIT 1;

  IF v_place_cafe_id IS NULL THEN
    INSERT INTO public.listings (
      owner_id, owner_name, hub_id, title, category, subcategory, listing_vertical,
      status, lifecycle_status, verification_status, locality, address,
      description, short_description, contact_phone, phone,
      cover_image, coordinates, lat, lng, rating, review_count, is_featured_demo
    ) VALUES (
      v_owner_id, 'Hillcrest Hospitality', v_hub_id,
      'Hillcrest Brew & Kitchen', 'business', 'Cafe & Restaurant', 'restaurant_food',
      'published', 'active', 'verified', 'Zenhang Lamka',
      'IB Road, Zenhang Lamka, Churachandpur 795128',
      'Specialty Arabica coffee, smoked pork thalis, vegetarian bowls, and fresh bakery snacks with dine-in and rapid local takeaway.',
      'Artisan coffee, local thalis & fresh bakes on IB Road.',
      '+91 98620 41004', '+91 98620 41004',
      'https://picsum.photos/seed/dd-hillcrest-cafe/960/640',
      '{"lat":24.3235,"lng":93.6914}'::jsonb, 24.3235, 93.6914, 4.8, 52, true
    ) RETURNING id INTO v_place_cafe_id;
  END IF;

  -- Place 5: Lamka Premier Football Turf
  SELECT id INTO v_place_turf_id
  FROM public.listings
  WHERE hub_id = v_hub_id AND title = 'Lamka Premier Football Turf'
  LIMIT 1;

  IF v_place_turf_id IS NULL THEN
    INSERT INTO public.listings (
      owner_id, owner_name, hub_id, title, category, subcategory, listing_vertical,
      status, lifecycle_status, verification_status, locality, address,
      description, short_description, contact_phone, phone,
      cover_image, coordinates, lat, lng, rating, review_count, is_featured_demo
    ) VALUES (
      v_owner_id, 'Lamka Sports Arena', v_hub_id,
      'Lamka Premier Football Turf', 'sports', 'Turf & Arena', 'booking_venue',
      'published', 'active', 'verified', 'Hiangtam Lamka',
      'Hiangtam Lamka Bypass, Churachandpur 795128',
      'FIFA-grade 7-a-side floodlit astro-turf with hourly online slot booking, changing rooms, and drinking water station.',
      'Floodlit 7-a-side football turf with instant hourly booking.',
      '+91 98620 41005', '+91 98620 41005',
      'https://picsum.photos/seed/dd-lamka-turf/960/640',
      '{"lat":24.3302,"lng":93.6929}'::jsonb, 24.3302, 93.6929, 4.9, 41, true
    ) RETURNING id INTO v_place_turf_id;
  END IF;

  -- Place 6: Tedim Residency & Homestay
  SELECT id INTO v_place_hotel_id
  FROM public.listings
  WHERE hub_id = v_hub_id AND title = 'Tedim Residency & Homestay'
  LIMIT 1;

  IF v_place_hotel_id IS NULL THEN
    INSERT INTO public.listings (
      owner_id, owner_name, hub_id, title, category, subcategory, listing_vertical,
      status, lifecycle_status, verification_status, locality, address,
      description, short_description, contact_phone, phone,
      cover_image, coordinates, lat, lng, rating, review_count, is_featured_demo
    ) VALUES (
      v_owner_id, 'Tedim Stays', v_hub_id,
      'Tedim Residency & Homestay', 'business', 'Hotel & Homestay', 'hotel_stay',
      'published', 'active', 'verified', 'Tedim Road',
      'Tedim Road, Near District Hospital Junction, Churachandpur 795128',
      'Clean family rooms, 24/7 power backup, high-speed Wi-Fi, and secure parking in central Churachandpur.',
      'Central Churachandpur boutique stay with 24/7 power backup.',
      '+91 98620 41006', '+91 98620 41006',
      'https://picsum.photos/seed/dd-tedim-hotel/960/640',
      '{"lat":24.3376,"lng":93.6952}'::jsonb, 24.3376, 93.6952, 4.7, 33, true
    ) RETURNING id INTO v_place_hotel_id;
  END IF;

  -- Feature all 6 verified Churachandpur places in `public.featured_slots` + `is_featured_demo = true`
  v_featured_ids := ARRAY[
    v_shop_handloom_id,
    v_shop_organic_id,
    v_shop_tech_id,
    v_place_cafe_id,
    v_place_turf_id,
    v_place_hotel_id
  ];

  UPDATE public.listings
  SET is_featured_demo = true, status = 'published', lifecycle_status = 'active'
  WHERE id = ANY(v_featured_ids);

  v_priority := 1;
  FOREACH v_lid IN ARRAY v_featured_ids LOOP
    INSERT INTO public.featured_slots (
      hub_id, slot_section, entity_type, entity_id, priority,
      badge_label, starts_at, expires_at, is_active, set_by
    )
    VALUES (
      v_hub_id, 'featured_places', 'listing', v_lid, v_priority,
      CASE WHEN v_priority <= 2 THEN 'Top Pick' ELSE 'Featured' END,
      now() - interval '1 hour',
      now() + interval '180 days',
      true,
      v_admin_id
    )
    ON CONFLICT (hub_id, slot_section, entity_type, entity_id) DO UPDATE
    SET
      priority = EXCLUDED.priority,
      is_active = true,
      expires_at = EXCLUDED.expires_at,
      updated_at = now();
    v_priority := v_priority + 1;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 3. Seed 3 Active Community Bulletins (Job Post, District Event, YouTube Video Notice)
  --    Ensure advertiser has an active subscription so quota triggers pass cleanly.
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.user_subscriptions
    WHERE user_id = v_advertiser_id AND status = 'active' AND expires_at > now()
  ) THEN
    INSERT INTO public.user_subscriptions (user_id, plan_id, status, starts_at, expires_at, payment_ref)
    SELECT v_advertiser_id, sp.id, 'active', now(), now() + interval '180 days', 'SEED-DEMO-BULLETIN-PLAN'
    FROM public.subscription_plans sp
    WHERE sp.is_active = true
    ORDER BY sp.max_active_bulletins DESC
    LIMIT 1;
  END IF;

  -- Bulletin 1: Job Post
  IF NOT EXISTS (
    SELECT 1 FROM public.bulletins
    WHERE title = 'Hiring: Front Desk & Computer Operator — Lamka Bazar'
  ) THEN
    INSERT INTO public.bulletins (
      author_id, linked_listing_id, hub_id, category, title, content_json, excerpt,
      image_urls, youtube_video_id, contact_channels, status, is_pinned, expires_at
    ) VALUES (
      v_advertiser_id, v_shop_tech_id, v_hub_id, 'job',
      'Hiring: Front Desk & Computer Operator — Lamka Bazar',
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Rengkai Tech & Home Hardware is hiring 2 full-time counter operators with basic MS Office, UPI billing, and bilingual customer communication skills. Starting salary ₹12,000–₹15,000/month with Sunday off. Walk-in interviews Monday–Friday, 10 AM to 4 PM."}]}]}'::jsonb,
      'Full-time counter & computer operator opening in Churachandpur (₹12k–₹15k/mo). Walk-in interviews Mon–Fri.',
      ARRAY['https://picsum.photos/seed/dd-bulletin-job/960/540'],
      NULL,
      '{"phone":"+91 98620 41003","whatsapp":"+919862041003"}'::jsonb,
      'published', true, now() + interval '60 days'
    );
  END IF;

  -- Bulletin 2: District Event
  IF NOT EXISTS (
    SELECT 1 FROM public.bulletins
    WHERE title = 'Churachandpur Autumn Farmers & Handloom Expo — Peace Ground'
  ) THEN
    INSERT INTO public.bulletins (
      author_id, linked_listing_id, hub_id, category, title, content_json, excerpt,
      image_urls, youtube_video_id, contact_channels, status, is_pinned, expires_at
    ) VALUES (
      v_advertiser_id, v_shop_handloom_id, v_hub_id, 'event',
      'Churachandpur Autumn Farmers & Handloom Expo — Peace Ground',
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Join 60+ local weavers, organic hill farmers, and food stalls at Peace Ground, Tuibong this Saturday & Sunday from 9:00 AM to 6:00 PM. Free entry for families, live bamboo craft demos, and same-day Pick N Drop parcel delivery right from the expo gate."}]}]}'::jsonb,
      '60+ local weavers & organic growers at Peace Ground, Tuibong this weekend (9 AM–6 PM). Free family entry.',
      ARRAY['https://picsum.photos/seed/dd-bulletin-expo/960/540'],
      NULL,
      '{"phone":"+91 98620 41001","whatsapp":"+919862041001"}'::jsonb,
      'published', true, now() + interval '45 days'
    );
  END IF;

  -- Bulletin 3: Embedded YouTube Video Notice
  IF NOT EXISTS (
    SELECT 1 FROM public.bulletins
    WHERE title = 'Video Notice: Tedim Road Pick N Drop Express & Evening Market Timings'
  ) THEN
    INSERT INTO public.bulletins (
      author_id, linked_listing_id, hub_id, category, title, content_json, excerpt,
      image_urls, youtube_video_id, contact_channels, status, is_pinned, expires_at
    ) VALUES (
      v_advertiser_id, v_shop_organic_id, v_hub_id, 'notice',
      'Video Notice: Tedim Road Pick N Drop Express & Evening Market Timings',
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Watch this quick community briefing covering Lamka Bazar evening market hours, Cycle Rickshaw short-hop parcel lanes, and verified UPI escrow safety tips for Pick N Drop deliveries across Churachandpur."}]}]}'::jsonb,
      'Community video briefing on Lamka evening market timings, Cycle Rickshaw lanes & verified UPI escrow tips.',
      ARRAY['https://picsum.photos/seed/dd-bulletin-video/960/540'],
      'LXb3EKWsInQ',
      '{"phone":"+91 98620 41002","whatsapp":"+919862041002"}'::jsonb,
      'published', false, now() + interval '60 days'
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. Diversify Marketplace Products Across 3 Distinct Local Churachandpur Shops
  --    (9 realistic in-stock items: 3 Handloom + 3 Organic Mart + 3 Tech & Hardware)
  -- ---------------------------------------------------------------------------
  -- Shop 1: Lamka Handloom & Puandum Emporium
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_handloom_id AND title = 'Authentic Handwoven Puandum Traditional Wrap') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_handloom_id, v_owner_id, v_hub_id, 'Authentic Handwoven Puandum Traditional Wrap', 'Pure cotton traditional Puandum woven by master artisans in New Lamka.', 1450.00, 'piece', 'Clothing & Handloom', true, 'https://picsum.photos/seed/dd-prod-puandum/640/480', ARRAY['https://picsum.photos/seed/dd-prod-puandum/640/480'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_handloom_id AND title = 'Khiangkawi Ceremonial Shawl (Cotton Blend)') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_handloom_id, v_owner_id, v_hub_id, 'Khiangkawi Ceremonial Shawl (Cotton Blend)', 'Soft winter ceremonial shawl with traditional geometric border motifs.', 1190.00, 'piece', 'Clothing & Handloom', true, 'https://picsum.photos/seed/dd-prod-shawl/640/480', ARRAY['https://picsum.photos/seed/dd-prod-shawl/640/480'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_handloom_id AND title = 'Woven Tribal Tote Bag — Everyday Carry') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_handloom_id, v_owner_id, v_hub_id, 'Woven Tribal Tote Bag — Everyday Carry', 'Durable handloom fabric tote with inner zip pocket and reinforced straps.', 480.00, 'piece', 'Clothing & Handloom', true, 'https://picsum.photos/seed/dd-prod-tote/640/480', ARRAY['https://picsum.photos/seed/dd-prod-tote/640/480'], true);
  END IF;

  -- Shop 2: Tuibong Fresh Organic Mart
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_organic_id AND title = 'Manipur Chak-Hao Organic Black Rice (1 kg)') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_organic_id, v_owner_id, v_hub_id, 'Manipur Chak-Hao Organic Black Rice (1 kg)', 'Aromatic GI-tagged aromatic black rice freshly milled from Tuibong farms.', 240.00, 'kg', 'Groceries & Organic', true, 'https://picsum.photos/seed/dd-prod-blackrice/640/480', ARRAY['https://picsum.photos/seed/dd-prod-blackrice/640/480'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_organic_id AND title = 'Raw Wild Hill Forest Honey (500 g Jar)') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_organic_id, v_owner_id, v_hub_id, 'Raw Wild Hill Forest Honey (500 g Jar)', 'Unprocessed multifloral hill honey harvested sustainably around Churachandpur.', 420.00, 'jar', 'Groceries & Organic', true, 'https://picsum.photos/seed/dd-prod-honey/640/480', ARRAY['https://picsum.photos/seed/dd-prod-honey/640/480'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_organic_id AND title = 'High-Curcumin Lakadong Hill Turmeric Powder (250 g)') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_organic_id, v_owner_id, v_hub_id, 'High-Curcumin Lakadong Hill Turmeric Powder (250 g)', 'Sun-dried, stone-ground golden turmeric rich in natural curcumin.', 185.00, 'pack', 'Groceries & Organic', true, 'https://picsum.photos/seed/dd-prod-turmeric/640/480', ARRAY['https://picsum.photos/seed/dd-prod-turmeric/640/480'], true);
  END IF;

  -- Shop 3: Rengkai Tech & Home Hardware
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_tech_id AND title = '12W Rechargeable Inverter LED Bulb (Pack of 2)') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_tech_id, v_owner_id, v_hub_id, '12W Rechargeable Inverter LED Bulb (Pack of 2)', 'Up to 4 hours automatic power-cut backup with standard B22 holder.', 590.00, 'pack', 'Electronics & Hardware', true, 'https://picsum.photos/seed/dd-prod-ledbulb/640/480', ARRAY['https://picsum.photos/seed/dd-prod-ledbulb/640/480'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_tech_id AND title = 'Heavy-Duty 4-Socket Surge Protector Extension Board') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_tech_id, v_owner_id, v_hub_id, 'Heavy-Duty 4-Socket Surge Protector Extension Board', '3-metre copper cord with individual LED switches and overload cutoff.', 450.00, 'piece', 'Electronics & Hardware', true, 'https://picsum.photos/seed/dd-prod-extension/640/480', ARRAY['https://picsum.photos/seed/dd-prod-extension/640/480'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_products WHERE listing_id = v_shop_tech_id AND title = '20W Fast USB-C Wall Adapter + Braided Cable') THEN
    INSERT INTO public.marketplace_products (listing_id, owner_id, hub_id, title, description, price, unit, category, in_stock, thumbnail_url, image_urls, is_active)
    VALUES (v_shop_tech_id, v_owner_id, v_hub_id, '20W Fast USB-C Wall Adapter + Braided Cable', 'BIS-certified PD fast charger compatible with Android & iPhone devices.', 650.00, 'set', 'Electronics & Hardware', true, 'https://picsum.photos/seed/dd-prod-charger/640/480', ARRAY['https://picsum.photos/seed/dd-prod-charger/640/480'], true);
  END IF;
END;
$$;
