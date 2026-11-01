"use client";
import { useTranslation } from "./localization";
import type { Preferences } from "@/lib/types";
import { useLocalMutation } from "@/lib/queries";
import { TerminalToggle } from "./terminal-toggle";

export function DisplayControls({ preferences, compact = false }: { preferences: Preferences; compact?: boolean }) {
  const { t } = useTranslation();
  const mutation = useLocalMutation();
  return <div className={compact ? "display-controls" : "display-settings"}>
    <TerminalToggle compact={compact} label={compact ? t("ui.completed") : t("ui.show_completed_tasks")} checked={preferences.showCompletedTasks !== false} onChange={showCompletedTasks => mutation.mutate({ action: "setPreferences", patch: { showCompletedTasks } })} />
    <TerminalToggle compact={compact} label={compact ? t("ui.active_projects_only") : t("ui.hide_projects_without_active_tasks")} title={t("ui.hide_projects_with_no_open_tasks")} checked={!!preferences.hideProjectsWithoutCurrentTasks} onChange={hideProjectsWithoutCurrentTasks => mutation.mutate({ action: "setPreferences", patch: { hideProjectsWithoutCurrentTasks } })} />
  </div>;
}
