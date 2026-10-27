"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Images } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { EventPhoto, RundownItem } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function EventExtras({ eventId }: { eventId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [photos, setPhotos] = useState<(EventPhoto & { url?: string })[]>([]);
  const [items, setItems] = useState<RundownItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [photosResult, rundownResult] = await Promise.all([
        supabase.schema("event").from("event_photos").select("*").eq("event_id", eventId).order("created_at"),
        supabase.schema("event").from("rundown_items").select("*").eq("event_id", eventId).order("sort_order"),
      ]);
      if (!alive) return;
      if (photosResult.error || rundownResult.error) {
        setError(photosResult.error?.message || rundownResult.error?.message || "Gagal membaca dokumentasi acara.");
        setLoading(false);
        return;
      }
      const files = (photosResult.data || []) as EventPhoto[];
      const signed = await Promise.all(files.map(async file => {
        const { data } = await supabase.storage.from("eventra-event-photos").createSignedUrl(file.storage_path, 3600);
        return { ...file, url: data?.signedUrl };
      }));
      if (alive) {
        setPhotos(signed);
        setItems((rundownResult.data || []) as RundownItem[]);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supabase, eventId]);

  return <div className="event-extras-detail">
    <div className="drawer-section-title"><Images size={15}/> FOTO EVENT</div>
    {loading ? <p className="extras-muted">Memuat dokumentasi...</p> : error ? <p className="form-alert">{error}. Pastikan migration 003 telah dijalankan.</p> : photos.length ?
      <div className="event-photo-grid detail-photos">{photos.map(photo => photo.url ?
        <a href={photo.url} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.url} alt="Foto dokumentasi event" loading="lazy"/></a> :
        <div key={photo.id} className="photo-unavailable">Foto tidak tersedia</div>)}</div> : <p className="extras-muted">Belum ada foto event.</p>}
    <div className="drawer-section-title"><CalendarClock size={15}/> RUNDOWN ACARA</div>
    {!loading && !error && (items.length ? <div className="detail-rundown-list">{items.map((item,index)=><div className="detail-rundown-item" key={item.id}>
      <span className="rundown-order">{index+1}</span><div><strong>{item.activity}</strong><small>{formatDateTime(item.start_at)} - {new Intl.DateTimeFormat("id-ID",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jakarta"}).format(new Date(item.end_at))} WIB</small>{item.pic_name&&<small>PJ: {item.pic_name}</small>}{item.notes&&<small>{item.notes}</small>}</div>
    </div>)}</div> : <p className="extras-muted">Belum ada rundown acara.</p>)}
  </div>;
}
