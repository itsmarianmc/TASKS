"use client";
import { useState, useEffect, useLayoutEffect, type CSSProperties } from "react";
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
  const commands: { label: string; type: string; action: () => void; keywords?: string }[] = [
    { label: "New task / capture", type: "command", action: onCapture },
    {
      label: "Settings & diagnostics",
      type: "command",
      action: () => onNavigate("settings"),
    },
    { label: "Toggle theme", type: "command", action: onTheme },
    { label: "Refresh data", type: "command", action: onRefresh },
    ...mainViews.map((view) => ({
      label: view.label,
      type: "navigation",
      keywords: `Go to ${view.label} list`,
      action: () => onNavigate(view.id),
    })),
    { label: "GitHub", type: "navigation", keywords: "source", action: () => onNavigate("github") },
    { label: "Contact", type: "navigation", keywords: "source", action: () => onNavigate("contact") },
    ...graph.areas.map((area) => ({
      label: area.name,
      type: "area",
      action: () => onNavigate(`area:${area.id}`),
    })),
    ...graph.projects.flatMap((project) => project.areaIds.map(areaId => ({
      label: `${graph.areas.find(area => area.id === areaId)?.name ?? "Area"} / ${project.name}`,
      type: "project",
      action: () => onNavigate(projectView(project.id, areaId)),
    }))),
    ...local.filters.map((filter) => ({
      label: filter.name,
      type: "filter",
      action: () => onNavigate(`filter:${filter.id}`),
    })),
    ...graph.tasks.map((task) => ({
      label: `${task.completed ? "[✓]" : "[ ]"} ${task.title}`,
      type: "task",
      action: () => onTask(task),
    })),
    ...local.drafts.map((draft) => ({
      label: draft.title || draft.input,
      type: "draft",
      action: () => onDraft ? onDraft(draft.id) : onNavigate("inbox"),
    })),
    ...local.tags.map(tag => ({ label: `[${tag.name}]`, type: "tag", action: () => onNavigate(`tag:${tag.id}`) })),
    ...local.notes.map(note => ({ label: `${ownerName(note.entityType, note.entityId) ?? `${note.entityType}:${note.entityId}`} / ${note.content.split("\n").find(line => line.trim())?.slice(0, 100) ?? "note"}`, keywords: note.content, type: "note", action: () => openOwner(note.entityType, note.entityId) })),
    ...local.attachments.map(file => ({ label: `${file.name} / ${ownerName(file.entityType, file.entityId) ?? `${file.entityType}:${file.entityId}`}`, keywords: `${file.mimeType} ${file.size}`, type: "file", action: () => openOwner(file.entityType, file.entityId) })),
    ...externalItems.map(item => ({ label: item.label, keywords: item.keywords, type: item.kind, action: item.onOpen })),
    ...(remoteContact.data?.items ?? []).filter(item => !externalItems.some(external => external.kind === "contact" && external.id === `contact:${item.id}`)).map(item => ({ label: `${item.name || item.email} · ${item.message.split(/\r?\n/)[0]}`, keywords: `${item.email} ${item.site_origin} ${item.message}`, type: "contact", action: () => onContactOpen?.(item) })),
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
      title="Find your next move"
      className="palette"
      style={viewport ? { "--palette-viewport-height": `${viewport.height}px`, "--palette-viewport-top": `${viewport.top}px` } as CSSProperties : undefined}
    >
      <div className="palette-search">
        <span className="palette-prompt" aria-hidden="true">&gt;</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="search or type a command…"
          aria-label="Search"
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
        <kbd>esc</kbd>
      </div>
      <div className="palette-results" onKeyDown={moveListFocus}>
        {githubSearchMessage && <p className="muted" role="status">{githubSearchMessage}</p>}
        {open && contactSearch.length >= 2 && remoteContact.isFetching && <p className="muted" role="status">{"// searching Contact"}</p>}
        <InlineError error={remoteContact.error} />
        {open && contactSearch.length >= 2 && remoteContact.data?.status === "error" && <p className="error-text" role="alert">{remoteContact.data.message}</p>}
        {open && contactSearch.length >= 2 && remoteContact.data?.hasMore && <p className="muted">More messages in Contact. Narrow your search.</p>}
        {results.length ? (
          [...new Set(results.map(result => result.type))].map(type => <section className="search-group" key={type}><h2>{type}</h2>{results.filter(result => result.type === type).map((command, index) => (
            <button
              key={`${command.type}:${command.label}:${index}`}
              data-list-row
              className="palette-result"
              onClick={() => {
                closePalette();
                command.action();
              }}
            >
              <span className="result-label">{command.label}</span>
              <span className="palette-open" aria-hidden="true">↗</span>
            </button>
          ))}</section>)
        ) : (
          <p className="palette-empty">{`// Nothing matches “${search}”.`}</p>
        )}
      </div>
      <div className="palette-footer">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>enter</kbd> open
        </span>
        <span>{results.length} results</span>
      </div>
    </Modal>
  );
}
