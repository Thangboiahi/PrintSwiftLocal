-- ============================================================================
-- Pass v15f: Command Center Telemetry, Metrics RPC & 90-Day Retention Cron
-- ============================================================================
-- Idempotent migration creating:
--   1. public.app_analytics_events (privacy-safe, PII-free event ledger)
--   2. public.get_command_center_metrics(p_days int DEFAULT 30) SECURITY DEFINER
--   3. public.purge_old_app_analytics_events(p_retention_days int DEFAULT 90)
--      + conditional pg_cron daily schedule (0 3 * * *)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (
    event_type IN (
      'page_view',
      'listing_click',
      'shortcut_click',
      'search_query',
      'whatsapp_click',
      'enquiry_submit',
      'pnd_quote',
      'booking_create',
      'escrow_verified',
      'bulletin_view'
    )
  ),
  feature_area text,
  target_id text,
  root_key text,
  locality text,
  session_hash text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_type text DEFAULT 'unknown' CHECK (
    device_type IS NULL
    OR device_type IN ('mobile', 'tablet', 'desktop', 'unknown')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for time-windowed Command Center aggregations
CREATE INDEX IF NOT EXISTS idx_app_analytics_events_created_type
  ON public.app_analytics_events (created_at DESC, event_type);

CREATE INDEX IF NOT EXISTS idx_app_analytics_events_feature_created
  ON public.app_analytics_events (feature_area, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_analytics_events_session_created
  ON public.app_analytics_events (session_hash, created_at DESC)
  WHERE session_hash IS NOT NULL;

ALTER TABLE public.app_analytics_events ENABLE ROW LEVEL SECURITY;

-- Strict RLS: SELECT only for admin / super_admin; INSERT allowed for anon/authenticated
-- without user_id spoofing; ZERO UPDATE/DELETE policies for client roles.
DROP POLICY IF EXISTS app_analytics_events_admin_select ON public.app_analytics_events;
CREATE POLICY app_analytics_events_admin_select
  ON public.app_analytics_events
  FOR SELECT
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()));

DROP POLICY IF EXISTS app_analytics_events_public_insert ON public.app_analytics_events;
CREATE POLICY app_analytics_events_public_insert
  ON public.app_analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    user_id IS NULL
    OR user_id = auth.uid()
  );

REVOKE UPDATE, DELETE ON public.app_analytics_events FROM anon, authenticated;

