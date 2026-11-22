-- =============================================================================
-- DD oodle — Pass V9-A: Featured Placements Monetization Engine
-- Tables: public.featured_slots, public.featured_requests
-- 100% Idempotent (IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_pass_v9a_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. public.featured_slots (Hub-Manager & Super-Admin Governed Featured Slots)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.featured_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  slot_section text NOT NULL CHECK (
    slot_section IN (
      'featured_places',
      'featured_products',
      'featured_properties',
      'featured_vehicles'
    )
  ),
  entity_type text NOT NULL CHECK (
    entity_type IN ('listing', 'product', 'menu_item', 'vehicle')
  ),
  entity_id uuid NOT NULL,
  priority integer NOT NULL DEFAULT 10,
  badge_label text DEFAULT 'Featured',
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_slots_unique_entity
  ON public.featured_slots (hub_id, slot_section, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_featured_slots_active_lookup
  ON public.featured_slots (hub_id, slot_section, is_active, priority, expires_at);

DROP TRIGGER IF EXISTS trg_featured_slots_updated_at ON public.featured_slots;
CREATE TRIGGER trg_featured_slots_updated_at
  BEFORE UPDATE ON public.featured_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pass_v9a_updated_at();

ALTER TABLE public.featured_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "featured_slots_public_select_active" ON public.featured_slots;
CREATE POLICY "featured_slots_public_select_active"
  ON public.featured_slots
  FOR SELECT
  USING (
    is_active = true
    AND starts_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS "featured_slots_governance_select" ON public.featured_slots;
CREATE POLICY "featured_slots_governance_select"
  ON public.featured_slots
  FOR SELECT
  USING (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS "featured_slots_governance_insert" ON public.featured_slots;
CREATE POLICY "featured_slots_governance_insert"
  ON public.featured_slots
  FOR INSERT
  WITH CHECK (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS "featured_slots_governance_update" ON public.featured_slots;
CREATE POLICY "featured_slots_governance_update"
  ON public.featured_slots
  FOR UPDATE
  USING (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS "featured_slots_governance_delete" ON public.featured_slots;
CREATE POLICY "featured_slots_governance_delete"
  ON public.featured_slots
  FOR DELETE
  USING (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

-- -----------------------------------------------------------------------------
-- 2. public.featured_requests (Merchant "Get Featured" Monetization Funnel)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.featured_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_section text NOT NULL CHECK (
    slot_section IN (
      'featured_places',
      'featured_products',
      'featured_properties',
      'featured_vehicles'
    )
  ),
  entity_type text NOT NULL CHECK (
    entity_type IN ('listing', 'product', 'menu_item', 'vehicle')
  ),
  entity_id uuid NOT NULL,
  duration_days integer NOT NULL DEFAULT 15,
  quoted_fee_inr numeric(10, 2) NOT NULL DEFAULT 0,
  preferred_contact text NOT NULL DEFAULT 'whatsapp' CHECK (
    preferred_contact IN ('whatsapp', 'phone')
  ),
  contact_phone text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('submitted', 'under_review', 'approved', 'rejected')
  ),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_featured_requests_hub_status
  ON public.featured_requests (hub_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_featured_requests_requester
  ON public.featured_requests (requester_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_featured_requests_updated_at ON public.featured_requests;
CREATE TRIGGER trg_featured_requests_updated_at
  BEFORE UPDATE ON public.featured_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pass_v9a_updated_at();

ALTER TABLE public.featured_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "featured_requests_requester_select" ON public.featured_requests;
CREATE POLICY "featured_requests_requester_select"
  ON public.featured_requests
  FOR SELECT
  USING (
    auth.uid() = requester_id
    OR public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS "featured_requests_requester_insert" ON public.featured_requests;
CREATE POLICY "featured_requests_requester_insert"
  ON public.featured_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
  );

DROP POLICY IF EXISTS "featured_requests_governance_update" ON public.featured_requests;
CREATE POLICY "featured_requests_governance_update"
  ON public.featured_requests
  FOR UPDATE
  USING (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS "featured_requests_governance_delete" ON public.featured_requests;
CREATE POLICY "featured_requests_governance_delete"
  ON public.featured_requests
  FOR DELETE
  USING (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );
