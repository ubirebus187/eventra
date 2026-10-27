"use client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Props = { kind?: "missing-profile" | "query-error"; code?: string };

export default function SetupError({ kind = "missing-profile", code }: Props) {
  const router = useRouter();
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="setup-error" role="alert">
      <h1>{kind === "query-error" ? "Profil gagal dibaca" : "Profil belum tersedia"}</h1>
      <p>
        {kind === "query-error"
          ? <>Aplikasi sudah login, tetapi tidak bisa membaca tabel <code>event.profiles</code>. Pastikan schema <code>event</code> ada di <strong>Exposed schemas</strong> Supabase dan memiliki izin SELECT serta RLS untuk user login.</>
          : <>Akun berhasil login, tetapi belum ada profil dengan ID yang sama di <code>event.profiles</code>. Jalankan SQL perbaikan di <code>supabase/migrations/002_repair_profiles_existing.sql</code> melalui Supabase SQL Editor.</>}
      </p>
      {code && <p>Kode Supabase: <code>{code}</code>. Detail error tersedia di terminal Next.js.</p>}
      <button className="btn btn-primary" onClick={() => void logout()}>
        <LogOut size={17} /> Keluar dan kembali ke login
      </button>
    </main>
  );
}
