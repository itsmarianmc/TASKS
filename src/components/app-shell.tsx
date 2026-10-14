"use client";

import { useState, useEffect, useEffectEvent, useSyncExternalStore } from "react";
import {
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useConfig,
  useGraph,
  useLocal,
  useLocalMutation,
  useRefresh,
} from "@/lib/queries";
import { emptyGraph } from "@/lib/public-config";
import type { EntityRef, Graph, InboxDraft, LocalSnapshot, Task } from "@/lib/types";
import { useTaskMutation } from "@/lib/task-queries";
import {
  calendarToday,
  tasksForView,
  taskSections,
  sectionTitle,
  viewTaskCount,
  viewTitle,
  type ViewId,
} from "@/lib/views";
import { Navigation } from "./navigation";
import { ThemeSync } from "./theme";
import {
  EmptyState,
  Modal,
  ConfirmDialog,
  moveListFocus,
} from "./primitives";
import { CommandPalette } from "./command-palette";
import { Capture } from "./capture";
import { TaskRow } from "./task-row";
import { TaskDetail } from "./task-detail";
import { EntityPanel } from "./entity-panel";
import { DisplayControls } from "./display-controls";
import { SettingsView } from "./settings";
import { useGitHub, useGitHubSection, useGitHubCachedItems } from "@/lib/github-queries";
import { githubActionable, type GitHubItem } from "@/lib/github-contracts";
import { GitHubView, GitHubInbox, GitHubDetail, GitHubRepositoryContext } from "./github";
import { useContact, useContactCachedItems } from "@/lib/contact-queries";
import { defaultContactOptions, type ContactItem } from "@/lib/contact-contracts";
import { ContactView, ContactInbox, ContactDetail } from "./contact";
import { OfflineBanner, useDeviceDrafts } from "./pwa";
import { mergeDeviceDrafts, putDeviceDraft } from "@/lib/device-drafts";
import { useOnline } from "@/lib/connectivity";
import { ReminderList } from "./reminders";
import { projectContext, projectView, projectResourceId, viewUrl, viewFromParams } from "@/lib/view-context";
import type { NotionGraphResponse } from "@/lib/notion-contracts";
import type { PublicConfig } from "@/lib/public-config";
import { StartupLoader } from "./startup-loader";
import { startupStatus, type StartupRead } from "@/lib/startup-status";

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function AppShell({ initialView, initialLocal, initialGraph, initialConfig }: { initialView?: string; initialLocal?: LocalSnapshot; initialGraph?: NotionGraphResponse; initialConfig?: PublicConfig } = {}) {
  const local = useLocal(initialLocal);
  const graphQuery = useGraph(initialGraph);
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const online = useOnline();
  const [restoredGraph] = useState(initialGraph ?? graphQuery.data);
  const deviceDrafts = useDeviceDrafts();
  const startupQueries = {
    github: useGitHub(),
    contact: useContact(),
    unreadContact: useContact({ ...defaultContactOptions, filter: "unread" }),
    config: useConfig(initialConfig),
  };
  const startupView = initialView ?? (local.data?.preferences.lastView === "inbox" ? "overview" : local.data?.preferences.lastView) ?? "overview";
  const context = projectContext(startupView);
  const mappedRepository = local.data?.integrations.find(value => value.projectId === context?.projectId)?.repository ?? "";
  const repositoryQueries = [
    useGitHubSection(mappedRepository, "issues"), useGitHubSection(mappedRepository, "pulls"),
    useGitHubSection(mappedRepository, "actions"), useGitHubSection(mappedRepository, "commits"),
  ];
  const needsRead = (query: { data: unknown; isPending: boolean }) => !query.data && query.isPending;
  const sourcePending =
    needsRead(startupQueries.config) ||
    (["inbox", "github", "settings"].includes(startupView) && needsRead(startupQueries.github)) ||
    (["contact", "settings"].includes(startupView) && needsRead(startupQueries.contact)) ||
    (["inbox", "settings"].includes(startupView) && needsRead(startupQueries.unreadContact)) ||
    (!!mappedRepository && repositoryQueries.some(needsRead));
  const readState = (query: { data: unknown; isPending: boolean; error: unknown }): "pending" | "error" | "ready" => needsRead(query) ? "pending" : query.error ? "error" : "ready";
  const diagnosticsFail = (data?: { diagnostics: { status: string }[] }) => data?.diagnostics.some(item => item.status === "error" || item.status === "unavailable");
  const githubReads = [...(["inbox", "github", "settings"].includes(startupView) ? [startupQueries.github] : []), ...repositoryQueries.filter(() => !!mappedRepository)];
  const contactReads = [startupQueries.contact, startupQueries.unreadContact].filter((_query, index) => index === 0 ? ["contact", "settings"].includes(startupView) : ["inbox", "settings"].includes(startupView));
  const sources: { name: "GitHub" | "Contact"; state: StartupRead }[] = [];
  if (["inbox", "github", "settings"].includes(startupView) || mappedRepository) sources.push({ name: "GitHub", state: githubReads.some(needsRead) ? "pending" : githubReads.some(query => query.error || diagnosticsFail(query.data)) ? "error" : startupQueries.github.data?.configured === false ? "disabled" : "ready" });
  if (contactReads.length) sources.push({ name: "Contact", state: contactReads.some(needsRead) ? "pending" : contactReads.some(query => query.error || diagnosticsFail(query.data)) ? "error" : "ready" });
  const savedGraph = !!graphQuery.data && (!!graphQuery.data.graph.syncedAt || [graphQuery.data.graph.tasks, graphQuery.data.graph.projects, graphQuery.data.graph.areas].some(values => values.length > 0));
  const savedLocalContent = (!!local.data && [local.data.notes, local.data.drafts, local.data.attachments, local.data.links].some(values => values.length > 0)) || deviceDrafts.some(entry => entry.operation === "save");
  const notionState: StartupRead = graphQuery.isFetching && !graphQuery.data ? "pending" : graphQuery.initialTaskCheck === "pending" ? "pending" :
    graphQuery.error || diagnosticsFail(graphQuery.data) ? "error" : graphQuery.savedData || !online ? "saved" :
    graphQuery.data?.diagnostics.some(item => item.source === "notion" && item.status === "disabled") ? "disabled" : "ready";
  // Release once. Later background refreshes must never hide or remount the shell.
  const [opened, setOpened] = useState(false);
  const ready = hydrated && !!local.data && graphQuery.initialTaskCheck !== "pending" && !needsRead(graphQuery) && !sourcePending;
  const status = startupStatus({ local: local.data ? "ready" : local.error && !local.isFetching ? "error" : "pending", notion: notionState,
    cachedGraph: !!restoredGraph?.graph.syncedAt, savedData: savedGraph || savedLocalContent, graph: graphQuery.data?.graph, config: readState(startupQueries.config), configRequired: !initialConfig, sources, view: startupView, prepared: ready });
  if (ready && !status.blocked && !opened) setOpened(true);
  const showWorkspace = !!local.data && (opened || (ready && !status.blocked));
  return <StartupLoader steps={status.steps} ready={showWorkspace} onRetry={status.blocked ? () => { void (status.blocked === "local" ? local.refetch() : graphQuery.refetch()); } : undefined}>
    {showWorkspace && local.data && <Workspace local={mergeDeviceDrafts(local.data, deviceDrafts)} deviceDrafts={deviceDrafts} initialView={initialView} graphQuery={graphQuery} startupQueries={startupQueries} />}
  </StartupLoader>;
}

