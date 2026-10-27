-- Eventra v2: incremental migration. Run AFTER 001/002, existing data remains.
-- App tables are in event; auth.users and storage.objects remain in managed Supabase schemas.
BEGIN;

CREATE SCHEMA IF NOT EXISTS event;
GRANT USAGE ON SCHEMA event TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS event.event_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event.events(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventra_photo_path_not_empty CHECK (char_length(storage_path) > 10)
);
CREATE INDEX IF NOT EXISTS eventra_photos_event_idx ON event.event_photos(event_id);

CREATE TABLE IF NOT EXISTS event.rundown_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event.events(id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  activity text NOT NULL CHECK (char_length(trim(activity)) BETWEEN 1 AND 200),
  pic_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventra_rundown_time_order CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS eventra_rundown_event_idx ON event.rundown_items(event_id,sort_order,start_at);

ALTER TABLE event.event_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE event.rundown_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON event.event_photos, event.rundown_items FROM anon, authenticated;
GRANT SELECT,INSERT,DELETE ON event.event_photos TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON event.rundown_items TO authenticated;

DROP POLICY IF EXISTS eventra_photos_read ON event.event_photos;
CREATE POLICY eventra_photos_read ON event.event_photos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS eventra_photos_insert ON event.event_photos;
CREATE POLICY eventra_photos_insert ON event.event_photos FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM event.events e WHERE e.id = event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))));
DROP POLICY IF EXISTS eventra_photos_delete ON event.event_photos;
CREATE POLICY eventra_photos_delete ON event.event_photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM event.events e WHERE e.id = event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))));

DROP POLICY IF EXISTS eventra_rundown_read ON event.rundown_items;
CREATE POLICY eventra_rundown_read ON event.rundown_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS eventra_rundown_insert ON event.rundown_items;
CREATE POLICY eventra_rundown_insert ON event.rundown_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM event.events e WHERE e.id = event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))));
DROP POLICY IF EXISTS eventra_rundown_update ON event.rundown_items;
CREATE POLICY eventra_rundown_update ON event.rundown_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM event.events e WHERE e.id = event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))))
  WITH CHECK (EXISTS (SELECT 1 FROM event.events e WHERE e.id = event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))));
DROP POLICY IF EXISTS eventra_rundown_delete ON event.rundown_items;
CREATE POLICY eventra_rundown_delete ON event.rundown_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM event.events e WHERE e.id = event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))));

-- Atomic rundown replacement: when one item fails validation, no old items are lost.
CREATE OR REPLACE FUNCTION event.save_rundown(p_event_id uuid, p_items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  item jsonb;
  idx integer := 0;
  start_time timestamptz;
  end_time timestamptz;
  activity_name text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Login diperlukan.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM event.events e WHERE e.id = p_event_id
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid()))) THEN
    RAISE EXCEPTION 'Anda tidak memiliki akses untuk mengubah rundown.' USING ERRCODE='42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'Rundown harus berupa array dengan maksimal 60 kegiatan.';
  END IF;
  -- Validate before deleting existing schedule.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    activity_name := trim(coalesce(item->>'activity',''));
    start_time := (item->>'start_at')::timestamptz;
    end_time := (item->>'end_at')::timestamptz;
    IF char_length(activity_name) NOT BETWEEN 1 AND 200 OR start_time IS NULL
        OR end_time IS NULL OR end_time <= start_time THEN
      RAISE EXCEPTION 'Kegiatan rundown tidak valid.';
    END IF;
  END LOOP;
  DELETE FROM event.rundown_items WHERE event_id = p_event_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO event.rundown_items(event_id,start_at,end_at,activity,pic_name,notes,sort_order)
    VALUES (p_event_id,(item->>'start_at')::timestamptz,(item->>'end_at')::timestamptz,
      trim(item->>'activity'),coalesce(item->>'pic_name',''),coalesce(item->>'notes',''),idx);
    idx := idx + 1;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION event.save_rundown(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION event.save_rundown(uuid,jsonb) TO authenticated;

-- Private image bucket: photos are fetched by signed URL after login.
-- Supabase Storage metadata lives in storage schema by design.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('eventra-event-photos','eventra-event-photos',false,5242880,
        ARRAY['image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = false,file_size_limit=5242880,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS eventra_storage_read ON storage.objects;
CREATE POLICY eventra_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'eventra-event-photos');
DROP POLICY IF EXISTS eventra_storage_insert ON storage.objects;
CREATE POLICY eventra_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'eventra-event-photos'
    AND EXISTS (SELECT 1 FROM event.events e
      WHERE e.id::text = (storage.foldername(name))[1]
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid())))
  );
DROP POLICY IF EXISTS eventra_storage_delete ON storage.objects;
CREATE POLICY eventra_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'eventra-event-photos'
    AND EXISTS (SELECT 1 FROM event.events e
      WHERE e.id::text = (storage.foldername(name))[1]
      AND (event.is_admin() OR e.assigned_pic = (SELECT auth.uid())))
  );

COMMIT;
