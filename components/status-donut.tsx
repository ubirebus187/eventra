"use client";
import type { EventItem, EventStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/utils";

const colors: Record<EventStatus, string> = { completed: "#4f54e8", in_progress: "#29b9a7", not_started: "#f4ac60" };
const order: EventStatus[] = ["completed", "in_progress", "not_started"];
export default function StatusDonut({ events }: { events: EventItem[] }) {
  const total = events.length;
  const counts = Object.fromEntries(order.map(k => [k, events.filter(e=>e.status===k).length])) as Record<EventStatus, number>;
  const slices = order.reduce((acc, status) => {
    const previous = acc.length ? acc[acc.length - 1].end : 0;
    const end = previous + (total ? counts[status] / total * 100 : 0);
    acc.push({ status, start: previous, end });
    return acc;
  }, [] as Array<{status: EventStatus;start:number;end:number}>);
  const gradient = total ? `conic-gradient(${slices.map(s=>`${colors[s.status]} ${s.start}% ${s.end}%`).join(", ")})` : "conic-gradient(#e9ecf6 0 100%)";
  const complete = total ? Math.round(counts.completed / total * 100) : 0;
  return <div className="donut-layout">
    <div className="donut-chart" style={{background:gradient}} role="img" aria-label={`Diagram status: ${counts.completed} selesai, ${counts.in_progress} dalam proses, ${counts.not_started} belum dimulai`}><div className="donut-hole"><strong>{complete}%</strong><span>selesai</span></div></div>
    <div className="donut-legend">{order.map(status=><div className="legend-line" key={status}><span className="legend-dot" style={{background:colors[status]}}/><span className="legend-title">{STATUS_LABELS[status]}</span><strong>{counts[status]}</strong><small>{total ? Math.round(counts[status]/total*100) : 0}%</small></div>)}</div>
  </div>;
}