type StartupQueries = {
  github: ReturnType<typeof useGitHub>;
  contact: ReturnType<typeof useContact>;
  unreadContact: ReturnType<typeof useContact>;
  config: ReturnType<typeof useConfig>;
};

function Workspace({ local, deviceDrafts, initialView, graphQuery, startupQueries }: { local: LocalSnapshot; deviceDrafts: ReturnType<typeof useDeviceDrafts>; initialView?: string; graphQuery: ReturnType<typeof useGraph>; startupQueries: StartupQueries }) {
  const online = useOnline();
  const { github, contact, unreadContact, config } = startupQueries;
  const [contactItem, setContactItem] = useState<ContactItem | null>(null);
  const [githubItem, setGithubItem] = useState<GitHubItem | null>(null);
  const [githubRepository, setGithubRepository] = useState("");
  const mutate = useLocalMutation();
  const refresh = useRefresh();
  const graph: Graph = graphQuery.data?.graph ?? emptyGraph;
  const timezone = config.data?.timezone ?? "Europe/Berlin";
  const today = calendarToday(timezone);
  const [requestedView, setView] = useState<ViewId>(
    initialView ??
      (local.preferences.lastView === "inbox"
        ? "overview"
        : local.preferences.lastView || "overview"),
  );
  const requestedContext = projectContext(requestedView);
  const requestedProject = graph.projects.find(project => project.id === requestedContext?.projectId);
  const view = requestedContext && !requestedContext.areaId && requestedProject?.areaIds.length === 1 ? projectView(requestedProject.id, requestedProject.areaIds[0]) : requestedView;
  const [transition, setTransition] = useState({ view, animate: false });
  if (transition.view !== view) setTransition({ view, animate: true });
  const [palette, setPalette] = useState(false);
  const [capture, setCapture] = useState(false);
  const [editingDraft, setEditingDraft] = useState<InboxDraft | undefined>();
  const [help, setHelp] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteDraft, setDeleteDraft] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [taskWarnings, setTaskWarnings] = useState<string[]>([]);
  const [localEntity, setLocalEntity] = useState<EntityRef | null>(null);
  const taskMutation = useTaskMutation();
  const completionEnabled = !graphQuery.error && (graphQuery.data?.completionEnabled ?? false);
  const selected = graph.tasks.find((task) => task.id === selectedId || task.clientKey === selectedId) ?? null;
  const title = viewTitle(view, graph, local);
  const tasks = tasksForView(view, graph, local, today);
  const sections = taskSections(view, graph, local, today);
  const context = projectContext(view);
  const project = context
    ? graph.projects.find((project) => project.id === context.projectId)
    : undefined;
  const area = view.startsWith("area:")
    ? graph.areas.find((area) => area.id === view.slice(5))
    : undefined;
  const mappedRepository = project ? local.integrations.find(value => value.projectId === project.id)?.repository : undefined;
  const activeRepository = view === "github" ? githubRepository : mappedRepository ?? "";
  useGitHubSection(activeRepository, "issues");
  useGitHubSection(activeRepository, "pulls");
  useGitHubSection(activeRepository, "actions");
  useGitHubSection(activeRepository, "commits");
  const githubCount = githubActionable(github.data).length;
  const contactCount = unreadContact.data?.unreadTotal ?? contact.data?.unreadTotal;
  const externalCount = githubCount + (contactCount ?? 0);
  const contactSearchItems = useContactCachedItems();
  const githubCache = useGitHubCachedItems();
  const githubSearchItems = githubCache.items;
  const parentArea = graph.areas.find(area => area.id === (context?.areaId ?? (project?.areaIds.length === 1 ? project.areaIds[0] : undefined)));
  const invalidContext = !!context?.areaId && !!project && !project.areaIds.includes(context.areaId);
  const entity = project
    ? { type: "project" as const, id: parentArea && project.areaIds.length > 1 ? projectResourceId(project.id, parentArea.id) : project.id }
    : area
      ? { type: "area" as const, id: area.id }
      : null;
  const notion = graphQuery.data?.diagnostics.find(
    (value) => value.source === "notion",
  );
  const unavailable =
    !!graphQuery.error ||
    notion?.status === "disabled" ||
    notion?.status === "error" ||
    notion?.status === "unavailable";
  function navigate(next: ViewId) {
    window.history.pushState(null, "", viewUrl(next));
    setView(next);
    setSelectedId(null);
    if (online) mutate.mutate({ action: "setPreferences", patch: { lastView: next } });
  }
  useEffect(() => {
    const onBack = () => {
      setView(viewFromParams(new URLSearchParams(window.location.search)) ?? "overview");
      setSelectedId(null);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  useEffect(() => { window.history.replaceState(null, "", viewUrl(view)); }, [view]);
  function toggleTheme() {
    mutate.mutate({
      action: "setPreferences",
      patch: { theme: local.preferences.theme === "dark" ? "light" : "dark" },
    });
  }
  async function refreshData() {
    setAnnouncement("Refreshing your workspace…");
    const results = await refresh();
    setAnnouncement(
      results.some((result) => result.status === "rejected")
        ? "Some sources could not be refreshed. Check diagnostics."
        : "Refresh complete.",
    );
  }
  async function toggleTask(task: Task) {
    if (!completionEnabled) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest(".task-row")?.getAttribute("data-task-id") === task.id) {
      const rows = [...document.querySelectorAll<HTMLButtonElement>(".task-list .task-content")].filter(row => row.getClientRects().length);
      const index = rows.findIndex(row => row.dataset.taskId === task.id), neighbour = rows[index + 1] ?? rows[index - 1];
      requestAnimationFrame(() => { if (!active.isConnected) neighbour?.focus(); });
    }
    setTaskWarnings([]);
    setAnnouncement(task.completed ? "Task reopened." : "Task completed.");
    try {
      const result = await taskMutation.mutateAsync({ kind: "patch", id: task.id, body: { completed: !task.completed } });
      if (result) setTaskWarnings(result.warnings);
    } catch { /* Global feedback survives the removed row. */ }
  }
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && !capture && !palette && view === "inbox") setContactItem(null);
    const target = event.target as HTMLElement;
    const typing = target.matches("input,textarea,select") || target.isContentEditable;
    const modalOpen = capture || palette || help || !!selectedId || !!deleteDraft || !!localEntity || !!githubItem || !!contactItem || !!target.closest('[role="dialog"]:not([data-state="closed"])');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && (!modalOpen || palette)) { event.preventDefault(); setPalette(value => !value); return; }
    if (typing || event.ctrlKey || event.metaKey || event.altKey || modalOpen) return;
    const key = event.key.toLowerCase();
    if (key === "n") { event.preventDefault(); setEditingDraft(undefined); setCapture(true); }
    if (key === "r") { event.preventDefault(); void refreshData(); }
    if (key === "?") { event.preventDefault(); setHelp(true); }
    const row = target.closest<HTMLElement>("[data-task-id]");
    const focused = graph.tasks.find(task => task.id === row?.dataset.taskId);
    if (focused && (key === "x" || key === " ")) { event.preventDefault(); void toggleTask(focused); }
    if (focused && key === "e") { event.preventDefault(); setSelectedId(focused.id); }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyboard(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const navigation = (
    <Navigation
      view={view}
      graph={graph}
      local={local}
      today={today}
      externalInboxCount={externalCount}
      githubCount={githubCount}
      contactCount={contactCount ?? undefined}
      onNavigate={navigate}
      onSearch={() => {
        setPalette(true);
      }}
      onCapture={() => {
        setCapture(true);
      }}
      onHelp={() => {
        setHelp(true);
      }}
      onToggleSidebar={() => mutate.mutate({ action: "setPreferences", patch: { sidebarCollapsed: !local.preferences.sidebarCollapsed } })}
    />
  );
  function renderTasks(items: Task[]) {
    return (
      <div className="task-list">
        {items.map((task) => (
          <TaskRow
            key={task.clientKey ?? task.id}
            task={task}
            onOpen={() => setSelectedId(task.id)}
            projectName={
              graph.projects.find((project) => project.id === task.projectId)
                ?.name
            }
            areaName={graph.areas.find((area) => area.id === task.areaId)?.name}
            metadata={local.metadata.find((value) => value.taskId === task.id)}
            attachmentCount={
              local.attachments.filter(
                (file) =>
                  file.entityType === "task" && file.entityId === task.id,
              ).length
            }
            tags={local.taskTags
              .filter((value) => value.taskId === task.id)
              .map(
                (value) =>
                  local.tags.find((tag) => tag.id === value.tagId)?.name,
              )
              .filter((value): value is string => !!value)}
            completionEnabled={completionEnabled}
            pending={false}
            showContext={!project}
            onComplete={() => void toggleTask(task)}
            today={today}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      className={`app-shell ${local.preferences.sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <ThemeSync theme={local.preferences.theme} />
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="desktop-sidebar" id="desktop-sidebar">{navigation}</aside>
      {!local.preferences.sidebarCollapsed && <button
        type="button"
        className="mobile-sidebar-dismiss"
        aria-label="Close sidebar"
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onPointerUp={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          mutate.mutate({ action: "setPreferences", patch: { sidebarCollapsed: true } });
        }}
      />}
      <div className="workspace">
        <header className="workspace-header">
          <div className="header-path">
            <span className="desktop-breadcrumb">
              workspace <ChevronRight size={12} />
            </span>
            {parentArea && (
              <button
                className="breadcrumb-button"
                onClick={() => navigate(`area:${parentArea.id}`)}
              >
                {parentArea.name}
                <ChevronRight size={12} />
              </button>
            )}
            <span className="header-current">
              {project ? "$ " : area ? "@ " : ""}
              {title}
            </span>
          </div>
          <div className="header-actions">
            <button
              className="icon-button header-search"
              aria-label="Search"
              title="Search"
              onClick={() => setPalette(true)}
            >
              <Search size={15} />
            </button>
            <button
              className={`icon-button ${graphQuery.isFetching ? "refreshing" : ""}`}
              aria-label="Refresh data"
              disabled={graphQuery.isFetching}
              onClick={() => void refreshData()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="button header-add" aria-label="New task"
              onClick={() => setCapture(true)}
            >
              <Plus size={13} />
              <span>New task</span>
              <kbd>N</kbd>
            </button>
          </div>
        </header>
        <main id="workspace" className={`view-${project ? "project" : area ? "area" : view}`} tabIndex={-1} onKeyDown={moveListFocus}>
          <OfflineBanner />
          <ReminderList graph={graph} local={local} onOpen={id => { if (graph.tasks.some(task => task.id === id)) setSelectedId(id); else setLocalEntity({ type: "task", id }); }} />
          <div className={`view-stage ${transition.animate ? "is-changing" : ""}`} key={view}>
          <div className="view-heading">
            <div>
              {!project && !area && !["settings", "github", "contact"].includes(view) && <p className="eyebrow">
                {new Intl.DateTimeFormat("en-GB", {
                            timeZone: timezone,
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })
                            .format(new Date())
                            .toUpperCase()}
              </p>}
              <h1>
                <span>{project && <span className="accent">$ </span>}{project && parentArea ? `${parentArea.name} / ` : ""}{title}</span>
                <span className="heading-count">
                  {view === "settings" ||
                  view === "github" ||
                  view === "contact"
                    ? ""
                    : viewTaskCount(view, graph, local, today) +
                      (view === "inbox" ? local.drafts.length + externalCount : 0)}
                </span>
              </h1>
              {project && (
                <p className="view-intro">
                  {[
                    project.status,
                    project.priority && `${project.priority} priority`,
                    project.dates.end && `deadline ${project.dates.end}`,
                    `${tasks.filter(task => task.completed).length}/${tasks.length} completed`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {area?.type && <p className="view-intro">{area.type}</p>}
            </div>
            {view !== "settings" && (
              <button
                className="text-button view-capture"
                onClick={() => setCapture(true)}
              >
                <Plus size={13} /> task
              </button>
            )}
          </div>
          
          
          {view === "overview" && <DisplayControls preferences={local.preferences} compact />}
          {taskWarnings.map((warning, index) => <p key={index} role="alert" className="error-text">{warning}</p>)}
          {view === "settings" ? (
            <SettingsView
              graph={graph}
              local={local}
              diagnostics={[...(graphQuery.data?.diagnostics ?? []), ...(github.data?.diagnostics ?? []), ...(unreadContact.data?.diagnostics ?? contact.data?.diagnostics ?? [])]}
              timezone={timezone}
            />
          ) : view === "github" ? (
            <GitHubView dashboard={github.data} error={github.error} local={local} selectedRepository={githubRepository} onRepository={setGithubRepository} onOpen={setGithubItem} />
          ) : view === "contact" ? (
            <ContactView local={local} graph={graph} timezone={timezone} onTask={id => { if (graph.tasks.some(task => task.id === id)) setSelectedId(id); else setLocalEntity({ type: "task", id }); }} />
          ) : (
            <>
              {graphQuery.isPending ? (
                <p className="loading-line" role="status">
                  {"// loading tasks"}
                  <span className="cursor">_</span>
                </p>
              ) : (
                <>
                  <div className={view === "inbox" ? "inbox-layout" : undefined}><div className="view-stream">
                  {view === "inbox" && github.data && <GitHubInbox dashboard={github.data} local={local} onOpen={setGithubItem} />}
                  {view === "inbox" && <ContactInbox data={unreadContact.data} onOpen={setContactItem} onAll={() => navigate("contact")} />}
                  {view === "inbox" && local.drafts.length > 0 && (
                    <section className="task-section">
                      <div className="section-heading">
                        <h2>
                          drafts <span>{local.drafts.length}</span>
                        </h2>
                      </div>
                      {local.drafts.map((draft) => (
                        <div key={draft.id} className="draft-row">
                          <span className="draft-dot">◇</span>
                          <div>
                            <strong>{draft.title || draft.input}</strong>
                            <p className="task-context">
                              {deviceDrafts.some(entry => entry.draft.id === draft.id) ? "waiting to sync" : "draft"} ·{" "}
                              {new Intl.DateTimeFormat("en-GB", {
                                day: "numeric",
                                month: "short",
                              }).format(new Date(draft.createdAt))}
                            </p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => { setEditingDraft(draft); setCapture(true); }}
                          >
                            Resolve
                          </button>
                          <button
                            className="text-button danger-text"
                            onClick={() => setDeleteDraft(draft.id)}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                  {area &&
                    graph.projects.filter((project) =>
                      project.areaIds.includes(area.id),
                    ).length > 0 && (
                      <section className="project-index">
                        <div className="section-heading">
                          <h2>projects</h2>
                        </div>
                        {graph.projects
                          .filter((project) =>
                            project.areaIds.includes(area.id),
                          )
                          .map((project) => (
                            <button
                              className="project-index-row"
                              key={project.id}
                              onClick={() => navigate(projectView(project.id, area.id))}
                            >
                              <span className="accent">$</span>
                              <span>{project.name}</span>
                              <span className="muted">{project.status}</span>
                              <span className="nav-count">
                                {
                                  viewTaskCount(projectView(project.id, area.id), graph, local, today)
                                }
                              </span>
                              <ChevronRight size={12} />
                            </button>
                          ))}
                      </section>
                    )}
                  {invalidContext && <p role="alert" className="error-text">This project does not belong to the selected area.</p>}
                  {project && !parentArea && project.areaIds.length > 1 && <section className="task-section"><h2>Choose an area</h2>{project.areaIds.map(id => <button className="project-index-row" key={id} onClick={() => navigate(projectView(project.id, id))}>{graph.areas.find(area => area.id === id)?.name ?? id} / {project.name} →</button>)}</section>}
                  {tasks.length > 0 && !(project && !parentArea && project.areaIds.length > 1) ? (
                    <>
                      {sections.map(section => section.collapsed ? (
                        <details className="task-section collapsed-section" key={section.label}>
                          <summary>{section.label} <span className="muted">{section.items.length}</span></summary>
                          {renderTasks(section.items)}
                        </details>
                      ) : (
                        <section key={section.label} className={`task-section ${section.label === "overdue" ? "overdue" : ""}`}>
                          <div className="section-heading"><h2>{sectionTitle(section.label)} <span>{section.items.length}</span></h2></div>
                          {renderTasks(section.items)}
                        </section>
                      ))}
                    </>
                  ) : (
                    !(view === "inbox" && (local.drafts.length || externalCount)) && (
                      project ? <section className="task-section compact-empty"><div className="section-heading"><h2>tasks <span>0</span></h2></div><p className="annotation muted">{"// nothing here."}</p></section> : <EmptyState
                        title={
                          unavailable
                            ? "// connect Notion in settings"
                            : view === "inbox"
                              ? "// you’re clear"
                              : "// nothing here"
                        }
                      >
                        {view === "someday" && <p>Ideas for another day will be waiting here.</p>}
                        <div className="inline-actions">
                          <button
                            className="button primary"
                            onClick={() => setCapture(true)}
                          >
                            <Plus size={13} /> task
                          </button>
                          {unavailable && (
                            <button
                              className="button"
                              onClick={() => navigate("settings")}
                            >
                              Connect Notion <ChevronRight size={13} />
                            </button>
                          )}
                        </div>
                        <p className="empty-hint">
                          <kbd>N</kbd> capture <span>·</span> <kbd>Ctrl K</kbd>{" "}
                          find anything
                        </p>
                      </EmptyState>
                    )
                  )}
                  {(project || area) && !invalidContext && <button className="text-button add-task-line" onClick={() => setCapture(true)}>[+ task]</button>}
                  {view === "overview" && githubCount > 0 && <button className="inbox-summary text-button purple" onClick={() => navigate("inbox")}>◇ inbox / GitHub {githubCount} waiting <ChevronRight size={12} /></button>}
                  {view === "overview" && (contactCount ?? 0) > 0 && <button className="inbox-summary text-button" onClick={() => navigate("inbox")}>◇ inbox / Contact {contactCount} unread <ChevronRight size={12} /></button>}
                  {view === "overview" && local.drafts.length > 0 && <button className="inbox-summary text-button" onClick={() => navigate("inbox")}>◇ inbox / {local.drafts.length} {local.drafts.length === 1 ? "draft" : "drafts"} <ChevronRight size={12} /></button>}
                  {unavailable && <div className="connection-notice" role="status">
                    <span className="notice-dot" />
                    <div><strong>{graphQuery.error && graphQuery.data ? "Notion refresh failed" : graphQuery.error || notion?.status === "error" || notion?.status === "unavailable" ? "Notion is unavailable" : "Notion / not connected"}</strong><p>{graph.syncedAt ? "Last synced tasks retained. Retry or check diagnostics." : "Retry or check diagnostics. Drafts are still available."}</p></div>
                    <button className="text-button" onClick={() => navigate("settings")}>Diagnostics <ChevronRight size={13} /></button>
                  </div>}
                  {entity && !invalidContext && !(project && !parentArea && project.areaIds.length > 1) && (
                    <EntityPanel
                      key={`${entity.type}:${entity.id}`}
                      entity={entity}
                      snapshot={local}
                    />
                  )}
                  {entity && project && entity.id !== project.id && [...local.notes, ...local.links, ...local.attachments].some(value => value.entityType === "project" && value.entityId === project.id) && <details className="shared-project-resources"><summary>shared / {project.name}</summary><EntityPanel entity={{ type: "project", id: project.id }} snapshot={local} /></details>}
                  {mappedRepository && <GitHubRepositoryContext key={mappedRepository} repository={mappedRepository} local={local} onOpen={setGithubItem} />}
                  </div>{view === "inbox" && <aside className="inbox-inspector">{contactItem ? <ContactDetail key={contactItem.id} item={contactItem} onClose={() => setContactItem(null)} onUpdated={setContactItem} graph={graph} local={local} timezone={timezone} onTask={setSelectedId} /> : <p className="muted annotation">{"// select a message"}</p>}</aside>}</div>
                </>
              )}
            </>
          )}
          </div>
        </main>
        <footer className="workspace-footer">
          <span>
            <span className={`status-dot ${unavailable ? "muted-dot" : ""}`} />
            {graph.syncedAt
              ? `synced ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(graph.syncedAt))}`
              : "ready"}
          </span>
          <span>
            {timezone} <span className="footer-divider">/</span> Æ
          </span>
        </footer>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        graph={graph}
        local={local}
        onNavigate={navigate}
        onCapture={() => setCapture(true)}
        onTask={(task) => setSelectedId(task.id)}
        onTheme={toggleTheme}
        onRefresh={() => void refreshData()}
        onDraft={id => { setEditingDraft(local.drafts.find(draft => draft.id === id)); setCapture(true); }}
        onLocalEntity={setLocalEntity}
        onContactOpen={setContactItem}
        githubSearchMessage={githubCache.message}
        externalItems={[...githubSearchItems.map(item => ({ id: item.id, label: `${item.repository}${item.number ? ` #${item.number}` : ""} · ${item.title}`, kind: "github" as const, keywords: `${item.kind} ${item.body} ${item.labels.join(" ")}`, onOpen: () => setGithubItem(item) })), ...githubCache.repositories.map(repo => ({ id: repo.id, label: repo.name, kind: "github" as const, keywords: repo.description, onOpen: () => { setGithubRepository(repo.name); navigate("github"); } })), ...contactSearchItems.map(item => ({ id: `contact:${item.id}`, label: `${item.name || item.email} · ${item.message.split(/\r?\n/)[0]}`, kind: "contact" as const, keywords: `${item.site_origin} ${item.email} ${item.message}`, onOpen: () => setContactItem(item) }))]}
      />
      {capture && (
        <Capture
          key={editingDraft?.id ?? "capture"}
          open
          onOpenChange={open => { setCapture(open); if (!open) setEditingDraft(undefined); }}
          graph={graph}
          view={view}
          draft={editingDraft}
          onCreated={result => setAnnouncement(`${result.existing ? "Linked" : "Created"}: ${result.task.title}`)}
          onSaved={state => {
            setAnnouncement(state === "queued" ? "Draft retained on this device / waiting for server acknowledgement." : "Draft saved to your local Inbox.");
            navigate("inbox");
          }}
        />
      )}
      <GitHubDetail key={githubItem?.id ?? "github-detail"} item={githubItem} onClose={() => setGithubItem(null)} graph={graph} local={local} timezone={timezone} onTask={id => { if (graph.tasks.some(task => task.id === id)) setSelectedId(id); else setLocalEntity({ type: "task", id }); }} />
      {contactItem && view !== "inbox" && <ContactDetail key={contactItem.id} modal item={contactItem} onClose={() => setContactItem(null)} onUpdated={setContactItem} graph={graph} local={local} timezone={timezone} onTask={id => { if (graph.tasks.some(task => task.id === id)) setSelectedId(id); else setLocalEntity({ type: "task", id }); }} />}
      <TaskDetail
        task={selected}
        graph={graph}
        local={local}
        onClose={() => setSelectedId(null)}
        completionEnabled={completionEnabled}
      />
      <Modal open={!!localEntity} onOpenChange={open => { if (!open) setLocalEntity(null); }} title="Local context" description="Unavailable in Notion. Saved notes, links and files are still here." className="inspector-dialog">
        {localEntity && <><p className="muted">{localEntity.type}:{localEntity.id}</p><EntityPanel key={`${localEntity.type}:${localEntity.id}`} entity={localEntity} snapshot={local} /></>}
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="Shortcuts"
      >
        <dl className="shortcut-list">
          <div>
            <dt>Search & commands</dt>
            <dd>
              <kbd>Ctrl / ⌘ K</kbd>
            </dd>
          </div>
          <div>
            <dt>New capture</dt>
            <dd>
              <kbd>N</kbd>
            </dd>
          </div>
          <div>
            <dt>Close a dialog</dt>
            <dd>
              <kbd>Esc</kbd>
            </dd>
          </div>
          <div>
            <dt>Navigate lists</dt>
            <dd>
              <kbd>↑ / K</kbd> <kbd>↓ / J</kbd>
            </dd>
          </div>
          <div><dt>Complete / reopen focused task</dt><dd><kbd>X / Space</kbd></dd></div>
          <div><dt>Edit focused task</dt><dd><kbd>E</kbd></dd></div>
          <div><dt>Refresh sources</dt><dd><kbd>R</kbd></dd></div>
          <div>
            <dt>Open focused item</dt>
            <dd>
              <kbd>Enter</kbd>
            </dd>
          </div>
          <div>
            <dt>Show shortcuts</dt>
            <dd>
              <kbd>?</kbd>
            </dd>
          </div>
        </dl>
      </Modal>
      <ConfirmDialog optimistic
        open={!!deleteDraft}
        onOpenChange={(open) => {
          if (!open) setDeleteDraft(null);
        }}
        title="Delete this draft?"
        description="This removes the draft. It cannot be undone."
        onConfirm={async () => {
          if (deleteDraft && deviceDrafts.some(entry => entry.draft.id === deleteDraft)) {
            const draft = local.drafts.find(draft => draft.id === deleteDraft);
            if (draft) putDeviceDraft(draft, "delete");
          } else if (deleteDraft)
            await mutate.mutateAsync({
              action: "deleteDraft",
              id: deleteDraft,
            });
        }}
      />
    </div>
  );
}



