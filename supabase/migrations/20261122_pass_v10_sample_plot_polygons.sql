-- =============================================================================
-- DD oodle — Pass V10: Sample Real Estate Plot Boundary Polygons
-- 100% Idempotent: ensures boundary_geojson exists on listing_real_estate_profiles
-- and populates realistic small plot polygons on up to 3 seeded sale/lease plots
-- so zoom >= 16 fluid polygon morphing is immediately testable live.
-- =============================================================================

ALTER TABLE public.listing_real_estate_profiles
  ADD COLUMN IF NOT EXISTS boundary_geojson jsonb;

DO $$
DECLARE
  rec record;
  v_poly jsonb;
BEGIN
  FOR rec IN
    SELECT
      rp.listing_id,
      l.lat,
      l.lng,
      COALESCE(rp.area_sqft, 2400) AS area_sqft
    FROM public.listing_real_estate_profiles rp
    JOIN public.listings l ON l.id = rp.listing_id
    WHERE rp.boundary_geojson IS NULL
      AND l.lat IS NOT NULL
      AND l.lng IS NOT NULL
      AND rp.deal_type IN ('sale', 'lease')
    ORDER BY rp.updated_at DESC
    LIMIT 3
  LOOP
    -- ~22m x 28m realistic residential/commercial plot polygon centered on (lat, lng)
    v_poly := jsonb_build_object(
      'type', 'Polygon',
      'coordinates', jsonb_build_array(
        jsonb_build_array(
          jsonb_build_array(round((rec.lng - 0.00014)::numeric, 6), round((rec.lat + 0.00011)::numeric, 6)),
          jsonb_build_array(round((rec.lng + 0.00014)::numeric, 6), round((rec.lat + 0.00012)::numeric, 6)),
          jsonb_build_array(round((rec.lng + 0.00015)::numeric, 6), round((rec.lat - 0.00010)::numeric, 6)),
          jsonb_build_array(round((rec.lng - 0.00013)::numeric, 6), round((rec.lat - 0.00011)::numeric, 6)),
          jsonb_build_array(round((rec.lng - 0.00014)::numeric, 6), round((rec.lat + 0.00011)::numeric, 6))
        )
      )
    );

    UPDATE public.listing_real_estate_profiles
    SET
      boundary_geojson = v_poly,
      show_exact_pin = true,
      updated_at = now()
    WHERE listing_id = rec.listing_id;

    UPDATE public.listings
    SET
      vertical_summary = COALESCE(vertical_summary, '{}'::jsonb) || jsonb_build_object(
        'boundary_geojson', v_poly,
        'show_exact_pin', true,
        'area_sqft', rec.area_sqft
      ),
      updated_at = now()
    WHERE id = rec.listing_id;
  END LOOP;
END $$;
