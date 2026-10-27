"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CalendarDays, ChevronDown, ImagePlus, Plus, Save, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES, defaultFormValues, eventStatus, formFromEvent } from "@/lib/utils";
import type { EventFormValues, EventItem, EventPhoto, Profile, Priority, RundownDraft } from "@/lib/types";

const BUCKET = "eventra-event-photos";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTOS = 10;
const MAX_SIZE = 5 * 1024 * 1024;

interface Props {
  event?: EventItem | null;
  profile: Profile;
  profiles: Profile[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function localTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function freshRundown(start: string, end: string): RundownDraft {
  return { start_at: start, end_at: end, activity: "", pic_name: "", notes: "" };
}

export default function EventModal({ event, profile, profiles, onClose, onSaved }: Props) {
  const supabase = useRef(createClient()).current;
  const createdEventId = useRef<string | null>(null);
  const [form, setForm] = useState<EventFormValues>(() => event ? formFromEvent(event) : defaultFormValues(profile.id));
  const [rundown, setRundown] = useState<RundownDraft[]>([]);
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(Boolean(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setForm(v => ({ ...v, [key]: value }));
  const canAssign = profile.role === "admin";

  useEffect(() => {
    if (!event) return;
    let alive = true;
    (async () => {
      const [r, p] = await Promise.all([
        supabase.schema("event").from("rundown_items").select("*").eq("event_id", event.id).order("sort_order"),
        supabase.schema("event").from("event_photos").select("*").eq("event_id", event.id).order("created_at"),
      ]);
      if (!alive) return;
      if (r.error || p.error) {
        setError(`Gagal membaca foto/rundown. Pastikan migration 003 sudah dijalankan: ${r.error?.message || p.error?.message}`);
      } else {
        setRundown(((r.data || []) as {start_at: string;end_at: string;activity: string;pic_name: string;notes: string}[]).map(item => ({
          start_at: localTime(item.start_at), end_at: localTime(item.end_at),
          activity: item.activity, pic_name: item.pic_name, notes: item.notes,
        })));
        const loaded = (p.data || []) as EventPhoto[];
        setPhotos(loaded);
        const urls: Record<string, string> = {};
        await Promise.all(loaded.map(async item => {
          const result = await supabase.storage.from(BUCKET).createSignedUrl(item.storage_path, 3600);
          if (result.data?.signedUrl) urls[item.id] = result.data.signedUrl;
        }));
        if (alive) setPhotoUrls(urls);
      }
      if (alive) setLoadingExtras(false);
    })();
    return () => { alive = false; };
  }, [event, supabase]);

  function appendPhotos(change: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(change.target.files || []);
    change.target.value = "";
    if (files.some(file => !ALLOWED_TYPES.includes(file.type))) { setError("Foto harus JPG, PNG, atau WebP."); return; }
    if (files.some(file => file.size > MAX_SIZE)) { setError("Maksimal 5 MB untuk setiap foto."); return; }
    const existingCount = photos.filter(p => !removedPhotoIds.includes(p.id)).length;
    if (existingCount + pendingPhotos.length + files.length > MAX_PHOTOS) { setError(`Maksimal ${MAX_PHOTOS} foto per event.`); return; }
    setPendingPhotos(old => [...old, ...files]);
    setError("");
  }
  function updateRundown(index: number, key: keyof RundownDraft, value: string) {
    setRundown(items => items.map((item, idx) => idx === index ? { ...item, [key]: value } : item));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    const start = new Date(form.start_at);
    const end = new Date(form.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { setError("Tanggal dan waktu tidak valid."); return; }
    if (end <= start) { setError("Waktu selesai harus setelah waktu mulai."); return; }
    if (!form.title.trim() || form.title.trim().length < 3) { setError("Nama event minimal 3 karakter."); return; }
    if (form.progress < 0 || form.progress > 100) { setError("Progress harus berada antara 0 dan 100."); return; }
    if (!Number.isSafeInteger(form.participant_target) || form.participant_target < 0 || !Number.isFinite(form.budget) || form.budget < 0) { setError("Jumlah peserta dan budget harus valid."); return; }
    if (rundown.length > 60) { setError("Maksimal 60 kegiatan dalam rundown."); return; }
    for (const item of rundown) {
      if (!item.activity.trim() || !item.start_at || !item.end_at || new Date(item.end_at) <= new Date(item.start_at)) {
        setError("Periksa rundown: setiap kegiatan harus memiliki nama serta waktu mulai dan selesai yang valid."); return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(), description: form.description.trim(), category: form.category,
        location: form.location.trim(), start_at: start.toISOString(), end_at: end.toISOString(),
        priority: form.priority, progress: form.progress, participant_target: form.participant_target,
        budget: form.budget, notes: form.notes.trim(),
        assigned_pic: canAssign ? form.assigned_pic : (event?.assigned_pic || profile.id),
      };
      const id = event?.id || createdEventId.current;
      const result = id
        ? await supabase.schema("event").from("events").update(payload).eq("id", id).select("id").single()
        : await supabase.schema("event").from("events").insert({ ...payload, created_by: profile.id }).select("id").single();
      if (result.error) throw result.error;
      const eventId = result.data?.id as string | undefined;
      if (!eventId) throw new Error("Data event gagal disimpan. Periksa hak akses Admin/PIC.");
      createdEventId.current = eventId;

      // Single PostgreSQL function performs full replacement inside a transaction.
      const { error: rundownError } = await supabase.schema("event").rpc("save_rundown", {
        p_event_id: eventId,
        p_items: rundown.map(item => ({
          start_at: new Date(item.start_at).toISOString(), end_at: new Date(item.end_at).toISOString(),
          activity: item.activity.trim(), pic_name: item.pic_name.trim(), notes: item.notes.trim(),
        })),
      });
      if (rundownError) throw new Error(`Gagal menyimpan rundown: ${rundownError.message}`);

      for (const file of pendingPhotos) {
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${eventId}/${crypto.randomUUID()}.${ext}`;
        const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (upload.error) throw new Error(`Upload foto gagal (${file.name}): ${upload.error.message}`);
        const inserted = await supabase.schema("event").from("event_photos").insert({
          event_id: eventId, storage_path: path, uploaded_by: profile.id,
        }).select("*").single();
        if (inserted.error) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw new Error(`Menyimpan data foto gagal: ${inserted.error.message}`);
        }
        // Remove already-uploaded files from the queue to prevent duplicates on retry.
        setPhotos(old => [...old, inserted.data as EventPhoto]);
        setPendingPhotos(old => old.filter(item => item !== file));
      }
      for (const photo of photos.filter(photo => removedPhotoIds.includes(photo.id))) {
        const deleted = await supabase.schema("event").from("event_photos").delete().eq("id", photo.id);
        if (deleted.error) throw new Error(`Gagal menghapus data foto: ${deleted.error.message}`);
        // If the Storage delete fails, an unreferenced object may remain; inform user.
        const cleaned = await supabase.storage.from(BUCKET).remove([photo.storage_path]);
        if (cleaned.error) console.warn("[Eventra] Foto tersimpan yang tidak terpakai perlu dibersihkan:", cleaned.error.message);
      }
      onSaved(event ? "Event, foto, dan rundown berhasil diperbarui." : "Event baru beserta foto dan rundown berhasil dibuat.");
    } catch (err) {
      setError((err instanceof Error ? err.message : "Gagal menyimpan data.") +
        (createdEventId.current && !event ? " Data event sudah dibuat; klik Simpan lagi untuk melanjutkan tanpa membuat duplikat." : ""));
    } finally { setSaving(false); }
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="event-modal-title">
      <div className="modal-header"><div className="modal-title-icon"><CalendarDays size={22}/></div><div><h2 id="event-modal-title">{event ? "Edit event" : "Buat event baru"}</h2><p>Informasi event, foto dokumentasi, dan rundown acara.</p></div><button className="icon-button modal-x" type="button" aria-label="Tutup" onClick={onClose} disabled={saving}><X size={21}/></button></div>
      <form onSubmit={submit} className="modal-form">
        <div className="form-section-title">INFORMASI EVENT</div>
        <div className="field full"><label htmlFor="event-title">Nama Event <span className="required">*</span></label><input id="event-title" value={form.title} onChange={e=>set("title",e.target.value)} maxLength={160} minLength={3} required placeholder="Contoh: Annual Marketing Summit 2026"/></div>
        <div className="form-grid"><div className="field"><label htmlFor="event-category">Kategori</label><div className="select-wrap"><select id="event-category" value={form.category} onChange={e=>set("category",e.target.value)}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={16}/></div></div><div className="field"><label htmlFor="event-location">Lokasi</label><input id="event-location" value={form.location} onChange={e=>set("location",e.target.value)} placeholder="Lokasi event"/></div></div>
        <div className="field full"><label htmlFor="event-description">Deskripsi event</label><textarea id="event-description" rows={3} value={form.description} onChange={e=>set("description",e.target.value)}/></div>
        <div className="form-section-title">JADWAL & PENANGGUNG JAWAB</div>
        <div className="form-grid">
          <div className="field"><label htmlFor="event-start">Mulai <span className="required">*</span></label><input id="event-start" type="datetime-local" required value={form.start_at} onChange={e=>set("start_at",e.target.value)}/></div>
          <div className="field"><label htmlFor="event-end">Selesai <span className="required">*</span></label><input id="event-end" type="datetime-local" required value={form.end_at} onChange={e=>set("end_at",e.target.value)}/></div>
          <div className="field"><label htmlFor="event-pic">PIC Event</label><div className="select-wrap"><select id="event-pic" value={form.assigned_pic} disabled={!canAssign} onChange={e=>set("assigned_pic",e.target.value)}>{profiles.filter(p=>p.role==="pic" || p.id===form.assigned_pic).map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select><ChevronDown size={16}/></div>{!canAssign&&<small className="field-hint">Hanya Admin yang bisa mengganti PIC.</small>}</div>
          <div className="field"><label htmlFor="event-priority">Prioritas</label><div className="select-wrap"><select id="event-priority" value={form.priority} onChange={e=>set("priority",e.target.value as Priority)}><option value="high">High - Mendesak</option><option value="mid">Mid - Normal</option><option value="low">Low - Rendah</option></select><ChevronDown size={16}/></div></div>
        </div>
        <div className="form-section-title">PROGRESS & DETAIL TAMBAHAN</div>
        <div className="field full"><div className="progress-form-head"><label htmlFor="event-progress">Progress event</label><div><b>{form.progress}%</b> <span className={`status-pill status-${eventStatus(form.progress)}`}>{eventStatus(form.progress)==="completed"?"Selesai":eventStatus(form.progress)==="in_progress"?"Dalam proses":"Belum dimulai"}</span></div></div><input className="range-input" id="event-progress" type="range" min="0" max="100" step="5" value={form.progress} onChange={e=>set("progress",Number(e.target.value))}/></div>
        <div className="form-grid"><div className="field"><label htmlFor="event-participants">Target peserta</label><input id="event-participants" type="number" min="0" step="1" value={form.participant_target} onChange={e=>set("participant_target",Number(e.target.value))}/></div><div className="field"><label htmlFor="event-budget">Budget (Rp)</label><input id="event-budget" type="number" min="0" step="1000" value={form.budget} onChange={e=>set("budget",Number(e.target.value))}/></div></div>
        <div className="field full"><label htmlFor="event-notes">Catatan internal</label><textarea id="event-notes" rows={2} value={form.notes} onChange={e=>set("notes",e.target.value)}/></div>

        <div className="extra-section-heading"><div><div className="form-section-title">RUNDOWN ACARA</div><small>Susun urutan kegiatan, waktu, dan penanggung jawab.</small></div><button type="button" className="btn btn-outline btn-sm" disabled={loadingExtras || rundown.length>=60} onClick={()=>setRundown(items=>[...items,freshRundown(form.start_at,form.end_at)])}><Plus size={16}/>Tambah kegiatan</button></div>
        {rundown.map((item,index)=><div className="rundown-edit-card" key={index}>
          <div className="rundown-edit-heading"><b>Kegiatan {index+1}</b><button type="button" className="icon-button" aria-label={`Hapus kegiatan ${index+1}`} onClick={()=>setRundown(items=>items.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>
          <div className="field full"><label htmlFor={`activity-${index}`}>Nama kegiatan *</label><input id={`activity-${index}`} required maxLength={200} value={item.activity} onChange={e=>updateRundown(index,"activity",e.target.value)} placeholder="Registrasi, pembukaan, sambutan, sesi materi..."/></div>
          <div className="form-grid"><div className="field"><label htmlFor={`rundown-start-${index}`}>Mulai</label><input id={`rundown-start-${index}`} type="datetime-local" required value={item.start_at} onChange={e=>updateRundown(index,"start_at",e.target.value)}/></div><div className="field"><label htmlFor={`rundown-end-${index}`}>Selesai</label><input id={`rundown-end-${index}`} type="datetime-local" required value={item.end_at} onChange={e=>updateRundown(index,"end_at",e.target.value)}/></div></div>
          <div className="form-grid"><div className="field"><label htmlFor={`rundown-pic-${index}`}>Penanggung jawab</label><input id={`rundown-pic-${index}`} value={item.pic_name} onChange={e=>updateRundown(index,"pic_name",e.target.value)} placeholder="Nama pembawa acara / tim"/></div><div className="field"><label htmlFor={`rundown-notes-${index}`}>Keterangan</label><input id={`rundown-notes-${index}`} value={item.notes} onChange={e=>updateRundown(index,"notes",e.target.value)} placeholder="Perlengkapan / catatan"/></div></div>
        </div>)}
        {!rundown.length&&<p className="form-empty-extras">Belum ada kegiatan rundown. Klik Tambah kegiatan untuk mengisi jadwal.</p>}

        <div className="extra-section-heading"><div><div className="form-section-title">FOTO EVENT</div><small>JPG, PNG, atau WebP. Maksimal {MAX_PHOTOS} foto, masing-masing 5 MB.</small></div></div>
        {photos.filter(p=>!removedPhotoIds.includes(p.id)).length>0&&<div className="event-photo-grid">{photos.filter(p=>!removedPhotoIds.includes(p.id)).map(photo=><div className="event-photo-card" key={photo.id}>{photoUrls[photo.id]?<img src={photoUrls[photo.id]} alt="Dokumentasi event"/>:<span>Memuat foto...</span>}<button type="button" className="photo-remove" aria-label="Hapus foto" onClick={()=>setRemovedPhotoIds(ids=>[...ids,photo.id])}><X size={15}/></button></div>)}</div>}
        {!!pendingPhotos.length&&<div className="pending-photo-list">{pendingPhotos.map((file,index)=><div key={`${file.name}-${index}`}><span>{file.name} ({(file.size/1048576).toFixed(1)} MB)</span><button type="button" aria-label={`Batal upload ${file.name}`} onClick={()=>setPendingPhotos(items=>items.filter((_,i)=>i!==index))}><X size={15}/></button></div>)}</div>}
        <label className="photo-upload-zone"><ImagePlus size={22}/><span>Tambah foto dokumentasi</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={appendPhotos} disabled={saving||loadingExtras}/></label>
        {loadingExtras&&<p className="field-hint">Memuat rundown dan foto...</p>}
        {error&&<div className="form-alert" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-light" onClick={onClose} disabled={saving}>Batal</button><button type="submit" disabled={saving||loadingExtras} className="btn btn-primary"><Save size={17}/>{saving?"Menyimpan...":event?"Simpan perubahan":"Buat event"}</button></div>
      </form>
    </section>
  </div>;
}
