"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const { error } = await createClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/dashboard"); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal. Coba kembali.");
    } finally { setSubmitting(false); }
  }
  return <div className="login-layout">
    <section className="login-showcase">
      <div className="login-brand"><span className="brand-mark"><CalendarDays size={23}/></span><span>eventra<span className="brand-dot">.</span></span></div>
      <div className="showcase-main">
        <span className="showcase-eyebrow"><Sparkles size={15}/> ALL-IN-ONE EVENT WORKSPACE</span>
        <h1>Better events.<br/><span>Less complexity.</span></h1>
        <p>Rencanakan, koordinasikan, dan pantau semua event tim dari satu tempat. Setiap progres tercatat, setiap detail terkendali.</p>
        <div className="showcase-preview" aria-hidden="true">
          <div className="preview-top"><div className="preview-icon"><CalendarDays size={18}/></div><div><b>Event Overview</b><small>Performance this month</small></div><span className="preview-tag">Live progress</span></div>
          <div className="preview-bars"><div><small>Annual Conference</small><strong>85%</strong><span className="mini-track"><i style={{width:"85%"}}/></span></div><div><small>Product Workshop</small><strong>64%</strong><span className="mini-track"><i style={{width:"64%"}}/></span></div><div><small>Leadership Summit</small><strong>100%</strong><span className="mini-track"><i style={{width:"100%"}}/></span></div></div>
          <div className="preview-bottom"><CheckCircle2 size={15}/> Stay aligned, from planning to completion</div>
        </div>
      </div>
      <div className="showcase-footer"><ShieldCheck size={16}/> Akses aman dengan Supabase Authentication</div>
    </section>
    <main className="login-content"><div className="login-card">
      <div className="login-mobile-brand"><span className="brand-mark"><CalendarDays size={21}/></span>eventra.</div>
      <span className="login-overline">SELAMAT DATANG KEMBALI</span>
      <h2>Masuk ke akun Anda</h2>
      <p className="login-subtitle">Kelola semua event dan pantau perkembangan tim dalam satu dashboard.</p>
      <form onSubmit={onSubmit}>
        <label className="field-label" htmlFor="login-email">Email</label>
        <div className="login-input-wrap"><Mail size={19}/><input id="login-email" type="email" placeholder="nama@perusahaan.com" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
        <label className="field-label" htmlFor="login-password">Password</label>
        <div className="login-input-wrap"><LockKeyhole size={19}/><input id="login-password" type={visible ? "text" : "password"} placeholder="Masukkan password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/><button type="button" className="password-toggle" aria-label={visible ? "Sembunyikan password" : "Tampilkan password"} onClick={()=>setVisible(!visible)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <button className="btn btn-primary login-submit" type="submit" disabled={submitting}>{submitting ? "Memproses..." : "Masuk ke dashboard"}<ArrowRight size={18}/></button>
      </form>
      <p className="login-note">Belum punya akun? Hubungi Admin untuk membuat akun PIC atau Admin.</p>
    </div><div className="login-copy">© {new Date().getFullYear()} Eventra. All rights reserved.</div></main>
  </div>;
}
