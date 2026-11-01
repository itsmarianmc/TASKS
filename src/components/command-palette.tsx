"use client";
import { useTranslation } from "./localization";
import { useState, useEffect, useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import { projectView } from "@/lib/view-context";
import type { EntityRef, Graph, LocalSnapshot, Task } from "@/lib/types";
import { mainViews, type ViewId } from "@/lib/views";
import { InlineError, Modal, moveListFocus } from "./primitives";
import { useContact } from "@/lib/contact-queries";
import { defaultContactOptions, type ContactItem } from "@/lib/contact-contracts";

/** Adapters supply safe client search text and a callback opening their actual source item. */
export interface ExternalSearchItem { id: string; label: string; kind: "github" | "contact"; keywords?: string; onOpen: () => void }

export function CommandPalette({
  open,
  onOpenChange,
  graph,
  local,
  onNavigate,
  onCapture,
  onTask,
  onTheme,
  onRefresh,
  externalItems = [],
  githubSearchMessage,
  onDraft,
  onLocalEntity,
  onContactOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: Graph;
  local: LocalSnapshot;
  onNavigate: (view: ViewId) => void;
  onCapture: () => void;
  onTask: (task: Task) => void;
  onTheme: () => void;
  onRefresh: () => void;
  externalItems?: ExternalSearchItem[];
  githubSearchMessage?: string;
  onDraft?: (id: string) => void;
  onLocalEntity?: (entity: EntityRef) => void;
  onContactOpen?: (item: ContactItem) => void;
}) {
  const { t, text: tx } = useTranslation();
  const [search, setSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !window.visualViewport) return;
    const visual = window.visualViewport;
    const measure = () => setViewport({ height: visual.height, top: visual.offsetTop });
    measure();
    visual.addEventListener("resize", measure);
    visual.addEventListener("scroll", measure);
    return () => { visual.removeEventListener("resize", measure); visual.removeEventListener("scroll", measure); };
  }, [open]);
  function closePalette() { setSearch(""); setContactSearch(""); onOpenChange(false); }
  useEffect(() => { const timer = setTimeout(() => setContactSearch(open ? search.trim().slice(0, 200) : ""), 250); return () => clearTimeout(timer); }, [search, open]);
  const remoteContact = useContact({ ...defaultContactOptions, search: contactSearch }, open && contactSearch.length >= 2 && !!onContactOpen);
  function openOwner(type: EntityRef["type"], id: string) {
    if (!ownerName(type, id)) { onLocalEntity?.({ type, id }); return; }
    if (type === "task") { const task = graph.tasks.find(task => task.id === id); if (task) onTask(task); }
    else onNavigate(`${type}:${id}`);
  }
  function ownerName(type: EntityRef["type"], id: string) { return type === "task" ? graph.tasks.find(task => task.id === id)?.title : type === "project" ? graph.projects.find(project => project.id === id)?.name : graph.areas.find(area => area.id === id)?.name; }
  const commands: { label: string; display?: ReactNode; type: string; action: () => void; keywords?: string }[] = [
    { label: t("ui.new_task_capture"), type: "command", action: onCapture },
    {
      label: t("ui.settings_diagnostics"),
      type: "command",
      action: () => onNavigate("settings"),
    },
    { label: t("ui.toggle_theme"), type: "command", action: onTheme },
    { label: t("ui.refresh_data"), type: "command", action: onRefresh },
    ...mainViews.map((view) => ({
      label: tx(view.label),
      type: "navigation",
      keywords: `Go to ${view.label} list`,
      action: () => onNavigate(view.id),
    })),
    { label: t("ui.github_5442e2b"), type: "navigation", keywords: "source", action: () => onNavigate("github") },
    { label: t("ui.contact_b37456c"), type: "navigation", keywords: "source", action: () => onNavigate("contact") },
    ...graph.areas.map((area) => ({
      label: area.name,
      display: <span className="meta-chip meta-area">{area.name}</span>,
      type: "area",
      action: () => onNavigate(`area:${area.id}`),
    })),
    ...graph.projects.flatMap((project) => project.areaIds.map(areaId => ({
      label: t("ui.value_value_bd8565b", { p0: graph.areas.find(area => area.id === areaId)?.name ?? t("ui.area_2745deb"), p1: project.name }),
      display: <><span className="meta-chip meta-area">{graph.areas.find(area => area.id === areaId)?.name ?? t("ui.area_2745deb")}</span>{" / "}<span className="meta-chip meta-project">{project.name}</span></>,
      type: "project",
      action: () => onNavigate(projectView(project.id, areaId)),
    }))),
    ...local.filters.map((filter) => ({
      label: filter.name,
      type: "filter",
      action: () => onNavigate(`filter:${filter.id}`),
    })),
    ...graph.tasks.map((task) => ({
      label: t("ui.value_value_99ecfde", { p0: task.completed ? "[✓]" : "[ ]", p1: task.title }),
      type: "task",
      action: () => onTask(task),
    })),
    ...local.drafts.map((draft) => ({
      label: draft.title || draft.input,
      type: "draft",
      action: () => onDraft ? onDraft(draft.id) : onNavigate("inbox"),
    })),
    ...local.tags.map(tag => ({ label: t("ui.value_45e9314", { p0: tag.name }), type: "tag", action: () => onNavigate(`tag:${tag.id}`) })),
    ...local.notes.map(note => ({ label: t("ui.value_value_bd8565b", { p0: ownerName(note.entityType, note.entityId) ?? t("ui.value_value", { p0: note.entityType, p1: note.entityId }), p1: note.content.split("\n").find(line => line.trim())?.slice(0, 100) ?? t("ui.note") }), keywords: note.content, type: "note", action: () => openOwner(note.entityType, note.entityId) })),
    ...local.attachments.map(file => ({ label: t("ui.value_value_bd8565b", { p0: file.name, p1: ownerName(file.entityType, file.entityId) ?? t("ui.value_value", { p0: file.entityType, p1: file.entityId }) }), keywords: `${file.mimeType} ${file.size}`, type: "file", action: () => openOwner(file.entityType, file.entityId) })),
    ...externalItems.map(item => ({ label: item.label, keywords: item.keywords, type: item.kind, action: item.onOpen })),
    ...(remoteContact.data?.items ?? []).filter(item => !externalItems.some(external => external.kind === "contact" && external.id === `contact:${item.id}`)).map(item => ({ label: t("ui.value_value_9482534", { p0: item.name || item.email, p1: item.message.split(/\r?\n/)[0] }), keywords: `${item.email} ${item.site_origin} ${item.message}`, type: "contact", action: () => onContactOpen?.(item) })),
  ];
  const results = commands
    .filter((command) =>
      `${command.label} ${command.type} ${command.keywords ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase().trim()),
    )
    .sort((a, b) => Number(b.label.toLocaleLowerCase() === search.toLocaleLowerCase().trim()) - Number(a.label.toLocaleLowerCase() === search.toLocaleLowerCase().trim()))
    .slice(0, 60);
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        setSearch("");
        onOpenChange(value);
      }}
      title={t("ui.find_your_next_move")}
      className="palette"
      style={viewport ? { "--palette-viewport-height": `${viewport.height}px`, "--palette-viewport-top": `${viewport.top}px` } as CSSProperties : undefined}
    >
      <div className="palette-search">
        <span className="palette-prompt" aria-hidden="true">{t("ui.gt")}</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("ui.search_or_type_a_command")}
          aria-label={t("ui.search")}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.currentTarget
                .closest(".dialog")
                ?.querySelector<HTMLButtonElement>("[data-list-row]")
                ?.focus();
            }
            if (event.key === "Enter" && results[0]) {
              closePalette();
              results[0].action();
            }
          }}
        />
        <kbd>{t("ui.esc_abb761d")}</kbd>
      </div>
      <div className="palette-results" onKeyDown={moveListFocus}>
        {githubSearchMessage && <p className="muted" role="status">{tx(githubSearchMessage)}</p>}
        {open && contactSearch.length >= 2 && remoteContact.isFetching && <p className="muted" role="status">{t("ui.searching_contact")}</p>}
        <InlineError error={remoteContact.error} />
        {open && contactSearch.length >= 2 && remoteContact.data?.status === "error" && <p className="error-text" role="alert">{tx(remoteContact.data.message)}</p>}
        {open && contactSearch.length >= 2 && remoteContact.data?.hasMore && <p className="muted">{t("ui.more_messages_in_contact_narrow_your_search")}</p>}
        {results.length ? (
          [...new Set(results.map(result => result.type))].map(type => <section className="search-group" key={type}><h2>{tx(type)}</h2>{results.filter(result => result.type === type).map((command, index) => (
            <button
              key={`${command.type}:${command.label}:${index}`}
              data-list-row
              className="palette-result"
              onClick={() => {
                closePalette();
                command.action();
              }}
            >
              <span className="result-label">{command.display ?? command.label}</span>
              <span className="palette-open" aria-hidden="true">↗</span>
            </button>
          ))}</section>)
        ) : (
          <p className="palette-empty">{t("ui.nothing_matches_value", { p0: search })}</p>
        )}
      </div>
      <div className="palette-footer">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> {" "}{t("ui.navigate")}</span>
        <span>
          <kbd>{t("ui.enter_3674951")}</kbd> {" "}{t("ui.open")}</span>
        <span>{results.length} {" "}{t("ui.results")}</span>
      </div>
    </Modal>
  );
}
