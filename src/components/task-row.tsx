"use client";
import type { Task, TaskMetadata } from "@/lib/types";
import { isOverdue } from "@/lib/views";
import { calendarToday } from "@/lib/calendar";

export function TaskRow({
  task,
  projectName,
  areaName,
  metadata,
  tags = [],
  attachmentCount = 0,
  selected,
  completionEnabled = false,
  pending = false,
  showContext = true,
  onOpen,
  onComplete,
  today = calendarToday(),
}: {
  task: Task;
  projectName?: string;
  areaName?: string;
  metadata?: TaskMetadata;
  tags?: string[];
  attachmentCount?: number;
  selected?: boolean;
  completionEnabled?: boolean;
  pending?: boolean;
  showContext?: boolean;
  onOpen: () => void;
  onComplete?: () => void;
  today?: string;
}) {
  const overdue = isOverdue(task, today);
  const lateness = overdue ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.dates.end}T12:00:00Z`)) / 86400000) : 0;
  const context = showContext ? [areaName && `@${areaName}`, projectName && `$${projectName}`].filter(Boolean).join("  ") : "";
  const hasDetails = context || task.dates.start || task.dates.end || metadata?.recurrenceRule || attachmentCount;
  return (
    <div
      data-task-id={task.id}
      data-sync-state={task.syncState}
      className={`task-row ${selected ? "selected" : ""} ${task.completed ? "completed" : ""} ${overdue ? "task-overdue" : ""}`}
    >
      <button
        className="task-check"
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        role="checkbox"
        aria-checked={task.completed}
        disabled={!completionEnabled || !onComplete || pending}
        title={
          !completionEnabled
            ? "Configure a Notion completion property in Settings."
            : undefined
        }
        onClick={onComplete}
      >
        {task.completed ? "[✓]" : "[ ]"}
      </button>
      <button className="task-content" data-list-row data-task-id={task.id} onClick={onOpen}>
        <span className="task-title">
          {task.highlight && <span className="highlight" aria-hidden="true" title="Highlighted" />}
          {metadata?.priority && metadata.priority !== "none" && <span className={`priority-${metadata.priority}`} title={`Priority: ${metadata.priority}`}>{metadata.priority === "urgent" ? "!!!" : metadata.priority === "high" ? "!!" : "!"}</span>}
          {task.title}
          {tags.map(tag => <span key={tag} className="tag">[{tag}]</span>)}
        </span>
      {!!hasDetails && <span className="task-meta">
        <span aria-hidden="true">{"//"}</span>
        {context && <span className="task-context">{context}</span>}
        {metadata?.recurrenceRule && <span title="Repeating">↻</span>}
        {attachmentCount > 0 && <span className="inline-icon" title="Attachments">↳ {attachmentCount}</span>}
        <span className="task-dates">
          {task.dates.end && <span aria-hidden="true">→</span>}
          {overdue && <span className="lateness" title={`${lateness} calendar days overdue`}>{lateness}d late · </span>}
          {task.dates.start &&
          task.dates.end &&
          task.dates.start !== task.dates.end
            ? `${shortDate(task.dates.start)} → `
            : ""}
          {task.dates.end
            ? shortDate(task.dates.end)
            : task.dates.start
              ? `${shortDate(task.dates.start)} →`
              : ""}
        </span>
      </span>}
      </button>
    </div>
  );
}
function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
