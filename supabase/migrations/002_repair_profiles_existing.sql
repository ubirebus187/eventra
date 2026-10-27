-- Eventra: perbaikan profil akun sesudah migrasi ke schema event.
-- Jalankan di Supabase SQL Editor dengan role postgres, SETELAH migration 001.
-- Tidak mengubah password atau role pengguna yang sudah ada.

DO $$
BEGIN
  IF to_regclass('event.profiles') IS NULL THEN
    RAISE EXCEPTION 'Tabel event.profiles tidak ditemukan. Jalankan 001_eventra_schema_event.sql terlebih dahulu.';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA event TO authenticated, service_role;
GRANT SELECT ON TABLE event.profiles TO authenticated;
ALTER TABLE event.profiles ENABLE ROW LEVEL SECURITY;

-- Semua user yang login boleh melihat profil tim (sesuai desain Eventra).
DROP POLICY IF EXISTS profiles_authenticated_read ON event.profiles;
CREATE POLICY profiles_authenticated_read
  ON event.profiles FOR SELECT TO authenticated USING (true);

-- Setiap akun baru di auth.users otomatis memiliki event.profiles.
CREATE OR REPLACE FUNCTION event.on_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO event.profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'full_name'), ''),
             SPLIT_PART(COALESCE(new.email, ''), '@', 1)),
    COALESCE(new.email, ''),
    'pic'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_created_eventra ON auth.users;
CREATE TRIGGER auth_user_created_eventra
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION event.on_auth_user_created();

-- Lengkapi akun lama yang belum memiliki profil. Tidak menimpa role Admin.
INSERT INTO event.profiles (id, full_name, email, role)
SELECT
  u.id,
  COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
           SPLIT_PART(COALESCE(u.email, ''), '@', 1)),
  COALESCE(u.email, ''),
  'pic'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Diagnosis akhir: semua akun harus muncul sebagai PROFIL TERSEDIA.
SELECT u.email, p.id AS profile_id, p.full_name, p.role,
       CASE WHEN p.id IS NULL THEN 'PROFIL BELUM ADA' ELSE 'PROFIL TERSEDIA' END AS status_profile
FROM auth.users u
LEFT JOIN event.profiles p ON p.id = u.id
ORDER BY u.email;
