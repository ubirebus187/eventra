"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, BellRing, CalendarClock, CalendarDays,
  Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, Clock3, Filter, LayoutDashboard,
  LogOut, MapPin, Menu, MoreHorizontal, Plus, Search, Settings2, ShieldCheck,
  Sparkles, Target, Trash2, TrendingUp, Users, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dateKey, exportCsv, formatCurrency, formatDate, formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/utils";
import type { EventItem, EventStatus, Priority, Profile, Reminder, Role, View } from "@/lib/types";
import EventModal from "@/components/event-modal";
import EventExtras from "@/components/event-extras";
import EventCalendar from "@/components/event-calendar";
import StatusDonut from "@/components/status-donut";

type StatusFilter = EventStatus | "all";
type PriorityFilter = Priority | "all";

const nav: {id:View;label:string;icon: typeof LayoutDashboard}[] = [
  {id:"overview",label:"Dashboard",icon:LayoutDashboard},
  {id:"events",label:"Semua Event",icon:CalendarDays},
  {id:"calendar",label:"Kalender",icon:CalendarClock},
  {id:"notifications",label:"Notifikasi",icon:Bell},
  {id:"team",label:"Tim & Akses",icon:Users},
];

function Initials({ name, size="normal" }: {name:string;size?:"normal"|"small"}) {
  return <span className={`avatar avatar-${size}`}>{name.trim().split(/\s+/).slice(0,2).map(s=>s[0]||"").join("").toUpperCase()}</span>;
}
function PriorityBadge({priority}:{priority:Priority}) { return <span className={`priority-badge priority-${priority}`}><i/>{PRIORITY_LABELS[priority]}</span>; }
function StatusBadge({status}:{status:EventStatus}) {return <span className={`status-pill status-${status}`}><i/>{STATUS_LABELS[status]}</span>;}
function ProgressBar({value}:{value:number}) {return <div className="progress-pair"><span className="progress-track"><span style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></span><b>{value}%</b></div>;}

