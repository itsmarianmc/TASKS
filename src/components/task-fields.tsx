"use client";
import { TerminalToggle } from "./terminal-toggle";
import type { Graph, Priority, RecurrenceRule } from "@/lib/types";
import { selectProject, type TaskFieldsValue } from "@/lib/task-editor";

export function TaskFields({ value, onChange, graph, disabled = false, local = true, core = true, localizedDates = false }: { value: TaskFieldsValue; onChange: (value: TaskFieldsValue) => void; graph: Graph; disabled?: boolean; local?: boolean; core?: boolean; localizedDates?: boolean }) {
  return <fieldset className="task-fields terminal-fields" disabled={disabled}>
    {core && <>
    <label className="terminal-property terminal-property-title"><span>title</span><input aria-label="Task title" value={value.title} maxLength={2000} onChange={event => onChange({ ...value, title: event.target.value })} /></label>
    <label className="terminal-property"><span>project</span><select aria-label="Task project" value={value.projectId ?? ""} onChange={event => onChange(selectProject(value, event.target.value, graph))}><option value="">$ choose project</option>{graph.projects.map(project => <option value={project.id} key={project.id}>{`$ ${project.name}`}</option>)}</select></label>
    <label className="terminal-property"><span>area</span><select aria-label="Task area" value={value.areaId ?? ""} onChange={event => onChange({ ...value, areaId: event.target.value || null })}><option value="">@ choose area</option>{graph.areas.map(area => <option value={area.id} key={area.id}>{`@ ${area.name}`}</option>)}</select></label>
    <label className="terminal-property"><span>start</span><span className={localizedDates ? "localized-date" : undefined}>{localizedDates && <span aria-hidden="true">{formatDate(value.dates.start)}</span>}<input aria-label="Task start" type="date" value={value.dates.start ?? ""} onChange={event => onChange({ ...value, dates: { ...value.dates, start: event.target.value || null } })} /></span></label>
    <label className="terminal-property"><span>deadline</span><span className={localizedDates ? "localized-date" : undefined}>{localizedDates && <span aria-hidden="true">{formatDate(value.dates.end)}</span>}<input aria-label="Task deadline" type="date" value={value.dates.end ?? ""} onChange={event => onChange({ ...value, dates: { ...value.dates, end: event.target.value || null } })} /></span></label>
    <div className="terminal-property"><span>highlight</span><TerminalToggle compact label="Highlight" checked={value.highlight} onChange={highlight => onChange({ ...value, highlight })} /></div>
    </>}
    {local && <>
      <label className="terminal-property"><span>priority</span><select aria-label="Task priority" value={value.priority} onChange={event => onChange({ ...value, priority: event.target.value as Priority })}>{["none", "low", "medium", "high", "urgent"].map(priority => <option key={priority}>{priority}</option>)}</select></label>
      <label className="terminal-property"><span>tags</span><input aria-label="Task tags" value={value.tagsText ?? value.tags.join(", ")} placeholder="[school] [focus]" onChange={event => onChange({ ...value, tagsText: event.target.value, tags: event.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })} /></label>
      <label className="terminal-property"><span>repeat</span><select aria-label="Repeat frequency" value={value.recurrenceRule?.frequency ?? ""} onChange={event => onChange({ ...value, recurrenceRule: event.target.value ? { frequency: event.target.value as RecurrenceRule["frequency"], interval: value.recurrenceRule?.interval ?? 1 } : null })}><option value="">none</option>{["day", "week", "month", "year"].map(frequency => <option key={frequency}>{frequency}</option>)}</select></label>
      {value.recurrenceRule && <label className="terminal-property"><span>every</span><input aria-label="Repeat interval" type="number" min={1} max={365} value={value.recurrenceRule.interval} onChange={event => onChange({ ...value, recurrenceRule: { ...value.recurrenceRule!, interval: Number(event.target.value) } })} /></label>}
    </>}
  </fieldset>;
}

function formatDate(date: string | null) { return date ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "—"; }
