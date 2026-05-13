import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";

import { BottomMenu, MenuSection } from "../../../components/BottomMenu";
import { Switch } from "../../../components/Switch";
import { toast } from "../../../components/toast";
import { cn, radius, spacing, typography, interactive } from "../../../design-tokens";
import {
  deleteCompanionScheduledNote,
  listCompanionScheduledNotes,
  previewActiveCompanionScheduledNotes,
  saveCompanionScheduledNote,
} from "../../../../core/storage/repo";
import type {
  CompanionScheduledNote,
  CompanionScheduledNoteRecurrence,
} from "../../../../core/storage/schemas";

type DraftState = {
  id: string;
  label: string;
  content: string;
  availableAt: string;
  expiresAt: string;
  recurrence: CompanionScheduledNoteRecurrence;
  recurrenceWindowHours: string;
  enabled: boolean;
  createdAt: number;
};

const RECURRENCE_OPTIONS: Array<{ value: CompanionScheduledNoteRecurrence; label: string }> = [
  { value: "none", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const RECURRENCE_UNIT: Record<Exclude<CompanionScheduledNoteRecurrence, "none">, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTimeLocal(valueMs: number): string {
  const date = new Date(valueMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateTimeLocalToMs(value: string): number {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
}

function formatPreviewDate(valueMs: number, withTime = true): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: withTime ? "short" : undefined,
  }).format(new Date(valueMs));
}

function formatTime(valueMs: number): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(valueMs));
}

// Split a datetime-local string ("YYYY-MM-DDTHH:MM") into date and time parts.
function splitDateTime(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date = "", time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

function combineDateTime(date: string, time: string): string {
  if (!date && !time) return "";
  const safeDate = date || formatDateTimeLocal(Date.now()).split("T")[0]!;
  const safeTime = time || "09:00";
  return `${safeDate}T${safeTime}`;
}

function describeSchedule(draft: DraftState): string {
  const startsMs = dateTimeLocalToMs(draft.availableAt);
  const endsMs = draft.expiresAt ? dateTimeLocalToMs(draft.expiresAt) : null;
  const hours = Number(draft.recurrenceWindowHours);
  const validHours = Number.isFinite(hours) && hours > 0;

  if (draft.recurrence === "none") {
    const start = formatPreviewDate(startsMs);
    if (endsMs && endsMs > startsMs) {
      return `Visible from ${start} until ${formatPreviewDate(endsMs)}.`;
    }
    return `Visible from ${start} onward.`;
  }

  const unit = RECURRENCE_UNIT[draft.recurrence];
  const timeOfDay = formatTime(startsMs);
  const window = validHours ? `for ${hours}h each time` : `until the next ${unit}`;
  const startDate = formatPreviewDate(startsMs, false);
  const cap = endsMs && endsMs > startsMs ? ` Stops after ${formatPreviewDate(endsMs, false)}.` : "";

  if (draft.recurrence === "daily") {
    return `Every day at ${timeOfDay}, visible ${window}. Starts ${startDate}.${cap}`;
  }
  if (draft.recurrence === "weekly") {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
      new Date(startsMs),
    );
    return `Every ${weekday} at ${timeOfDay}, visible ${window}. Starts ${startDate}.${cap}`;
  }
  // monthly / yearly
  return `Repeats ${draft.recurrence} on ${formatPreviewDate(startsMs)}, visible ${window}.${cap}`;
}

function notePreview(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "(empty)";
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}...` : trimmed;
}

function defaultDraft(): DraftState {
  const now = Date.now();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${now}`,
    label: "",
    content: "",
    availableAt: formatDateTimeLocal(now),
    expiresAt: "",
    recurrence: "none",
    recurrenceWindowHours: "24",
    enabled: true,
    createdAt: now,
  };
}

function noteToDraft(note: CompanionScheduledNote): DraftState {
  return {
    id: note.id,
    label: note.label,
    content: note.content,
    availableAt: formatDateTimeLocal(note.availableAt),
    expiresAt: note.expiresAt ? formatDateTimeLocal(note.expiresAt) : "",
    recurrence: note.recurrence,
    recurrenceWindowHours: note.recurrenceWindowMs
      ? String(Math.round(note.recurrenceWindowMs / (60 * 60 * 1000)))
      : "",
    enabled: note.enabled,
    createdAt: note.createdAt,
  };
}

