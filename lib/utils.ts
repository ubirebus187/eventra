import type { EventFormValues, EventItem, EventStatus, Priority } from "@/lib/types";

export const STATUS_LABELS: Record<EventStatus, string> = {
  not_started: "Belum dimulai", in_progress: "Dalam proses", completed: "Selesai",
};
export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "High", mid: "Mid", low: "Low",
};
export const CATEGORIES = ["Seminar", "Workshop", "Konferensi", "Pelatihan", "Meeting", "Webinar", "Gathering", "Lainnya"];

export function eventStatus(progress: number): EventStatus {
  if (progress >= 100) return "completed";
  if (progress <= 0) return "not_started";
  return "in_progress";
}
export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("id-ID", options || { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}
export function formatDateTime(value: string) {
  return formatDate(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}
export function dateInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function defaultFormValues(picId: string): EventFormValues {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    title: "", description: "", category: "Seminar", location: "", start_at: dateInputValue(start.toISOString()),
    end_at: dateInputValue(end.toISOString()), priority: "mid", progress: 0,
    assigned_pic: picId, participant_target: 0, budget: 0, notes: "",
  };
}
export function formFromEvent(event: EventItem): EventFormValues {
  return {
    title: event.title, description: event.description || "", category: event.category,
    location: event.location || "", start_at: dateInputValue(event.start_at), end_at: dateInputValue(event.end_at),
    priority: event.priority, progress: event.progress, assigned_pic: event.assigned_pic,
    participant_target: event.participant_target, budget: event.budget, notes: event.notes || "",
  };
}
export function dateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function exportCsv(events: EventItem[], names: Record<string, string>) {
  // Excel-compatible UTF-8 CSV, with spreadsheet-formula injection prevention.
  const columns = ["Nama Event", "Kategori", "Lokasi", "Mulai", "Selesai", "Prioritas", "Status", "Progress (%)", "PIC", "Target Peserta", "Budget (IDR)", "Deskripsi", "Catatan"];
  const safeCell = (value: unknown) => {
    let s = String(value ?? "");
    if (/^[\s]*[=+@\-\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = events.map(e => [e.title, e.category, e.location, formatDateTime(e.start_at), formatDateTime(e.end_at),
    PRIORITY_LABELS[e.priority], STATUS_LABELS[e.status], e.progress, names[e.assigned_pic] || "-", e.participant_target,
    e.budget, e.description, e.notes].map(safeCell).join(","));
  const csv = "\uFEFF" + [columns.map(safeCell).join(","), ...rows].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `laporan-event-${dateKey(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