export default function DashboardClient({profile}:{profile:Profile}) {
  const router = useRouter();
  const supabase = useMemo(()=>createClient(),[]);
  const [view,setView] = useState<View>("overview");
  const [events,setEvents] = useState<EventItem[]>([]);
  const [profiles,setProfiles] = useState<Profile[]>([profile]);
  const [reminders,setReminders] = useState<Reminder[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [modal,setModal] = useState<{event?:EventItem}|null>(null);
  const [detail,setDetail] = useState<EventItem|null>(null);
  const [deleting,setDeleting] = useState(false);
  const [search,setSearch] = useState("");
  const [statusFilter,setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter,setPriorityFilter] = useState<PriorityFilter>("all");
  const [sidebarOpen,setSidebarOpen] = useState(false);
  
  const notified = useRef(new Set<string>());
  const [changingRole,setChangingRole] = useState<string|null>(null);

  useEffect(()=>{
    if (!toast) return;
    const timeout=setTimeout(()=>setToast(""),4100);
    return ()=>clearTimeout(timeout);
  },[toast]);

  const loadData = useCallback(async (first=false) => {
    if (first) setLoading(true);
    try {
      // Pagination prevents the Supabase default 1000-row limit from silently truncating reports.
      const allEvents: EventItem[]=[];
      const pageSize=500;
      for (let offset=0;;offset+=pageSize) {
        const {data,error}=await supabase.schema("event").from("events").select("*").order("start_at",{ascending:true}).order("id",{ascending:true}).range(offset,offset+pageSize-1);
        if (error) throw error;
        const chunk=(data||[]) as EventItem[];
        allEvents.push(...chunk);
        if (chunk.length<pageSize) break;
      }
      const [userResult,reminderResult] = await Promise.all([
        supabase.schema("event").from("profiles").select("*").order("full_name"),
        supabase.schema("event").from("notifications").select("*").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(200),
      ]);
      if (userResult.error) throw userResult.error;
      if (reminderResult.error) throw reminderResult.error;
      setEvents(allEvents);
      setProfiles((userResult.data||[]) as Profile[]);
      setReminders((reminderResult.data||[]) as Reminder[]);
      setError("");
    } catch (err) {setError(err instanceof Error ? err.message : "Gagal memuat data. Periksa koneksi Supabase.");}
    finally {if (first) setLoading(false);}
  },[supabase,profile.id]);

  const refreshReminders=useCallback(async()=>{
    // Ensures reminders appear when a user opens the app even without optional Cron.
    await supabase.schema("event").rpc("sync_my_reminders");
    const {data,error}=await supabase.schema("event").from("notifications").select("*").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(200);
    if(!error) setReminders((data||[]) as Reminder[]);
  },[supabase,profile.id]);

  useEffect(()=>{
    void (async()=>{await refreshReminders();await loadData(true);})();
    const interval=window.setInterval(()=>{void refreshReminders();void loadData();},60_000);
    const channel=supabase.channel("eventra-sync")
      .on("postgres_changes",{event:"*",schema:"event",table:"events"},()=>{void loadData();void refreshReminders();})
      .on("postgres_changes",{event:"*",schema:"event",table:"profiles"},()=>{void loadData();})
      .on("postgres_changes",{event:"*",schema:"event",table:"notifications",filter:`user_id=eq.${profile.id}`},()=>{void refreshReminders();})
      .subscribe();
    return ()=>{window.clearInterval(interval);void supabase.removeChannel(channel);};
  },[loadData,refreshReminders,supabase,profile.id]);

  useEffect(()=>{
    if(typeof window==="undefined"||!("Notification" in window)||Notification.permission!=="granted") return;
    for(const note of reminders){
      if(note.read_at||notified.current.has(note.id))continue;
      // Only notify for new reminders. Older items remain available inside the app.
      if(Date.now()-new Date(note.created_at).getTime()>90_000)continue;
      const event=events.find(e=>e.id===note.event_id);
      if(!event)continue;
      notified.current.add(note.id);
      new Notification("Pengingat Eventra",{body:`${reminderKindText(note.kind)}: ${event.title}`,tag:note.id});
    }
  },[reminders,events]);

  const picNames=useMemo(()=>Object.fromEntries(profiles.map(p=>[p.id,p.full_name])),[profiles]);
  const statuses=useMemo(()=>({
    not_started:events.filter(e=>e.status==="not_started").length,
    in_progress:events.filter(e=>e.status==="in_progress").length,
    completed:events.filter(e=>e.status==="completed").length,
  }),[events]);
  const averageProgress=events.length?Math.round(events.reduce((sum,e)=>sum+e.progress,0)/events.length):0;
  const unread=reminders.filter(n=>!n.read_at).length;
  const nextEvents=useMemo(()=>events.filter(e=>e.status!=="completed"&&new Date(e.start_at).getTime()>=Date.now()-3600000).sort((a,b)=>a.start_at.localeCompare(b.start_at)).slice(0,5),[events]);
  const importantEvents=useMemo(()=>events.filter(e=>e.priority==="high"&&e.status!=="completed").sort((a,b)=>a.start_at.localeCompare(b.start_at)).slice(0,4),[events]);
  const filteredEvents=useMemo(()=>events.filter(e=>{
    if(statusFilter!=="all"&&e.status!==statusFilter)return false;
    if(priorityFilter!=="all"&&e.priority!==priorityFilter)return false;
    if(search.trim()){
      const text=[e.title,e.location,e.category,e.description,picNames[e.assigned_pic]||""].join(" ").toLowerCase();
      if(!text.includes(search.trim().toLowerCase()))return false;
    }
    return true;
  }).sort((a,b)=>b.created_at.localeCompare(a.created_at)),[events,statusFilter,priorityFilter,search,picNames]);
  const recentEvents=useMemo(()=>[...events].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,5),[events]);

  function navigate(target:View){setView(target);setSidebarOpen(false);setDetail(null);}
  async function logout(){const {error}=await supabase.auth.signOut();if(error){setToast(error.message);return;}router.replace("/login");router.refresh();}
  function onSaved(message:string){setModal(null);setDetail(null);setToast(message);void loadData();void refreshReminders();}
  function canEdit(event:EventItem){return profile.role==="admin"||event.assigned_pic===profile.id;}
  async function deleteEvent(event:EventItem){
    if(profile.role!=="admin")return;
    if(!window.confirm(`Hapus event “${event.title}”? Tindakan ini tidak dapat dibatalkan.`))return;
    setDeleting(true);
    const {data: photoRows,error: photoError}=await supabase.schema("event").from("event_photos").select("storage_path").eq("event_id",event.id);
    if(photoError){setDeleting(false);setToast(`Gagal memeriksa foto: ${photoError.message}`);return;}
    const paths: string[] = (
      (photoRows ?? []) as { storage_path: string }[]
    ).map((item) => item.storage_path);
    if(paths.length){
      const cleaned=await supabase.storage.from("eventra-event-photos").remove(paths);
      if(cleaned.error){setDeleting(false);setToast(`Gagal membersihkan foto event: ${cleaned.error.message}`);return;}
    }
    const {error}=await supabase.schema("event").from("events").delete().eq("id",event.id);
    setDeleting(false);
    if(error){setToast(`Gagal menghapus: ${error.message}`);return;}
    setDetail(null);setToast("Event berhasil dihapus.");void loadData();
  }
  async function markRead(note:Reminder){
    if(note.read_at)return;
    const {error}=await supabase.schema("event").from("notifications").update({read_at:new Date().toISOString()}).eq("id",note.id).eq("user_id",profile.id);
    if(error)setToast(error.message);else setReminders(items=>items.map(n=>n.id===note.id?{...n,read_at:new Date().toISOString()}:n));
  }
  async function markAllRead(){
    const {error}=await supabase.schema("event").from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",profile.id).is("read_at",null);
    if(error){setToast(error.message);return;}
    setReminders(items=>items.map(n=>({...n,read_at:n.read_at||new Date().toISOString()})));
    setToast("Semua notifikasi ditandai dibaca.");
  }
  async function changeRole(user:Profile,role:Role){
    if(profile.role!=="admin"||user.id===profile.id)return;
    setChangingRole(user.id);
    const {error}=await supabase.schema("event").rpc("set_user_role",{target_user_id:user.id,new_role:role});
    if(error)setToast(error.message);
    else {setToast(`Peran ${user.full_name} berhasil diubah.`);void loadData();}
    setChangingRole(null);
  }
  function showEvent(event:EventItem){setDetail(event);}

  const pageTitles:Record<View,{eyebrow:string;title:string;description:string}>={
    overview:{eyebrow:"OVERVIEW",title:"Dashboard",description:"Pantau aktivitas dan perkembangan seluruh event tim."},
    events:{eyebrow:"EVENT MANAGEMENT",title:"Semua Event",description:"Semua event, status, PIC, dan prioritas dalam satu daftar."},
    calendar:{eyebrow:"SCHEDULE",title:"Kalender Event",description:"Lihat jadwal dan event mendatang secara visual."},
    notifications:{eyebrow:"REMINDERS",title:"Notifikasi",description:"Pengingat otomatis agar jadwal penting tidak terlewat."},
    team:{eyebrow:"TEAM MANAGEMENT",title:"Tim & Akses",description:"Lihat anggota tim dan kelola peran Admin atau PIC."},
  };

  function renderEventTable(items:EventItem[],compact=false){
    return <div className="table-scroll"><table className="event-table"><thead><tr><th>NAMA EVENT</th><th>JADWAL</th><th>PIC</th><th>PRIORITAS</th><th>STATUS</th><th>PROGRESS</th><th className="center">AKSI</th></tr></thead><tbody>
      {items.map(e=><tr key={e.id}><td><button className="event-cell" onClick={()=>showEvent(e)}><span className={`event-cell-icon icon-${e.priority}`}><CalendarDays size={17}/></span><span><strong>{e.title}</strong><small>{e.category} · {e.location||"Lokasi belum ada"}</small></span></button></td><td><span className="table-main">{formatDate(e.start_at)}</span><small className="table-secondary">{formatDate(e.start_at,{hour:"2-digit",minute:"2-digit"})}</small></td><td><span className="person"><Initials name={picNames[e.assigned_pic]||"PIC"} size="small"/><span>{picNames[e.assigned_pic]||"PIC"}</span></span></td><td><PriorityBadge priority={e.priority}/></td><td><StatusBadge status={e.status}/></td><td><ProgressBar value={e.progress}/></td><td className="center"><button className="icon-button more-btn" aria-label={`Lihat detail ${e.title}`} onClick={()=>showEvent(e)}><MoreHorizontal size={19}/></button></td></tr>)}
      {!items.length&&<tr><td colSpan={7}><div className="empty-state"><Search size={30}/><b>Event tidak ditemukan</b><p>{compact?"Belum ada event yang tercatat.":"Coba ubah filter atau tambahkan event baru."}</p></div></td></tr>}
    </tbody></table></div>;
  }

  return <div className="app-shell">
    {sidebarOpen&&<button className="mobile-overlay" onClick={()=>setSidebarOpen(false)} aria-label="Tutup navigasi"/>}
    <aside className={`sidebar ${sidebarOpen?"sidebar-open":""}`}>
      <div className="sidebar-logo"><span className="brand-mark"><CalendarDays size={21}/></span><span>eventra<span className="brand-dot">.</span></span><button className="icon-button mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Tutup menu"><X size={21}/></button></div>
      <div className="sidebar-group-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Menu dashboard">{nav.filter(n=>n.id!=="team"||profile.role==="admin").map(item=>{const Icon=item.icon;return <button className={`nav-item ${view===item.id?"active":""}`} key={item.id} onClick={()=>navigate(item.id)}><Icon size={19} strokeWidth={view===item.id?2.3:1.9}/><span>{item.label}</span>{item.id==="notifications"&&unread>0&&<span className="nav-count">{unread>99?"99+":unread}</span>}</button>;})}</nav>
      <div className="sidebar-grow"/>
      <div className="sidebar-help"><div className="sidebar-help-icon"><Sparkles size={18}/></div><strong>Kerja tim jadi lebih mudah.</strong><p>Update progress event secara berkala agar semua orang tetap sinkron.</p></div>
      <div className="sidebar-user"><Initials name={profile.full_name}/><div className="sidebar-user-info"><strong>{profile.full_name}</strong><span>{profile.role==="admin"?"Administrator":"Person in Charge"}</span></div><button className="icon-button" title="Keluar" aria-label="Keluar" onClick={()=>void logout()}><LogOut size={19}/></button></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" aria-label="Buka menu" onClick={()=>setSidebarOpen(true)}><Menu size={22}/></button><span className="breadcrumb-parent">Workspace</span><ChevronRight size={15} className="breadcrumb-arrow"/><strong>{pageTitles[view].title}</strong></div><div className="topbar-right"><span className="today-date"><CalendarDays size={16}/>{formatDate(new Date().toISOString(),{day:"numeric",month:"long",year:"numeric"})}</span><button className="notification-button" aria-label="Lihat notifikasi" onClick={()=>navigate("notifications")}><Bell size={19}/>{unread>0&&<i/>}</button><div className="topbar-user"><Initials name={profile.full_name} size="small"/><span>{profile.full_name.split(" ")[0]}</span></div></div></header>
      <main className="dashboard-content">
        <div className="page-heading"><div><span className="overline">{pageTitles[view].eyebrow}</span><h1>{pageTitles[view].title}<span className="heading-dot">.</span></h1><p>{pageTitles[view].description}</p></div><div className="page-heading-actions">{view==="events"&&<button className="btn btn-outline" onClick={()=>exportCsv(filteredEvents,picNames)} disabled={!filteredEvents.length}><ArrowDownToLine size={18}/>Export CSV</button>}{view!=="notifications"&&view!=="team"&&<button className="btn btn-primary" onClick={()=>setModal({})}><Plus size={19}/>Tambah Event</button>}</div></div>

        {error&&<div className="dashboard-error" role="alert"><strong>Gagal memuat data:</strong> {error} <button onClick={()=>void loadData(true)}>Coba lagi</button></div>}
        {loading?<div className="loading-grid"><div/><div/><div/><div/><div/></div>:<>
        {view==="overview"&&<>
          <div className="welcome-banner"><div><span className="banner-chip"><Sparkles size={13}/> EVENT WORKSPACE</span><h2>Kelola event lebih cerdas,<br/>capai target bersama.</h2><p>Selamat datang, {profile.full_name.split(" ")[0]}. Semua perkembangan event ada di sini.</p><button className="banner-link" onClick={()=>navigate("events")}>Lihat semua event <ArrowRight size={16}/></button></div><div className="banner-art" aria-hidden="true"><div className="orb orb-one"/><div className="orb orb-two"/><div className="floating-card card-a"><CheckCircle2 size={19}/><span>Task completed<br/><b>100% progress</b></span></div><div className="floating-card card-b"><TrendingUp size={19}/><span>Team on track<br/><b>+ Event success</b></span></div><div className="orbit-ring"/></div></div>
          <div className="stats-grid"><StatCard icon={CalendarDays} label="Total Event" value={events.length} hint="Seluruh event tercatat" kind="indigo"/><StatCard icon={Activity} label="Dalam Proses" value={statuses.in_progress} hint="Event sedang berjalan" kind="mint"/><StatCard icon={CheckCircle2} label="Selesai" value={statuses.completed} hint="Event terselesaikan" kind="violet"/><StatCard icon={Clock3} label="Belum Dimulai" value={statuses.not_started} hint="Menunggu pelaksanaan" kind="orange"/></div>
          <div className="analytics-grid"><section className="surface analytic-panel"><SectionHeader title="Distribusi Status Event" subtitle="Komposisi seluruh event berdasarkan status"/><StatusDonut events={events}/></section><section className="surface analytic-panel"><SectionHeader title="Progress Keseluruhan" subtitle="Rata-rata tingkat penyelesaian event"/><div className="overall-progress"><div className="overall-value"><span>Completion rate</span><strong>{averageProgress}<small>%</small></strong></div><div className="overall-track"><span style={{width:`${averageProgress}%`}}/></div><div className="overall-labels"><span>0%</span><span>100%</span></div><div className="progress-summary"><span className="progress-summary-icon"><Target size={22}/></span><div><b>{statuses.completed} dari {events.length} event selesai</b><small>Terus perbarui progress agar laporan akurat.</small></div></div></div></section><section className="surface upcoming-panel"><SectionHeader title="Event Mendatang" subtitle="Jadwal terdekat yang perlu diperhatikan" action={<button className="text-action" onClick={()=>navigate("calendar")}>Kalender <ChevronRight size={15}/></button>}/><div className="upcoming-list">{nextEvents.map(e=><button className="upcoming-item" key={e.id} onClick={()=>showEvent(e)}><div className="date-tile"><b>{new Date(e.start_at).getDate()}</b><small>{formatDate(e.start_at,{month:"short"})}</small></div><div><strong>{e.title}</strong><small><Clock3 size={13}/>{formatDate(e.start_at,{hour:"2-digit",minute:"2-digit"})}</small></div><PriorityBadge priority={e.priority}/></button>)}{!nextEvents.length&&<div className="empty-state compact"><CalendarClock size={25}/><b>Tidak ada event mendatang</b><p>Tambahkan event untuk melihat jadwal di sini.</p></div>}</div></section></div>
          <div className="dashboard-bottom-grid"><section className="surface table-panel"><SectionHeader title="Event Terbaru" subtitle="Aktivitas event yang terakhir diperbarui" action={<button className="text-action" onClick={()=>navigate("events")}>Lihat semua <ChevronRight size={16}/></button>}/>{renderEventTable(recentEvents,true)}</section><aside className="surface priority-panel"><SectionHeader title="Perlu Perhatian" subtitle="Event high priority yang belum selesai"/><div className="priority-list">{importantEvents.map(e=><button className="priority-list-item" key={e.id} onClick={()=>showEvent(e)}><span className="priority-icon"><Target size={16}/></span><div><strong>{e.title}</strong><small>{formatDate(e.start_at)} · {e.progress}% progress</small><span className="priority-small-track"><i style={{width:`${e.progress}%`}}/></span></div><ChevronRight size={16}/></button>)}{!importantEvents.length&&<div className="empty-state compact"><CheckCircle2 size={25}/><b>Semua terkendali</b><p>Belum ada event prioritas tinggi yang aktif.</p></div>}</div></aside></div>
        </>}
        {view==="events"&&<section className="surface all-events-surface"><div className="events-toolbar"><div className="search-wrap"><Search size={19}/><input placeholder="Cari nama, lokasi, kategori atau PIC..." aria-label="Cari event" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Hapus pencarian" onClick={()=>setSearch("")}><X size={16}/></button>}</div><div className="filter-select"><Filter size={17}/><select value={statusFilter} aria-label="Filter status" onChange={e=>setStatusFilter(e.target.value as StatusFilter)}><option value="all">Semua Status</option><option value="not_started">Belum dimulai</option><option value="in_progress">Dalam proses</option><option value="completed">Selesai</option></select><ChevronDown size={14}/></div><div className="filter-select"><select value={priorityFilter} aria-label="Filter prioritas" onChange={e=>setPriorityFilter(e.target.value as PriorityFilter)}><option value="all">Semua Prioritas</option><option value="high">High</option><option value="mid">Mid</option><option value="low">Low</option></select><ChevronDown size={14}/></div></div><div className="table-heading"><div><h3>Daftar Event <span>{filteredEvents.length}</span></h3><p>{filteredEvents.length} dari {events.length} event ditampilkan</p></div><button className="btn btn-outline btn-sm" onClick={()=>{setSearch("");setStatusFilter("all");setPriorityFilter("all");}}>Reset filter</button></div>{renderEventTable(filteredEvents)}<div className="table-foot">Menampilkan {filteredEvents.length} event. Ekspor mengikuti filter yang aktif.</div></section>}
        {view==="calendar"&&<EventCalendar events={events} onEventClick={showEvent}/>}
        {view==="notifications"&&<div className="notification-workspace"><section className="surface notif-list-panel"><div className="notif-heading"><div><h3>Pengingat Event <span className="count-pill">{unread} belum dibaca</span></h3><p>Pengingat berjalan otomatis saat login, setiap menit, dan melalui jadwal Supabase Cron.</p></div><button className="btn btn-outline btn-sm" disabled={!unread} onClick={()=>void markAllRead()}><CheckCheck size={16}/>Tandai semua dibaca</button></div><div className="notif-list">{reminders.length?reminders.map(note=>{const event=events.find(e=>e.id===note.event_id);return <div key={note.id} className={`notif-item ${!note.read_at?"unread":""}`}><span className={`notif-icon notif-${note.kind}`}><BellRing size={19}/></span><div className="notif-body"><div className="notif-item-top"><b>{reminderKindText(note.kind)}</b><small>{formatDateTime(note.created_at)}</small></div><p>{event?`${event.title} • ${formatDateTime(event.start_at)}`:"Event telah dihapus."}</p>{event&&<button className="inline-link" onClick={()=>{void markRead(note);showEvent(event);}}>Lihat detail event <ArrowRight size={14}/></button>}</div>{!note.read_at&&<button className="mark-read" onClick={()=>void markRead(note)} title="Tandai dibaca" aria-label="Tandai notifikasi dibaca"><Check size={16}/></button>}</div>;}):<div className="empty-state"><Bell size={32}/><b>Belum ada pengingat</b><p>Pengingat untuk event yang akan berlangsung dalam tujuh hari akan muncul di sini.</p></div>}</div></section><aside className="surface notif-settings"><div className="settings-icon"><Settings2 size={22}/></div><h3>Pengingat otomatis aktif</h3><p>Notifikasi dalam dashboard langsung aktif untuk semua akun. Pengingat diperbarui setiap menit, saat login, dan melalui Supabase Cron jika sudah dijadwalkan.</p><span className="auto-reminder-status"><CheckCircle2 size={16}/> Aktif tanpa perlu tombol</span><div className="settings-separator"/><h4>Jadwal pengingat</h4><div className="reminder-rule"><span className="rule-number">7</span><span>7 hari sebelum event</span></div><div className="reminder-rule"><span className="rule-number">1</span><span>1 hari sebelum event</span></div><div className="reminder-rule"><span className="rule-number">0</span><span>Pada hari event</span></div><small>Pengingat tetap disimpan ketika aplikasi tertutup jika Cron aktif. Pop-up sistem hanya tampil bila izin browser telah diberikan sebelumnya; aplikasi tidak bisa mengaktifkan izin browser secara otomatis.</small></aside></div>}
        {view==="team"&&profile.role==="admin"&&<section className="surface team-panel"><SectionHeader title="Anggota Workspace" subtitle={`${profiles.length} akun memiliki akses ke data event`}/><div className="team-list"><div className="team-labels"><span>ANGGOTA</span><span>AKSES</span><span>PERAN</span></div>{profiles.map(user=><div className="team-row" key={user.id}><div className="team-identity"><Initials name={user.full_name}/><div><b>{user.full_name}{user.id===profile.id&&<em>Anda</em>}</b><small>{user.email}</small></div></div><span className="team-access"><ShieldCheck size={15}/> Semua event</span><div className="role-control"><select aria-label={`Peran ${user.full_name}`} value={user.role} disabled={user.id===profile.id||changingRole===user.id} onChange={e=>void changeRole(user,e.target.value as Role)}><option value="pic">PIC</option><option value="admin">Admin</option></select><ChevronDown size={15}/></div></div>)}</div><div className="team-foot"><ShieldCheck size={17}/><span>Semua pengguna dapat melihat seluruh data. PIC mengelola event yang menjadi tanggung jawabnya. Admin dapat mengelola semua event dan peran pengguna. Tambahkan akun melalui Supabase Authentication.</span></div></section>}
        </>}
      </main>
    </div>
    {toast&&<div className="toast" role="status"><CheckCircle2 size={18}/>{toast}<button onClick={()=>setToast("")} aria-label="Tutup pesan"><X size={15}/></button></div>}
    {modal&&<EventModal key={modal.event?.id||"new"} event={modal.event} profile={profile} profiles={profiles} onClose={()=>setModal(null)} onSaved={onSaved}/>}
    {detail&&<div className="detail-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null);}}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Detail event"><div className="drawer-top"><span className="overline">DETAIL EVENT</span><button className="icon-button" onClick={()=>setDetail(null)} aria-label="Tutup detail"><X size={22}/></button></div><div className={`drawer-icon icon-${detail.priority}`}><CalendarDays size={25}/></div><h2>{detail.title}</h2><div className="drawer-badges"><StatusBadge status={detail.status}/><PriorityBadge priority={detail.priority}/></div><p className="drawer-description">{detail.description||"Belum ada deskripsi event."}</p><div className="drawer-progress-head"><b>Progress Event</b><strong>{detail.progress}%</strong></div><div className="drawer-progress"><span style={{width:`${detail.progress}%`}}/></div><div className="drawer-section-title">INFORMASI EVENT</div><DrawerFact label="Kategori" value={detail.category}/><DrawerFact label="Lokasi" value={detail.location||"Belum ditentukan"}/><DrawerFact label="Mulai" value={formatDateTime(detail.start_at)}/><DrawerFact label="Selesai" value={formatDateTime(detail.end_at)}/><DrawerFact label="PIC" value={picNames[detail.assigned_pic]||"-"}/><DrawerFact label="Target peserta" value={new Intl.NumberFormat("id-ID").format(detail.participant_target)}/><DrawerFact label="Budget" value={formatCurrency(detail.budget)}/>{detail.notes&&<div className="drawer-notes"><b>Catatan internal</b><p>{detail.notes}</p></div>}<EventExtras eventId={detail.id}/><div className="drawer-footer">{canEdit(detail)&&<button className="btn btn-primary" onClick={()=>setModal({event:detail})}>Edit Event <ArrowRight size={17}/></button>}{profile.role==="admin"&&<button className="btn btn-danger" disabled={deleting} onClick={()=>void deleteEvent(detail)}><Trash2 size={17}/>Hapus</button>}</div></aside></div>}
  </div>;
}

function StatCard({icon:Icon,label,value,hint,kind}:{icon:typeof CalendarDays;label:string;value:number;hint:string;kind:string}){
  return <div className="stat-card"><div className="stat-top"><span className={`stat-icon stat-${kind}`}><Icon size={21}/></span><span className="stat-decoration"><TrendingUp size={16}/></span></div><div className="stat-number">{value}</div><strong>{label}</strong><small>{hint}</small></div>;
}
function SectionHeader({title,subtitle,action}:{title:string;subtitle:string;action?:React.ReactNode}){
  return <div className="section-header"><div><h3>{title}</h3><p>{subtitle}</p></div>{action}</div>;
}
function DrawerFact({label,value}:{label:string;value:string}){return <div className="drawer-fact"><span>{label}</span><strong>{value}</strong></div>;}
function reminderKindText(kind:Reminder["kind"]){return kind==="today"?"Event berlangsung hari ini":kind==="tomorrow"?"Event berlangsung besok":"Event dalam 7 hari ke depan";}