function draftToNote(characterId: string, draft: DraftState): CompanionScheduledNote {
  const availableAt = dateTimeLocalToMs(draft.availableAt);
  const expiresAt = draft.expiresAt ? dateTimeLocalToMs(draft.expiresAt) : null;
  const windowHours = Number(draft.recurrenceWindowHours);
  return {
    id: draft.id,
    characterId,
    label: draft.label.trim(),
    content: draft.content.trim(),
    availableAt,
    expiresAt,
    recurrence: draft.recurrence,
    recurrenceWindowMs:
      draft.recurrence !== "none" && Number.isFinite(windowHours) && windowHours > 0
        ? Math.round(windowHours * 60 * 60 * 1000)
        : null,
    enabled: draft.enabled,
    createdAt: draft.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

type Status = "active" | "scheduled" | "expired" | "inactive";

function statusFor(note: CompanionScheduledNote, isActive: boolean, previewMs: number): Status {
  if (note.expiresAt != null && previewMs >= note.expiresAt) return "expired";
  if (previewMs < note.availableAt) return "scheduled";
  return isActive ? "active" : "inactive";
}

const STATUS_PILL: Record<Status, string> = {
  active: "border-accent/40 bg-accent/15 text-accent",
  scheduled: "border-info/40 bg-info/15 text-info",
  expired: "border-fg/15 bg-fg/8 text-fg/55",
  inactive: "border-fg/15 bg-fg/8 text-fg/55",
};

const inputClass = cn(
  "min-w-0 w-full border bg-surface-el/40 px-3 py-2 text-fg outline-none placeholder:text-fg/35",
  typography.bodySmall.size,
  "border-fg/10",
  radius.md,
  interactive.transition.fast,
  "focus:border-fg/25 focus:bg-surface-el/60",
);

const labelClass = cn(
  typography.label.size,
  typography.label.weight,
  typography.label.tracking,
  "uppercase text-fg/55",
);

const accentButton = cn(
  "inline-flex items-center justify-center gap-1.5 border border-accent/30 bg-accent/15 px-3 py-2 font-semibold text-accent",
  typography.bodySmall.size,
  radius.md,
  interactive.transition.fast,
  interactive.active.scale,
  "hover:border-accent/45 hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50",
);

const ghostButton = cn(
  "inline-flex items-center justify-center gap-1.5 border border-fg/10 bg-fg/5 px-3 py-2 font-medium text-fg/70",
  typography.bodySmall.size,
  radius.md,
  interactive.transition.fast,
  "hover:border-fg/20 hover:text-fg disabled:opacity-50",
);

interface Props {
  characterId: string;
}

export function CompanionScheduledNotesEditor({ characterId }: Props) {
  const [notes, setNotes] = useState<CompanionScheduledNote[]>([]);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewAsOf, setPreviewAsOf] = useState(() => formatDateTimeLocal(Date.now()));
  const [showPreviewControl, setShowPreviewControl] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const previewMs = useMemo(() => dateTimeLocalToMs(previewAsOf), [previewAsOf]);
  const isPreviewingNow = useMemo(() => {
    return Math.abs(previewMs - Date.now()) < 60_000;
  }, [previewMs]);

  const refreshActive = useCallback(
    async (asOfMs: number) => {
      try {
        const active = await previewActiveCompanionScheduledNotes(characterId, asOfMs);
        setActiveIds(new Set(active.map((note) => note.id)));
      } catch (error) {
        console.error("Failed to preview active scheduled notes:", error);
      }
    },
    [characterId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [listed, active] = await Promise.all([
        listCompanionScheduledNotes(characterId),
        previewActiveCompanionScheduledNotes(characterId, dateTimeLocalToMs(previewAsOf)),
      ]);
      setNotes(listed);
      setActiveIds(new Set(active.map((note) => note.id)));
    } catch (error) {
      console.error("Failed to load companion scheduled notes:", error);
      toast.error("Failed to load scheduled notes");
    } finally {
      setLoading(false);
    }
    // refresh on first mount only; previewAsOf change handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (notes.length === 0) return;
    void refreshActive(previewMs);
  }, [notes.length, previewMs, refreshActive]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    try {
      setSaving(true);
      const saved = await saveCompanionScheduledNote(draftToNote(characterId, draft));
      setNotes((current) => {
        const next = current.filter((n) => n.id !== saved.id);
        next.push(saved);
        next.sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id));
        return next;
      });
      await refreshActive(previewMs);
      setDraft(null);
      toast.success("Scheduled note saved");
    } catch (error) {
      console.error("Failed to save companion scheduled note:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save scheduled note");
    } finally {
      setSaving(false);
    }
  }, [characterId, draft, previewMs, refreshActive]);

  const toggleEnabled = useCallback(
    async (note: CompanionScheduledNote, enabled: boolean) => {
      try {
        const saved = await saveCompanionScheduledNote({ ...note, enabled });
        setNotes((current) => current.map((n) => (n.id === saved.id ? saved : n)));
        await refreshActive(previewMs);
      } catch (error) {
        console.error("Failed to toggle scheduled note:", error);
        toast.error("Failed to update scheduled note");
      }
    },
    [previewMs, refreshActive],
  );

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteCompanionScheduledNote(id);
      setNotes((current) => current.filter((n) => n.id !== id));
      setActiveIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      toast.success("Scheduled note deleted");
    } catch (error) {
      console.error("Failed to delete companion scheduled note:", error);
      toast.error("Failed to delete scheduled note");
    }
  }, []);

  const draftIsNew = draft ? !notes.some((n) => n.id === draft.id) : false;

  const formSheet = (
    <BottomMenu
      isOpen={draft != null}
      onClose={() => {
        if (!saving) setDraft(null);
      }}
      title={draftIsNew ? "New scheduled note" : "Edit scheduled note"}
    >
      <MenuSection>
        {draft ? (
          <div className={spacing.group}>
            <div className={spacing.field}>
              <label className={labelClass}>Label (optional)</label>
              <input
                type="text"
                value={draft.label}
                onChange={(e) => setDraft((d) => (d ? { ...d, label: e.target.value } : d))}
                placeholder="Birthday"
                className={inputClass}
              />
            </div>

            <div className={spacing.field}>
              <label className={labelClass}>Content</label>
              <textarea
                value={draft.content}
                onChange={(e) => setDraft((d) => (d ? { ...d, content: e.target.value } : d))}
                rows={4}
                placeholder="Today is your birthday. You feel a little sentimental about it."
                className={cn(inputClass, "resize-none leading-relaxed")}
              />
              <p className={cn(typography.caption.size, "text-fg/45")}>
                This is the exact text the companion will read once the date arrives.
              </p>
            </div>

            <div className={spacing.field}>
              <label className={labelClass}>Repeats</label>
              <select
                value={draft.recurrence}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? { ...d, recurrence: e.target.value as CompanionScheduledNoteRecurrence }
                      : d,
                  )
                }
                className={inputClass}
              >
                {RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {(() => {
              const start = splitDateTime(draft.availableAt);
              const end = splitDateTime(draft.expiresAt);
              const setStart = (date: string, time: string) =>
                setDraft((d) =>
                  d ? { ...d, availableAt: combineDateTime(date, time) } : d,
                );
              const setEndDate = (date: string) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        expiresAt: date ? combineDateTime(date, end.time || "23:59") : "",
                      }
                    : d,
                );
              const setEnd = (date: string, time: string) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        expiresAt: date || time ? combineDateTime(date, time) : "",
                      }
                    : d,
                );

              if (draft.recurrence === "none") {
                return (
                  <div className="grid items-end gap-3 sm:grid-cols-2">
                    <div className={spacing.field}>
                      <label className={labelClass}>Show on</label>
                      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                        <input
                          type="date"
                          value={start.date}
                          onChange={(e) => setStart(e.target.value, start.time)}
                          className={inputClass}
                        />
                        <input
                          type="time"
                          value={start.time}
                          onChange={(e) => setStart(start.date, e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className={spacing.field}>
                      <label className={labelClass}>Hide on (optional)</label>
                      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                        <input
                          type="date"
                          value={end.date}
                          onChange={(e) => setEnd(e.target.value, end.time)}
                          className={inputClass}
                        />
                        <input
                          type="time"
                          value={end.time}
                          onChange={(e) => setEnd(end.date, e.target.value)}
                          disabled={!end.date}
                          className={cn(
                            inputClass,
                            "disabled:cursor-not-allowed disabled:opacity-40",
                          )}
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              if (draft.recurrence === "daily" || draft.recurrence === "weekly") {
                return (
                  <div className="grid items-end gap-3 sm:grid-cols-4">
                    <div className={spacing.field}>
                      <label className={labelClass}>Time of day</label>
                      <input
                        type="time"
                        value={start.time}
                        onChange={(e) => setStart(start.date, e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className={spacing.field}>
                      <label className={labelClass}>Starts on</label>
                      <input
                        type="date"
                        value={start.date}
                        onChange={(e) => setStart(e.target.value, start.time)}
                        className={inputClass}
                      />
                    </div>
                    <div className={spacing.field}>
                      <label className={labelClass}>Stops on (optional)</label>
                      <input
                        type="date"
                        value={end.date}
                        onChange={(e) => setEndDate(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className={spacing.field}>
                      <label className={labelClass}>Visible for (hours)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={draft.recurrenceWindowHours}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, recurrenceWindowHours: e.target.value } : d,
                          )
                        }
                        placeholder="24"
                        className={inputClass}
                      />
                    </div>
                  </div>
                );
              }

              // monthly / yearly
              return (
                <div className="grid items-end gap-3 sm:grid-cols-3">
                  <div className={spacing.field}>
                    <label className={labelClass}>First occurrence</label>
                    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                      <input
                        type="date"
                        value={start.date}
                        onChange={(e) => setStart(e.target.value, start.time)}
                        className={inputClass}
                      />
                      <input
                        type="time"
                        value={start.time}
                        onChange={(e) => setStart(start.date, e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className={spacing.field}>
                    <label className={labelClass}>Stops after (optional)</label>
                    <input
                      type="date"
                      value={end.date}
                      onChange={(e) => setEndDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className={spacing.field}>
                    <label className={labelClass}>Visible for (hours)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={draft.recurrenceWindowHours}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, recurrenceWindowHours: e.target.value } : d,
                        )
                      }
                      placeholder="24"
                      className={inputClass}
                    />
                  </div>
                </div>
              );
            })()}

            <div
              className={cn(
                "border border-fg/10 bg-fg/5 px-3 py-2",
                radius.md,
              )}
            >
              <p className={cn(typography.caption.size, "text-fg/65 leading-relaxed")}>
                {describeSchedule(draft)}
              </p>
            </div>

            <label
              className={cn(
                "flex items-center justify-between border border-fg/10 bg-fg/5 px-3 py-3",
                radius.md,
              )}
            >
              <span className="min-w-0">
                <span className={cn(typography.bodySmall.size, "block font-semibold text-fg")}>
                  Enabled
                </span>
                <span className={cn(typography.caption.size, "mt-1 block text-fg/50")}>
                  Turn off to keep the note saved without injecting it into prompts.
                </span>
              </span>
              <Switch
                checked={draft.enabled}
                onChange={(checked) => setDraft((d) => (d ? { ...d, enabled: checked } : d))}
              />
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className={ghostButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !draft.content.trim()}
                className={accentButton}
              >
                {saving ? "Saving..." : draftIsNew ? "Add note" : "Save"}
              </button>
            </div>
          </div>
        ) : null}
      </MenuSection>
    </BottomMenu>
  );

  // ----- Empty state -----
  if (!loading && notes.length === 0) {
    return (
      <>
        <div
          className={cn(
            "flex flex-col items-center gap-3 border border-dashed border-fg/15 px-6 py-10 text-center",
            radius.md,
          )}
        >
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center border border-fg/10 bg-fg/5 text-fg/55",
              radius.full,
            )}
          >
            <CalendarClock className="h-5 w-5" />
          </div>
          <div className="max-w-sm">
            <p className={cn(typography.body.size, "font-semibold text-fg")}>
              No scheduled notes yet
            </p>
            <p className={cn(typography.bodySmall.size, "mt-1 text-fg/55")}>
              Schedule a birthday, anniversary, or seasonal beat. The companion only sees the note
              once its date arrives.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDraft(defaultDraft())}
            className={cn(accentButton, "mt-1")}
          >
            <Plus className="h-3.5 w-3.5" />
            Add a note
          </button>
        </div>
        {formSheet}
      </>
    );
  }

  // ----- List view -----
  return (
    <>
    <div className={cn(spacing.group, "pb-20")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowPreviewControl((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 border border-fg/10 bg-fg/5 px-2.5 py-1.5 font-medium text-fg/70",
            typography.caption.size,
            radius.md,
            interactive.transition.fast,
            "hover:border-fg/20 hover:text-fg",
            showPreviewControl && "border-fg/25 text-fg",
          )}
          title={isPreviewingNow ? "Showing what the companion sees now" : "Previewing a future date"}
        >
          {showPreviewControl ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {isPreviewingNow ? "Active now" : `As of ${formatPreviewDate(previewMs, false)}`}
        </button>
        <button
          type="button"
          onClick={() => setDraft(defaultDraft())}
          className={accentButton}
        >
          <Plus className="h-3.5 w-3.5" />
          Add note
        </button>
      </div>

      {showPreviewControl ? (
        <div className={cn("border border-fg/10 bg-fg/5 p-3", radius.md)}>
          {(() => {
            const preview = splitDateTime(previewAsOf);
            const setPreview = (date: string, time: string) =>
              setPreviewAsOf(combineDateTime(date, time));
            return (
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
                <input
                  type="date"
                  value={preview.date}
                  onChange={(e) => setPreview(e.target.value, preview.time)}
                  className={inputClass}
                />
                <input
                  type="time"
                  value={preview.time}
                  onChange={(e) => setPreview(preview.date, e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setPreviewAsOf(formatDateTimeLocal(Date.now()))}
                  className={ghostButton}
                >
                  Now
                </button>
              </div>
            );
          })()}
          <p className={cn(typography.caption.size, "mt-2 text-fg/50")}>
            Pick a date to see which notes would be active. Does not affect the actual prompt.
          </p>
        </div>
      ) : null}

      <div className={spacing.item}>
        {loading ? (
          <div
            className={cn(
              "border border-dashed border-fg/10 px-4 py-6 text-center text-fg/55",
              typography.bodySmall.size,
              radius.md,
            )}
          >
            Loading scheduled notes...
          </div>
        ) : (
          notes.map((note) => {
            const status = statusFor(note, activeIds.has(note.id), previewMs);
            return (
              <div
                key={note.id}
                className={cn(
                  "border border-fg/10 bg-surface-el/40 p-4 transition-colors duration-200 hover:border-fg/20",
                  radius.md,
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-h-[1.5rem] items-center gap-2 overflow-hidden">
                      <p
                        className={cn(
                          typography.body.size,
                          "min-w-0 truncate font-semibold text-fg",
                        )}
                      >
                        {note.label.trim() || "Untitled note"}
                      </p>
                      <span
                        className={cn(
                          "shrink-0 border px-2 py-0.5 uppercase tracking-[0.14em]",
                          typography.overline.size,
                          radius.full,
                          STATUS_PILL[status],
                          !note.enabled && "opacity-50",
                        )}
                      >
                        {!note.enabled ? "off" : status}
                      </span>
                    </div>
                    <p className={cn(typography.bodySmall.size, "mt-2 text-fg/75")}>
                      {notePreview(note.content)}
                    </p>
                    <div
                      className={cn(
                        "mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-fg/50",
                        typography.caption.size,
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        Starts {formatPreviewDate(note.availableAt)}
                      </span>
                      <span>
                        {RECURRENCE_OPTIONS.find((o) => o.value === note.recurrence)?.label}
                      </span>
                      {note.recurrence !== "none" && note.recurrenceWindowMs ? (
                        <span>
                          Window {Math.round(note.recurrenceWindowMs / (60 * 60 * 1000))}h
                        </span>
                      ) : null}
                      {note.expiresAt ? (
                        <span>Ends {formatPreviewDate(note.expiresAt)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={note.enabled}
                      onChange={(checked) => void toggleEnabled(note, checked)}
                    />
                    <button
                      type="button"
                      onClick={() => setDraft(noteToDraft(note))}
                      className={cn(
                        "border border-fg/10 p-2 text-fg/65",
                        radius.md,
                        interactive.transition.fast,
                        "hover:border-fg/25 hover:bg-fg/5 hover:text-fg",
                      )}
                      aria-label="Edit scheduled note"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(note.id)}
                      className={cn(
                        "border border-danger/25 p-2 text-danger",
                        radius.md,
                        interactive.transition.fast,
                        "hover:bg-danger/10",
                      )}
                      aria-label="Delete scheduled note"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
    {formSheet}
    </>
  );
}
