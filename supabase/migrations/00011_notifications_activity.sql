-- =============================================================================
-- Migration: 00011_notifications_activity.sql
-- Phase 34: Live Notifications & Activity Sync (Tables, Enquiry Trigger & RLS)
-- =============================================================================

-- 1. Create public.notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- [v21a P0-21] Fresh-replay guard: 00005 already created `notifications` with a different
-- shape (recipient_id / recipient_role NOT NULL / type NOT NULL / read), so the CREATE above is a
-- no-op on sequential replays. Reconcile idempotently (no-op on already-migrated databases).
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'type'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN type SET DEFAULT 'system';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'recipient_role' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN recipient_role DROP NOT NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

COMMENT ON TABLE public.notifications IS 'Live per-user platform notifications populated by database triggers (e.g., new enquiries).';

-- 2. Create public.activity_logs table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  entity_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id_created_at
  ON public.activity_logs (user_id, created_at DESC);

COMMENT ON TABLE public.activity_logs IS 'Per-user activity log records tracking platform actions and entity events.';

-- 3. PostgreSQL Trigger: Automatically notify listing owner on new enquiry insert
CREATE OR REPLACE FUNCTION public.handle_new_enquiry_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_listing_title text;
BEGIN
  SELECT l.owner_id, l.title
    INTO v_owner_id, v_listing_title
    FROM public.listings l
   WHERE l.id = NEW.listing_id;

  IF v_owner_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_owner_id
  ) THEN
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      is_read,
      created_at
    ) VALUES (
      v_owner_id,
      'New Listing Enquiry: ' || COALESCE(v_listing_title, 'Directory Listing'),
      'From ' || COALESCE(NEW.sender_name, 'Visitor') || ' (' || COALESCE(NEW.sender_contact, 'No contact') || '): ' || COALESCE(NEW.message, ''),
      false,
      COALESCE(NEW.created_at, now())
    );

    INSERT INTO public.activity_logs (
      user_id,
      action_type,
      entity_id,
      created_at
    ) VALUES (
      v_owner_id,
      'enquiry_received',
      NEW.id::text,
      COALESCE(NEW.created_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_enquiry_created_notify_owner ON public.enquiries;
CREATE TRIGGER on_enquiry_created_notify_owner
  AFTER INSERT ON public.enquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_enquiry_notification();

-- 4. Enable Row Level Security (RLS) on notifications and activity_logs
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Users can only SELECT their own notifications
DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
CREATE POLICY "Users can select own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can only UPDATE (mark as read) their own notifications
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can SELECT their own activity_logs
DROP POLICY IF EXISTS "Users can select own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can select own activity_logs"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can INSERT their own activity_logs
DROP POLICY IF EXISTS "Users can insert own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can insert own activity_logs"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
