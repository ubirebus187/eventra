export type Role = "admin" | "pic";
export type Priority = "high" | "mid" | "low";
export type EventStatus = "not_started" | "in_progress" | "completed";
export type View = "overview" | "events" | "calendar" | "notifications" | "team";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface EventItem {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  start_at: string;
  end_at: string;
  priority: Priority;
  progress: number;
  status: EventStatus;
  assigned_pic: string;
  created_by: string;
  participant_target: number;
  budget: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type ReminderKind = "upcoming" | "tomorrow" | "today";
export interface Reminder {
  id: string;
  user_id: string;
  event_id: string;
  kind: ReminderKind;
  read_at: string | null;
  created_at: string;
}

export interface EventFormValues {
  title: string;
  description: string;
  category: string;
  location: string;
  start_at: string;
  end_at: string;
  priority: Priority;
  progress: number;
  assigned_pic: string;
  participant_target: number;
  budget: number;
  notes: string;
}


export interface EventPhoto {
  id: string;
  event_id: string;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface RundownItem {
  id: string;
  event_id: string;
  start_at: string;
  end_at: string;
  activity: string;
  pic_name: string;
  notes: string;
  sort_order: number;
}

export type RundownDraft = Pick<RundownItem, "start_at" | "end_at" | "activity" | "pic_name" | "notes">;