-- ============================================================================
-- Command Center Metrics RPC (SECURITY DEFINER, strictly admin/super_admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_command_center_metrics(
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
  v_start_ts timestamptz := date_trunc('day', now() - make_interval(days => v_days - 1));
  v_start_date date := (now() - make_interval(days => v_days - 1))::date;
  v_end_date date := CURRENT_DATE;

  v_visits bigint := 0;
  v_unique_sessions bigint := 0;
  v_clicks bigint := 0;
  v_event_leads bigint := 0;
  v_db_enquiries bigint := 0;
  v_pnd_orders bigint := 0;
  v_vehicle_bookings bigint := 0;
  v_sub_bulletins bigint := 0;
  v_shop_orders bigint := 0;
  v_verified_escrow_inr numeric := 0;

  v_pending_listings bigint := 0;
  v_pending_partners bigint := 0;
  v_pending_bulletins bigint := 0;
  v_pending_civic bigint := 0;
  v_pending_escrow_disputes bigint := 0;
  v_pending_manual_payments bigint := 0;
  v_pod_pending_purge bigint := 0;
  v_total_events_90d bigint := 0;
  v_last_event_at timestamptz := NULL;

  v_listing_views bigint := 0;
  v_total_bookings bigint := 0;

  v_daily_series jsonb := '[]'::jsonb;
  v_pillar_daily jsonb := '[]'::jsonb;
  v_feature_distribution jsonb := '[]'::jsonb;
  v_top_shortcuts jsonb := '[]'::jsonb;
  v_top_localities jsonb := '[]'::jsonb;
BEGIN
  -- Enforce strict admin / super_admin access gate
  IF auth.uid() IS NULL OR NOT public.is_pnd_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: Admin or Super Admin access required.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Core telemetry KPI aggregates
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'page_view'),
    COUNT(DISTINCT session_hash) FILTER (WHERE session_hash IS NOT NULL),
    COUNT(*) FILTER (
      WHERE event_type IN (
        'listing_click',
        'shortcut_click',
        'search_query',
        'bulletin_view',
        'pnd_quote'
      )
    ),
    COUNT(*) FILTER (WHERE event_type IN ('whatsapp_click', 'enquiry_submit')),
    COUNT(*) FILTER (WHERE event_type = 'listing_click')
  INTO
    v_visits,
    v_unique_sessions,
    v_clicks,
    v_event_leads,
    v_listing_views
  FROM public.app_analytics_events
  WHERE created_at >= v_start_ts;

  -- 2. Operational transaction & lead volumes in window
  SELECT COUNT(*) INTO v_db_enquiries
  FROM public.enquiries
  WHERE created_at >= v_start_ts;

  SELECT COUNT(*) INTO v_pnd_orders
  FROM public.delivery_orders
  WHERE created_at >= v_start_ts;

  SELECT COUNT(*) INTO v_vehicle_bookings
  FROM public.vehicle_bookings
  WHERE created_at >= v_start_ts;

  SELECT
    (SELECT COUNT(*) FROM public.user_subscriptions WHERE created_at >= v_start_ts)
    + (SELECT COUNT(*) FROM public.bulletins WHERE created_at >= v_start_ts)
  INTO v_sub_bulletins;

  SELECT COUNT(*) INTO v_shop_orders
  FROM public.shop_orders
  WHERE created_at >= v_start_ts;

  SELECT COALESCE(SUM(amount_inr), 0)
  INTO v_verified_escrow_inr
  FROM public.payment_intents
  WHERE status = 'succeeded'
    AND created_at >= v_start_ts;

  v_total_bookings := v_pnd_orders + v_vehicle_bookings + v_shop_orders;

  -- 3. Live pending moderation & operational queues
  SELECT COUNT(*) INTO v_pending_listings
  FROM public.listings
  WHERE status IN ('pending', 'pending_review', 'pending_verification', 'submitted');

  SELECT COUNT(*) INTO v_pending_partners
  FROM public.partner_applications
  WHERE status IN ('submitted', 'under_review');

  SELECT COUNT(*) INTO v_pending_bulletins
  FROM public.bulletin_reports
  WHERE status = 'open';

  SELECT COUNT(*) INTO v_pending_civic
  FROM public.civic_correction_reports
  WHERE status IN ('open', 'pending');

  SELECT COUNT(*) INTO v_pending_escrow_disputes
  FROM public.delivery_orders
  WHERE status IN ('payment_submitted', 'disputed');

  SELECT COUNT(*) INTO v_pending_manual_payments
  FROM public.payment_intents
  WHERE status = 'pending_manual';

  SELECT COUNT(*) INTO v_pod_pending_purge
  FROM public.delivery_orders
  WHERE pod_storage_path IS NOT NULL
    AND pod_purge_at IS NOT NULL
    AND pod_purge_at <= now();

  SELECT COUNT(*), MAX(created_at)
  INTO v_total_events_90d, v_last_event_at
  FROM public.app_analytics_events
  WHERE created_at >= now() - interval '90 days';

  -- 4. Daily Traffic, Visits, Clicks & Transactions Time-Series
  WITH days AS (
    SELECT generate_series(v_start_date, v_end_date, interval '1 day')::date AS day_date
  ),
  ev AS (
    SELECT
      created_at::date AS day_date,
      COUNT(*) FILTER (WHERE event_type = 'page_view') AS visits,
      COUNT(*) FILTER (
        WHERE event_type IN ('listing_click', 'shortcut_click', 'search_query', 'bulletin_view', 'pnd_quote')
      ) AS clicks,
      COUNT(*) FILTER (WHERE event_type IN ('whatsapp_click', 'enquiry_submit')) AS leads
    FROM public.app_analytics_events
    WHERE created_at >= v_start_ts
    GROUP BY 1
  ),
  tx AS (
    SELECT day_date, SUM(cnt) AS transactions
    FROM (
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.delivery_orders
      WHERE created_at >= v_start_ts
      GROUP BY 1
      UNION ALL
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.vehicle_bookings
      WHERE created_at >= v_start_ts
      GROUP BY 1
      UNION ALL
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.payment_intents
      WHERE status IN ('succeeded', 'pending_manual')
        AND created_at >= v_start_ts
      GROUP BY 1
    ) t
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.day_date, 'YYYY-MM-DD'),
        'label', to_char(d.day_date, 'Mon DD'),
        'visits', COALESCE(ev.visits, 0),
        'clicks', COALESCE(ev.clicks, 0),
        'leads', COALESCE(ev.leads, 0),
        'transactions', COALESCE(tx.transactions, 0)
      )
      ORDER BY d.day_date ASC
    ),
    '[]'::jsonb
  )
  INTO v_daily_series
  FROM days d
  LEFT JOIN ev ON ev.day_date = d.day_date
  LEFT JOIN tx ON tx.day_date = d.day_date;

  -- 5. Stacked Bar Series: Transactions & Activity by Pillar
  WITH days AS (
    SELECT generate_series(v_start_date, v_end_date, interval '1 day')::date AS day_date
  ),
  pnd AS (
    SELECT created_at::date AS day_date, COUNT(*) AS cnt
    FROM public.delivery_orders
    WHERE created_at >= v_start_ts
    GROUP BY 1
  ),
  veh AS (
    SELECT created_at::date AS day_date, COUNT(*) AS cnt
    FROM public.vehicle_bookings
    WHERE created_at >= v_start_ts
    GROUP BY 1
  ),
  sub_b AS (
    SELECT day_date, SUM(cnt) AS cnt
    FROM (
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.user_subscriptions
      WHERE created_at >= v_start_ts
      GROUP BY 1
      UNION ALL
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.bulletins
      WHERE created_at >= v_start_ts
      GROUP BY 1
    ) s
    GROUP BY 1
  ),
  mkt AS (
    SELECT day_date, SUM(cnt) AS cnt
    FROM (
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.enquiries
      WHERE created_at >= v_start_ts
      GROUP BY 1
      UNION ALL
      SELECT created_at::date AS day_date, COUNT(*) AS cnt
      FROM public.shop_orders
      WHERE created_at >= v_start_ts
      GROUP BY 1
    ) m
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.day_date, 'YYYY-MM-DD'),
        'label', to_char(d.day_date, 'Mon DD'),
        'pick_n_drop', COALESCE(pnd.cnt, 0),
        'vehicles', COALESCE(veh.cnt, 0),
        'subscriptions_bulletins', COALESCE(sub_b.cnt, 0),
        'marketplace_leads', COALESCE(mkt.cnt, 0)
      )
      ORDER BY d.day_date ASC
    ),
    '[]'::jsonb
  )
  INTO v_pillar_daily
  FROM days d
  LEFT JOIN pnd ON pnd.day_date = d.day_date
  LEFT JOIN veh ON veh.day_date = d.day_date
  LEFT JOIN sub_b ON sub_b.day_date = d.day_date
  LEFT JOIN mkt ON mkt.day_date = d.day_date;

  -- 6. Traffic & Click Distribution by Feature Area (Donut Chart)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'key', area_key,
        'name', area_label,
        'value', total_cnt
      )
      ORDER BY total_cnt DESC
    ),
    '[]'::jsonb
  )
  INTO v_feature_distribution
  FROM (
    SELECT
      COALESCE(NULLIF(btrim(feature_area), ''), 'home') AS area_key,
      INITCAP(REPLACE(COALESCE(NULLIF(btrim(feature_area), ''), 'home'), '_', ' ')) AS area_label,
      COUNT(*) AS total_cnt
    FROM public.app_analytics_events
    WHERE created_at >= v_start_ts
    GROUP BY 1, 2
    ORDER BY total_cnt DESC
    LIMIT 8
  ) f;

  -- 7. Top Shortcuts Clicked
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'target_id', target_id,
        'root_key', root_key,
        'clicks', clicks
      )
      ORDER BY clicks DESC
    ),
    '[]'::jsonb
  )
  INTO v_top_shortcuts
  FROM (
    SELECT
      COALESCE(NULLIF(btrim(target_id), ''), 'unknown') AS target_id,
      MAX(NULLIF(btrim(root_key), '')) AS root_key,
      COUNT(*) AS clicks
    FROM public.app_analytics_events
    WHERE created_at >= v_start_ts
      AND event_type = 'shortcut_click'
    GROUP BY 1
    ORDER BY clicks DESC
    LIMIT 8
  ) s;

  -- 8. Top Active Localities
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'locality', locality,
        'events', cnt
      )
      ORDER BY cnt DESC
    ),
    '[]'::jsonb
  )
  INTO v_top_localities
  FROM (
    SELECT
      btrim(locality) AS locality,
      COUNT(*) AS cnt
    FROM public.app_analytics_events
    WHERE created_at >= v_start_ts
      AND locality IS NOT NULL
      AND btrim(locality) <> ''
    GROUP BY 1
    ORDER BY cnt DESC
    LIMIT 8
  ) l;

  RETURN jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'visits', v_visits,
      'unique_sessions', v_unique_sessions,
      'clicks', v_clicks,
      'leads_whatsapp', v_event_leads + v_db_enquiries,
      'active_bookings_transactions', v_total_bookings,
      'verified_escrow_inr', ROUND(v_verified_escrow_inr, 2),
      'pending_queues', jsonb_build_object(
        'listings', v_pending_listings,
        'partner_applications', v_pending_partners,
        'bulletins', v_pending_bulletins,
        'civic_reports', v_pending_civic,
        'escrow_disputes', v_pending_escrow_disputes + v_pending_manual_payments,
        'total', v_pending_listings + v_pending_partners + v_pending_bulletins + v_pending_civic + v_pending_escrow_disputes + v_pending_manual_payments
      )
    ),
    'daily_series', v_daily_series,
    'pillar_breakdown', jsonb_build_object(
      'daily', v_pillar_daily,
      'totals', jsonb_build_object(
        'pick_n_drop', v_pnd_orders,
        'vehicles', v_vehicle_bookings,
        'subscriptions_bulletins', v_sub_bulletins,
        'marketplace_leads', v_db_enquiries + v_shop_orders
      )
    ),
    'feature_distribution', v_feature_distribution,
    'conversion_funnel', jsonb_build_array(
      jsonb_build_object('key', 'visit', 'stage', 'Page Visits', 'count', v_visits),
      jsonb_build_object('key', 'listing_view', 'stage', 'Listing Clicks', 'count', v_listing_views),
      jsonb_build_object('key', 'lead', 'stage', 'Enquiry / WhatsApp', 'count', v_event_leads + v_db_enquiries),
      jsonb_build_object('key', 'booking', 'stage', 'Bookings & Orders', 'count', v_total_bookings)
    ),
    'top_shortcuts', v_top_shortcuts,
    'top_localities', v_top_localities,
    'system_health', jsonb_build_object(
      'pod_pending_purge_count', v_pod_pending_purge,
      'pending_manual_payments', v_pending_manual_payments,
      'total_analytics_rows_90d', v_total_events_90d,
      'last_event_at', v_last_event_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_command_center_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_command_center_metrics(integer) TO authenticated, service_role;

-- ============================================================================
-- 90-Day Analytics Retention Purge Function + Conditional pg_cron Schedule
-- ============================================================================
CREATE OR REPLACE FUNCTION public.purge_old_app_analytics_events(
  p_retention_days integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_retention_days, 90), 7), 365);
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.app_analytics_events
  WHERE created_at < now() - make_interval(days => v_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_app_analytics_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_app_analytics_events(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ddoodle_purge_analytics_events_90d'
    ) THEN
      PERFORM cron.schedule(
        'ddoodle_purge_analytics_events_90d',
        '0 3 * * *',
        'SELECT public.purge_old_app_analytics_events(90);'
      );
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping pg_cron analytics purge schedule: %', SQLERRM;
END;
$$;
