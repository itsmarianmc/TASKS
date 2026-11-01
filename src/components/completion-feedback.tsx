"use client";
import { useTranslation } from "./localization";
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { completionController, completionKey, emptyCompletions } from "@/lib/completion-queries";
import type { CompletionEntry } from "@/lib/completion";

export function CompletionFeedback() {
  const client = useQueryClient();
  const { data = emptyCompletions } = useQuery({ queryKey: completionKey, queryFn: () => emptyCompletions, enabled: false, initialData: emptyCompletions });
  return <div className="completion-toasts" aria-live="polite" aria-relevant="additions text">{data.map(entry => <CompletionToast key={entry.token} entry={entry} dismiss={() => completionController(client).dismiss(entry.token)} undo={() => { void completionController(client).undo(entry.token).catch(() => {}); }} />)}</div>;
}
function CompletionToast({ entry, dismiss, undo }: { entry: CompletionEntry; dismiss: () => void; undo: () => void }) {
  const { t } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (entry.state !== "confirmed" || entry.undoRequested) return;
    const timer = setInterval(() => { if (!element.current?.contains(document.activeElement)) dismiss(); }, 8000);
    return () => clearInterval(timer);
  }, [entry.state, entry.undoRequested, dismiss]);
  return <div ref={element} className="mutation-toast" data-completion-id={entry.id}>
    <span role="status">{entry.state === "undoing" ? t("ui.undoing_c0acebe") : entry.state === "pending" ? t("ui.saving_completion") : entry.before ? t("completion.reopened") : t("completion.completed")}</span>
    <button className="text-button" disabled={entry.undoRequested || entry.state === "undoing"} onClick={undo}>{t("common.undo")}</button>
  </div>;
}
