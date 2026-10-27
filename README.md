# EVENTRA v2 | Next.js 16 + Supabase | Schema `event`

Aplikasi manajemen event internal: Login Admin/PIC, dashboard, status & progress, prioritas High/Mid/Low, kalender, foto event, rundown acara, notifikasi otomatis di dashboard, grafik pie, dan export laporan CSV.

## Penting: pembagian schema

- **`event`**: `profiles`, `events`, `notifications`, `event_photos`, `rundown_items`, RPC aplikasi.
- **`auth`**: `auth.users`, selalu dikelola Supabase Authentication.
- **`storage`**: bucket dan file metadata Supabase Storage, tetap dikelola Supabase.
- **`cron`**: penjadwalan `pg_cron` setelah modul Cron diaktifkan, bukan schema data aplikasi.

Kode front-end menggunakan `db: { schema: "event" }` dan explicit `.schema("event")`. Namun kode tidak dapat menggantikan **Exposed schemas** Supabase. Sebelum login, di Supabase Dashboard buka **Project Settings / Integrations > Data API > Exposed schemas**, tambahkan `event` dan simpan. Jika masih ada `PGRST106`, pastikan `.env.local` menunjuk ke Supabase project yang sama, lalu lakukan pemeriksaan di bawah.

## Setup database baru

1. Supabase SQL Editor: jalankan `supabase/migrations/001_eventra_schema_event.sql`.
2. Jalankan `supabase/migrations/002_repair_profiles_existing.sql` (aman untuk akun lama; tidak mengubah role Admin).
3. Jalankan `supabase/migrations/003_photos_rundown.sql` (membuat rundown, foto dan bucket Storage privat + RLS).
4. **Wajib:** Tambahkan `event` ke **Exposed schemas** Data API.
5. Buat user via Supabase **Authentication > Users > Add user**. Trigger otomatis membuat `event.profiles` dengan role `pic`.
6. Jadikan satu akun sebagai Admin pertama via SQL Editor (ganti email):
   ```sql
   UPDATE event.profiles SET role='admin' WHERE email='admin@contoh.com';
   ```
7. Jalankan Cron secara otomatis: aktifkan Supabase **Integrations > Cron > Enable** dahulu (jika belum aktif), lalu jalankan `supabase/cron/002_schedule_auto_notifications.sql` sekali. Job berjalan **setiap jam** tanpa tombol di aplikasi.

## Upgrade jika database versi lama sudah ada

Tidak perlu hapus database. Jika `event.profiles`, `event.events`, `event.notifications` sudah ada, cukup:

- `002_repair_profiles_existing.sql` (untuk memperbaiki profil lama jika perlu)
- `003_photos_rundown.sql` **wajib** untuk versi ini
- `002_schedule_auto_notifications.sql` setelah `pg_cron` aktif

Migration `003` tidak menghapus event lama dan bisa dijalankan ulang. Jangan jalankan `001` jika sebelumnya Anda sudah melakukan setup database event dengan data produksi tanpa backup.

**Perhatian**: Saat memakai Cron, file SQL `002_schedule_auto_notifications.sql` membutuhkan modul `pg_cron`. Jika muncul `schema "cron" does not exist`, aktifkan modul di **Integrations > Cron**, kemudian jalankan ulang file. Jadwal lama `eventra-reminders-daily` boleh dihapus setelah job hourly berjalan:

```sql
SELECT cron.unschedule('eventra-reminders-daily');
```

Jalankan baris di atas hanya bila job lama memang ada.

## Jalankan Next.js

Node.js >=20.9 disyaratkan, disarankan Node 22. Di direktori project:

```bash
cp .env.example .env.local
npm install
npm run dev
```

Isi `.env.local` memakai URL dan anon/publishable key dari **project yang sama**:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

**Jangan** masukkan `service_role` key ke variabel `NEXT_PUBLIC_*`.

## Cara menggunakan

