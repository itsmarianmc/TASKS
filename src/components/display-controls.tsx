"use client";
import type { Preferences } from "@/lib/types";
import { useLocalMutation } from "@/lib/queries";
import { TerminalToggle } from "./terminal-toggle";

export function DisplayControls({ preferences, compact = false }: { preferences: Preferences; compact?: boolean }) {
  const mutation = useLocalMutation();
  return <div className={compact ? "display-controls" : "display-settings"}>
    <TerminalToggle compact={compact} label={compact ? "completed" : "Show completed tasks"} checked={preferences.showCompletedTasks !== false} onChange={showCompletedTasks => mutation.mutate({ action: "setPreferences", patch: { showCompletedTasks } })} />
    <TerminalToggle compact={compact} label={compact ? "active projects only" : "Hide projects without active tasks"} title="Hide projects with no open tasks" checked={!!preferences.hideProjectsWithoutCurrentTasks} onChange={hideProjectsWithoutCurrentTasks => mutation.mutate({ action: "setPreferences", patch: { hideProjectsWithoutCurrentTasks } })} />
  </div>;
}
