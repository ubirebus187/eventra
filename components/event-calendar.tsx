"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, MapPin } from "lucide-react";
import type { EventItem } from "@/lib/types";
import { dateKey, formatDateTime } from "@/lib/utils";

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const monthLabel = (date: Date) => new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(date);

export default function EventCalendar({ events, onEventClick }: {events: EventItem[]; onEventClick:(event:EventItem)=>void}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(()=>dateKey(new Date()));
  const today = dateKey(new Date());
  const cells = useMemo(() => {
    const offset = (month.getDay() + 6) % 7;
    const first = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    return Array.from({length:42}, (_,i)=>new Date(first.getFullYear(), first.getMonth(), first.getDate()+i));
  },[month]);
  const monthEvents = useMemo(()=>events.filter(e=>dateKey(e.start_at)===selected).sort((a,b)=>a.start_at.localeCompare(b.start_at)),[events,selected]);
  const byDay = useMemo(()=>{
    const map:Record<string,EventItem[]>={};
    events.forEach(e=> { const key=dateKey(e.start_at); (map[key] ||= []).push(e); });
    return map;
  },[events]);
  function navigate(delta:number) {
    const d = new Date(month.getFullYear(), month.getMonth()+delta, 1);
    setMonth(d); setSelected(dateKey(d));
  }
  return <div className="calendar-workspace">
    <section className="surface calendar-main"><div className="calendar-head"><div><h3>Kalender event</h3><p>Lihat jadwal seluruh event tim dalam satu tampilan.</p></div><div className="calendar-controls"><button className="btn btn-light btn-sm" onClick={()=>{const now=new Date();setMonth(new Date(now.getFullYear(),now.getMonth(),1));setSelected(dateKey(now));}}>Hari ini</button><button className="icon-button bordered" aria-label="Bulan sebelumnya" onClick={()=>navigate(-1)}><ChevronLeft size={18}/></button><strong>{monthLabel(month)}</strong><button className="icon-button bordered" aria-label="Bulan berikutnya" onClick={()=>navigate(1)}><ChevronRight size={18}/></button></div></div>
      <div className="calendar-grid">{DAYS.map(day=><div key={day} className="calendar-weekday">{day}</div>)}{cells.map(date=>{
        const key=dateKey(date), dayEvents=byDay[key] || [];
        const outside=date.getMonth()!==month.getMonth();
        return <button key={key} className={`calendar-cell ${outside?"outside":""} ${today===key?"today":""} ${selected===key?"selected":""}`} onClick={()=>{setSelected(key);if(outside)setMonth(new Date(date.getFullYear(),date.getMonth(),1));}}><span className="calendar-number">{date.getDate()}</span><span className="calendar-cell-events">{dayEvents.slice(0,2).map(e=><span className={`calendar-event-bar event-${e.priority}`} key={e.id}>{e.title}</span>)}{dayEvents.length>2&&<small>+{dayEvents.length-2} event lagi</small>}</span></button>;
      })}</div>
      <div className="calendar-legend"><span><i className="dot dot-high"/>High</span><span><i className="dot dot-mid"/>Mid</span><span><i className="dot dot-low"/>Low</span></div>
    </section>
    <aside className="surface selected-day-panel"><div className="day-heading"><span className="subtle-label">JADWAL TERPILIH</span><h3>{new Intl.DateTimeFormat("id-ID",{weekday:"long", day:"numeric",month:"long",year:"numeric"}).format(new Date(`${selected}T12:00:00`))}</h3><p>{monthEvents.length} event dijadwalkan</p></div>
      <div className="selected-day-list">{monthEvents.length?monthEvents.map(e=><button key={e.id} className="day-event-card" onClick={()=>onEventClick(e)}><span className={`dot dot-${e.priority}`}/><div><b>{e.title}</b><small><CalendarDays size={13}/>{formatDateTime(e.start_at)}</small><small><MapPin size={13}/>{e.location||"Lokasi belum ditentukan"}</small></div><ChevronRight size={17}/></button>):<div className="empty-state compact"><CalendarDays size={26}/><b>Belum ada event</b><p>Tidak ada event yang dimulai pada tanggal ini.</p></div>}</div>
    </aside>
  </div>;
}