- Login sebagai Admin / PIC. Admin dapat mengedit atau menghapus event mana pun dan mengatur role; PIC mengedit event yang ditugaskan kepadanya; keduanya dapat melihat data seluruh event.
- **Tambah Event / Edit Event**: isi info, progress, PIC; klik **Tambah kegiatan** untuk rundown (maks. 60). Isi waktu, nama kegiatan, penanggung jawab dan keterangan. Rundown ditampilkan pada drawer detail event.
- **Tambah foto dokumentasi**: pilih JPG, PNG, WebP maksimal 5 MB per file dan maksimal 10 file per event. Foto disimpan di bucket privat `eventra-event-photos`, dapat dilihat semua user yang login melalui signed URL sementara. Hanya Admin atau PIC terkait dapat menambah/menghapus.
- **Pengingat**: tab Notifikasi selalu aktif, sinkron saat login dan setiap menit. Jika Cron diaktifkan, database membuat pengingat untuk setiap user secara otomatis setiap jam walaupun dashboard tertutup. Pengingat muncul saat user membuka aplikasi.
- **Notifikasi browser**: pop-up OS memerlukan izin browser yang tidak bisa diberikan secara otomatis oleh website. Versi ini tidak meminta izin atau menyediakan tombol aktivasi; bila izin pernah diberikan, pop-up dapat muncul selama dashboard terbuka. Pengingat dalam dashboard tidak membutuhkan izin tersebut.
- Export CSV pada halaman Semua Event mengikuti status dan prioritas yang difilter.

## Verifikasi

SQL berikut memastikan tabel baru ada:

```sql
SELECT to_regclass('event.profiles') AS profiles,
       to_regclass('event.events') AS events,
       to_regclass('event.event_photos') AS photos,
       to_regclass('event.rundown_items') AS rundown;
```

Test pengingat:

```sql
SELECT event.dispatch_event_reminders();
SELECT jobid, jobname, active, schedule FROM cron.job
WHERE jobname = 'eventra-reminders-hourly';
```

Jika error **PGRST106**, hampir selalu berarti `event` belum terekspos sebagai schema Data API ke PostgREST. Periksa **Data API > Exposed schemas**, bukan membuat ulang profiles. Periksa konfigurasi manual bila perlu:

```sql
SELECT rolname,rolconfig FROM pg_roles WHERE rolname='authenticator';
```

Jika ada override `pgrst.db_schemas=public` dan schema `event` telah ditambahkan di dashboard, hapus override serta reload:

```sql
ALTER ROLE authenticator RESET pgrst.db_schemas;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
```

Lakukan perubahan role hanya bila hasil diagnostik menunjukkan override manual, dengan hak admin dan memahami dampaknya terhadap API lain.

## Hak akses & catatan teknis

- RLS pada tabel `event` tetap aktif. Bucket Storage privat; setiap user login boleh membaca, hanya Admin atau assigned PIC yang boleh mengubah foto.
- Penyimpanan rundown menggunakan fungsi PostgreSQL `event.save_rundown` agar penggantian semua kegiatan berlangsung dalam satu transaksi.
- Pembuatan event diikuti penyimpanan rundown dan upload foto adalah operasi lintas layanan, **bukan satu transaksi atomik**. Jika upload gagal, event yang sudah berhasil dibuat tetap ada; form memberi kesempatan klik Simpan ulang. Bila menghapus event, file Storage dibersihkan lebih dulu agar tidak menjadi file yatim.
- Tidak ada layanan push ketika browser tertutup, email, atau WhatsApp. Untuk itu perlu integrasi tambahan seperti Web Push/Email provider.
- `npm run typecheck` dan `npm run build` untuk memverifikasi setelah dependencies terinstal.

## Referensi

- Custom schemas: https://supabase.com/docs/guides/api/using-custom-schemas
- Storage RLS: https://supabase.com/docs/guides/storage/security/access-control
- Cron: https://supabase.com/docs/guides/cron
