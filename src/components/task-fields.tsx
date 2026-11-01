"use client";
import { useTranslation } from "./localization";
import { DateInput } from "./date-input";
import { isCalendarDate } from "@/lib/calendar";
import { TerminalToggle } from "./terminal-toggle";
import type { Graph, Priority, RecurrenceRule } from "@/lib/types";
import { selectProject, type TaskFieldsValue } from "@/lib/task-editor";

export function TaskFields({ value, onChange, graph, disabled = false, local = true, core = true, localizedDates = false }: { value: TaskFieldsValue; onChange: (value: TaskFieldsValue) => void; graph: Graph; disabled?: boolean; local?: boolean; core?: boolean; localizedDates?: boolean }) {
  const { t, text: tx, locale } = useTranslation();
  return <fieldset className="task-fields terminal-fields" disabled={disabled}>
    {core && <>
    <label className="terminal-property terminal-property-title"><span>{t("ui.title")}</span><input aria-label={t("ui.task_title")} value={value.title} maxLength={2000} onChange={event => onChange({ ...value, title: event.target.value })} /></label>
    <label className="terminal-property property-project"><span className="meta-chip meta-project">{t("ui.project")}</span><select aria-label={t("ui.task_project")} value={value.projectId ?? ""} onChange={event => onChange(selectProject(value, event.target.value, graph))}><option value="">{t("ui.choose_project_964f9af")}</option>{graph.projects.map(project => <option value={project.id} key={project.id}>{t("ui.value_62469d5", { p0: project.name })}</option>)}</select></label>
    <label className="terminal-property property-area"><span className="meta-chip meta-area">{t("ui.area_699e8ae")}</span><select aria-label={t("ui.task_area")} value={value.areaId ?? ""} onChange={event => onChange({ ...value, areaId: event.target.value || null })}><option value="">{t("ui.choose_area_ca32582")}</option>{graph.areas.map(area => <option value={area.id} key={area.id}>{t("ui.value_21031a7", { p0: area.name })}</option>)}</select></label>
    <label className="terminal-property property-start"><span className="meta-chip meta-start">{t("ui.start")}</span><span className={localizedDates ? "localized-date" : undefined}>{localizedDates && <span aria-hidden="true">{formatDate(value.dates.start, locale)}</span>}<DateInput label={t("ui.task_start")} value={value.dates.start} onChange={date => onChange({ ...value, dates: { ...value.dates, start: date } })} /></span></label>
    <label className="terminal-property property-end"><span className="meta-chip meta-end">{t("ui.deadline")}</span><span className={localizedDates ? "localized-date" : undefined}>{localizedDates && <span aria-hidden="true">{formatDate(value.dates.end, locale)}</span>}<DateInput label={t("ui.task_deadline")} value={value.dates.end} onChange={date => onChange({ ...value, dates: { ...value.dates, end: date } })} /></span></label>
    <div className="terminal-property"><span>{t("ui.highlight")}</span><TerminalToggle compact label={t("ui.highlight_e1da927")} checked={value.highlight} onChange={highlight => onChange({ ...value, highlight })} /></div>
    </>}
    {local && <>
      <label className="terminal-property"><span>{t("ui.priority")}</span><select aria-label={t("ui.task_priority")} value={value.priority} onChange={event => onChange({ ...value, priority: event.target.value as Priority })}>{["none", "low", "medium", "high", "urgent"].map(priority => <option value={priority} key={priority}>{tx(priority)}</option>)}</select></label>
      <label className="terminal-property"><span>{t("ui.tags")}</span><input aria-label={t("ui.task_tags")} value={value.tagsText ?? value.tags.join(", ")} placeholder={t("ui.school_focus")} onChange={event => onChange({ ...value, tagsText: event.target.value, tags: event.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })} /></label>
      <label className="terminal-property"><span>{t("ui.repeat")}</span><select aria-label={t("ui.repeat_frequency")} value={value.recurrenceRule?.frequency ?? ""} onChange={event => onChange({ ...value, recurrenceRule: event.target.value ? { frequency: event.target.value as RecurrenceRule["frequency"], interval: value.recurrenceRule?.interval ?? 1 } : null })}><option value="">{t("ui.none")}</option>{["day", "week", "month", "year"].map(frequency => <option value={frequency} key={frequency}>{tx(frequency)}</option>)}</select></label>
      {value.recurrenceRule && <label className="terminal-property"><span>{t("ui.every")}</span><input aria-label={t("ui.repeat_interval")} type="number" min={1} max={365} value={value.recurrenceRule.interval} onChange={event => onChange({ ...value, recurrenceRule: { ...value.recurrenceRule!, interval: Number(event.target.value) } })} /></label>}
    </>}
  </fieldset>;
}

function formatDate(date: string | null, locale: string) { return date && isCalendarDate(date) ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "—"; }
