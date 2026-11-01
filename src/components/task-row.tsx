"use client";
import { useTranslation } from "./localization";
import type { Task, TaskMetadata } from "@/lib/types";
import { isOverdue } from "@/lib/views";
import { calendarToday } from "@/lib/calendar";
import { DateChips } from "./date-chips";

export function TaskRow({
  animateArrival = false,
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
  animateArrival?: boolean;
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
  const { t, text: tx } = useTranslation();
  const overdue = isOverdue(task, today);
  const lateness = overdue ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.dates.end}T12:00:00Z`)) / 86400000) : 0;
  const context = showContext && (areaName || projectName);
  const hasDetails = context || task.dates.start || task.dates.end || metadata?.recurrenceRule || attachmentCount;
  return (
    <div
      data-task-id={task.id}
      data-sync-state={task.syncState}
      className={`task-row${animateArrival ? " task-arrival" : ""} ${selected ? "selected" : ""} ${task.completed ? "completed" : ""} ${overdue ? "task-overdue" : ""}`}
    >
      <button
        className="task-check"
        aria-label={t("ui.value_value_99ecfde", { p0: task.completed ? t("ui.reopen_61e05da") : t("ui.complete_1f5a1ab"), p1: task.title })}
        role="checkbox"
        aria-checked={task.completed}
        disabled={!completionEnabled || !onComplete || pending}
        title={
          !completionEnabled ? t("ui.configure_a_notion_completion_property_in_settings") : undefined
        }
        onClick={onComplete}
      >
        {task.completed ? "[✓]" : "[ ]"}
      </button>
      <button className="task-content" data-list-row data-task-id={task.id} onClick={onOpen}>
        <span className="task-title">
          {task.highlight && <span className="highlight" aria-hidden="true" title={t("ui.highlighted")} />}
          {metadata?.priority && metadata.priority !== "none" && <span className={`priority-${metadata.priority}`} title={t("ui.priority_value_4473437", { p0: tx(metadata.priority) })}>{metadata.priority === "urgent" ? "!!!" : metadata.priority === "high" ? "!!" : "!"}</span>}
          {task.title}
          {tags.map(tag => <span key={tag} className="tag">[{tag}]</span>)}
        </span>
      {!!hasDetails && <span className="task-meta">
        <span aria-hidden="true">{"//"}</span>
        {context && <span className="task-context">{areaName && <span className="meta-chip meta-area">@{areaName}</span>}{" "}{projectName && <span className="meta-chip meta-project">${projectName}</span>}</span>}
        {metadata?.recurrenceRule && <span title={t("ui.repeating")}>↻</span>}
        {attachmentCount > 0 && <span className="inline-icon" title={t("ui.attachments")}>↳ {attachmentCount}</span>}
        <span className="task-dates">
          {overdue && <span className="lateness" title={t("ui.value_calendar_days_overdue", { p0: lateness })}>{lateness}{t("ui.d_late")}{" "}</span>}
          <DateChips start={task.dates.start} end={task.dates.end} />
        </span>
      </span>}
      </button>
    </div>
  );
}
