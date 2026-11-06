"use client";
import { useTranslation } from "./localization";

import { useState, useEffect, useEffectEvent, useSyncExternalStore, useRef } from "react";
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
import { useCompletion } from "@/lib/completion-queries";
import { refreshArrivals } from "@/lib/refresh-arrivals";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, type GraphResponse } from "@/lib/queries";
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
import { DateChips } from "./date-chips";
import { startupStatus, type StartupRead } from "@/lib/startup-status";

const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function AppShell({ initialView, initialLocal, initialGraph, initialConfig }: { initialView?: string; initialLocal?: LocalSnapshot; initialGraph?: NotionGraphResponse; initialConfig?: PublicConfig } = {}) {
  const local = useLocal(initialLocal);
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const localReady = !!local.data && (local.isFetchedAfterMount || !!initialLocal);
  const graphQuery = useGraph(initialGraph, localReady);
  const notionSettled = localReady && graphQuery.initialTaskCheck !== "pending";
  const config = useConfig(initialConfig, notionSettled);
  const configSettled = notionSettled && (!!config.data || config.isError);
  const [opened, setOpened] = useState(false);
  const online = useOnline();
  const [restoredGraph] = useState(initialGraph ?? graphQuery.data);
  const deviceDrafts = useDeviceDrafts();
  const startupView = initialView ?? (local.data?.preferences.lastView === "inbox" ? "overview" : local.data?.preferences.lastView) ?? "overview";
  const context = projectContext(startupView);
  const mappedRepository = local.data?.integrations.find(value => value.projectId === context?.projectId)?.repository ?? "";
  const dashboardRequired = ["inbox", "github", "settings"].includes(startupView);
  const startupQueries = {
    github: useGitHub(1, configSettled && dashboardRequired || opened),
    config,
  };
  const repositoryQueries = [
    useGitHubSection(mappedRepository, "issues", 1, configSettled), useGitHubSection(mappedRepository, "pulls", 1, configSettled),
    useGitHubSection(mappedRepository, "actions", 1, configSettled), useGitHubSection(mappedRepository, "commits", 1, configSettled),
  ];
  const githubSettled = configSettled && (!dashboardRequired || !startupQueries.github.isPending) && (!mappedRepository || repositoryQueries.every(query => !query.isPending));
  const contact = useContact(defaultContactOptions, githubSettled && ["contact", "settings"].includes(startupView) || opened);
  const unreadContact = useContact({ ...defaultContactOptions, filter: "unread" }, githubSettled && ["inbox", "settings"].includes(startupView) || opened);
  const allStartupQueries = { ...startupQueries, contact, unreadContact };
  const needsRead = (query: { data: unknown; isPending: boolean }) => !query.data && query.isPending;
  const sourcePending =
    needsRead(startupQueries.config) ||
    (["inbox", "github", "settings"].includes(startupView) && needsRead(startupQueries.github)) ||
    (["contact", "settings"].includes(startupView) && needsRead(contact)) ||
    (["inbox", "settings"].includes(startupView) && needsRead(unreadContact)) ||
    (!!mappedRepository && repositoryQueries.some(needsRead));
  const readState = (query: { data: unknown; isPending: boolean; error: unknown }): "pending" | "error" | "ready" => needsRead(query) ? "pending" : query.error ? "error" : "ready";
  const diagnosticsFail = (data?: { diagnostics: { status: string }[] }) => data?.diagnostics.some(item => item.status === "error" || item.status === "unavailable");
  const githubReads = [...(["inbox", "github", "settings"].includes(startupView) ? [startupQueries.github] : []), ...repositoryQueries.filter(() => !!mappedRepository)];
  const contactReads = [contact, unreadContact].filter((_query, index) => index === 0 ? ["contact", "settings"].includes(startupView) : ["inbox", "settings"].includes(startupView));
  const sources: { name: "GitHub" | "Contact"; state: StartupRead }[] = [];
  if (["inbox", "github", "settings"].includes(startupView) || mappedRepository) sources.push({ name: "GitHub", state: githubReads.some(needsRead) ? "pending" : githubReads.some(query => query.error || diagnosticsFail(query.data)) ? "error" : startupQueries.github.data?.configured === false ? "disabled" : "ready" });
  if (contactReads.length) sources.push({ name: "Contact", state: contactReads.some(needsRead) ? "pending" : contactReads.some(query => query.error || diagnosticsFail(query.data)) ? "error" : "ready" });
  const savedGraph = !!graphQuery.data && (!!graphQuery.data.graph.syncedAt || [graphQuery.data.graph.tasks, graphQuery.data.graph.projects, graphQuery.data.graph.areas].some(values => values.length > 0));
  const savedLocalContent = (!!local.data && [local.data.notes, local.data.drafts, local.data.attachments, local.data.links].some(values => values.length > 0)) || deviceDrafts.some(entry => entry.operation === "save");
  const notionState: StartupRead = graphQuery.isFetching && !graphQuery.data ? "pending" : graphQuery.initialTaskCheck === "pending" ? "pending" :
    graphQuery.error || diagnosticsFail(graphQuery.data) ? "error" : graphQuery.savedData || !online ? "saved" :
    graphQuery.data?.diagnostics.some(item => item.source === "notion" && item.status === "disabled") ? "disabled" : "ready";
  // Release once. Later background refreshes must never hide or remount the shell.
  const ready = hydrated && !!local.data && graphQuery.initialTaskCheck !== "pending" && !needsRead(graphQuery) && !sourcePending;
  const status = startupStatus({ local: local.data ? "ready" : local.error && !local.isFetching ? "error" : "pending", notion: notionState,
    cachedGraph: !!restoredGraph?.graph.syncedAt, savedData: savedGraph || savedLocalContent, graph: graphQuery.data?.graph, config: readState(startupQueries.config), configRequired: !initialConfig, sources, view: startupView, prepared: ready });
  if (ready && !status.blocked && !opened) setOpened(true);
  const showWorkspace = !!local.data && (opened || (ready && !status.blocked));
  return <StartupLoader steps={status.steps} ready={showWorkspace} onRetry={status.blocked ? () => { void local.refetch(); } : undefined}>
    {showWorkspace && local.data && <Workspace local={mergeDeviceDrafts(local.data, deviceDrafts)} deviceDrafts={deviceDrafts} initialView={initialView} graphQuery={graphQuery} startupQueries={allStartupQueries} />}
  </StartupLoader>;
}

type StartupQueries = {
  github: ReturnType<typeof useGitHub>;
  contact: ReturnType<typeof useContact>;
  unreadContact: ReturnType<typeof useContact>;
  config: ReturnType<typeof useConfig>;
};

function Workspace({ local, deviceDrafts, initialView, graphQuery, startupQueries }: { local: LocalSnapshot; deviceDrafts: ReturnType<typeof useDeviceDrafts>; initialView?: string; graphQuery: ReturnType<typeof useGraph>; startupQueries: StartupQueries }) {
  const { t, text: tx, locale } = useTranslation();
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
  const completeTask = useCompletion();
  const queryClient = useQueryClient();
  const refreshBusy = useRef(false);
  const animatedIds = useRef(new Set<string>());
  const [arrivals, setArrivals] = useState<{ view: string; ids: string[] }>({ view: "", ids: [] });
  const activeView = useRef(view);
  const navigationVersion = useRef(0);
  useEffect(() => { activeView.current = view; }, [view]);
  useEffect(() => { if (!arrivals.ids.length) return; const timer = setTimeout(() => setArrivals({ view: "", ids: [] }), 600); return () => clearTimeout(timer); }, [arrivals]);
  const completionEnabled = !graphQuery.error && (graphQuery.data?.completionEnabled ?? false);
  const selected = graph.tasks.find((task) => task.id === selectedId || task.clientKey === selectedId) ?? null;
  const title = viewTitle(view, graph, local, tx);
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
    navigationVersion.current++;
    setArrivals({ view: "", ids: [] });
    window.history.pushState(null, "", viewUrl(next));
    setView(next);
    setSelectedId(null);
    if (online) mutate.mutate({ action: "setPreferences", patch: { lastView: next } });
  }
  useEffect(() => {
    const onBack = () => {
      navigationVersion.current++;
      setArrivals({ view: "", ids: [] });
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
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    const startedView = view;
    const startedNavigation = navigationVersion.current;
    const before = new Set((queryClient.getQueryData<GraphResponse>(queryKeys.graph)?.graph.tasks ?? []).map(task => task.id));
    setAnnouncement("Refreshing your workspace…");
    let results;
    try {
      results = await refresh(response => {
        if (activeView.current !== startedView || navigationVersion.current !== startedNavigation) return;
        const currentLocal = queryClient.getQueryData<LocalSnapshot>(queryKeys.local) ?? local;
        const ids = refreshArrivals(before, response.graph.tasks, tasksForView(startedView, response.graph, currentLocal, today), animatedIds.current);
        setArrivals({ view: startedView, ids });
      });
    } finally { refreshBusy.current = false; }
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

    try {
      const result = await completeTask(task);
      if (result) { setTaskWarnings(result.warnings); setAnnouncement(result.task.completed ? "Task completed." : "Task reopened."); }
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
            animateArrival={arrivals.view === view && arrivals.ids.includes(task.id)}
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
        {t("ui.skip_to_workspace")}</a>
      <aside className="desktop-sidebar" id="desktop-sidebar">{navigation}</aside>
      {!local.preferences.sidebarCollapsed && <button
        type="button"
        className="mobile-sidebar-dismiss"
        aria-label={t("ui.close_sidebar")}
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
              {t("ui.workspace_a279fe9")}{" "}<ChevronRight size={12} />
            </span>
            {parentArea && (
              <button
                className="breadcrumb-button"
                onClick={() => navigate(`area:${parentArea.id}`)}
              >
                <span className="meta-chip meta-area">{parentArea.name}</span>
                <ChevronRight size={12} />
              </button>
            )}
            <span className={`header-current${project ? " meta-chip meta-project" : area ? " meta-chip meta-area" : ""}`}>
              {project ? "$ " : area ? "@ " : ""}
              {title}
            </span>
          </div>
          <div className="header-actions">
            <button
              className="icon-button header-search"
              aria-label={t("ui.search")}
              title={t("ui.search")}
              onClick={() => setPalette(true)}
            >
              <Search size={15} />
            </button>
            <button
              className={`icon-button ${graphQuery.isFetching ? "refreshing" : ""}`}
              aria-label={t("ui.refresh_data")}
              disabled={graphQuery.isFetching}
              onClick={() => void refreshData()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="button header-add" aria-label={t("ui.new_task")}
              onClick={() => setCapture(true)}
            >
              <Plus size={13} />
              <span>{t("ui.new_task")}</span>
              <kbd>{t("ui.n_b51a607")}</kbd>
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
                {new Intl.DateTimeFormat(locale, {
                            timeZone: timezone,
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })
                            .format(new Date())
                            .toUpperCase()}
              </p>}
              <h1>
                <span>{(project || area) && <span className={`meta-chip heading-context ${project ? "meta-project" : "meta-area"}`}>{project ? "$" : "@"}</span>}{" "}{project && parentArea ? <><span className="meta-chip meta-area heading-context">{parentArea.name}</span>{" / "}</> : ""}{title}</span>
                <span className="heading-count">
                  {view === "settings" ||
                  view === "github" ||
                  view === "contact" ? "" : viewTaskCount(view, graph, local, today) +
                      (view === "inbox" ? local.drafts.length + externalCount : 0)}
                </span>
              </h1>
              {project && (
                <p className="view-intro">
                  {[
                    project.status,
                    project.priority && t("project.priority", { priority: project.priority }),
                    tx(`${tasks.filter(task => task.completed).length}/${tasks.length} completed`),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {(project.dates.start || project.dates.end) && <> · <DateChips start={project.dates.start} end={project.dates.end} formatDate={date => date} /></>}
                </p>
              )}
              {area?.type && <p className="view-intro">{area.type}</p>}
            </div>
            {view !== "settings" && (
              <button
                className="text-button view-capture"
                onClick={() => setCapture(true)}
              >
                <Plus size={13} /> {" "}{t("ui.task")}</button>
            )}
          </div>
          
          
          {view === "overview" && <DisplayControls preferences={local.preferences} compact />}
          {taskWarnings.map((warning, index) => <p key={index} role="alert" className="error-text">{tx(warning)}</p>)}
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
                  {t("ui.loading_tasks")}
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
                          {t("ui.drafts")}{" "}<span>{local.drafts.length}</span>
                        </h2>
                      </div>
                      {local.drafts.map((draft) => (
                        <div key={draft.id} className="draft-row">
                          <span className="draft-dot">◇</span>
                          <div>
                            <strong>{draft.title || draft.input}</strong>
                            <p className="task-context">
                              {deviceDrafts.some(entry => entry.draft.id === draft.id) ? t("ui.waiting_to_sync") : t("ui.draft")} ·{" "}
                              {new Intl.DateTimeFormat(locale, {
                                day: "numeric",
                                month: "short",
                              }).format(new Date(draft.createdAt))}
                            </p>
                          </div>
                          <button
                            className="text-button"
                            onClick={() => { setEditingDraft(draft); setCapture(true); }}
                          >
                            {t("ui.resolve")}</button>
                          <button
                            className="text-button danger-text"
                            onClick={() => setDeleteDraft(draft.id)}
                          >
                            {t("ui.delete_f6fdbe4")}</button>
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
                          <h2>{t("ui.projects")}</h2>
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
                              <span className="meta-chip meta-project">$ {project.name}</span>
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
                  {invalidContext && <p role="alert" className="error-text">{t("ui.this_project_does_not_belong_to_the_selected_area")}</p>}
                  {project && !parentArea && project.areaIds.length > 1 && <section className="task-section"><h2>{t("ui.choose_an_area_2a5bae1")}</h2>{project.areaIds.map(id => <button className="project-index-row" key={id} onClick={() => navigate(projectView(project.id, id))}><span className="meta-chip meta-area">{graph.areas.find(area => area.id === id)?.name ?? id}</span>{" / "}<span className="meta-chip meta-project">{project.name}</span>{" →"}</button>)}</section>}
                  {tasks.length > 0 && !(project && !parentArea && project.areaIds.length > 1) ? (
                    <>
                      {sections.map(section => section.collapsed ? (
                        <details className="task-section collapsed-section" key={section.label}>
                          <summary>{tx(section.label)} <span className="muted">{section.items.length}</span></summary>
                          {renderTasks(section.items)}
                        </details>
                      ) : (
                        <section key={section.label} className={`task-section ${section.label === "overdue" ? "overdue" : ""}`}>
                          <div className="section-heading"><h2>{["anytime", "someday"].includes(view) ? sectionTitle(section.label, locale) : tx(sectionTitle(section.label, locale))} <span>{section.items.length}</span></h2></div>
                          {renderTasks(section.items)}
                        </section>
                      ))}
                    </>
                  ) : (
                    !(view === "inbox" && (local.drafts.length || externalCount)) && (
                      project ? <section className="task-section compact-empty"><div className="section-heading"><h2>{t("ui.tasks")}{" "}<span>0</span></h2></div><p className="annotation muted">{t("ui.nothing_here")}</p></section> : <EmptyState
                        title={
                          unavailable ? t("ui.connect_notion_in_settings") : view === "inbox" ? t("ui.you_re_clear") : t("ui.nothing_here_64908a6")
                        }
                      >
                        {view === "someday" && <p>{t("ui.ideas_for_another_day_will_be_waiting_here")}</p>}
                        <div className="inline-actions">
                          <button
                            className="button primary"
                            onClick={() => setCapture(true)}
                          >
                            <Plus size={13} /> {" "}{t("ui.task")}</button>
                          {unavailable && (
                            <button
                              className="button"
                              onClick={() => navigate("settings")}
                            >
                              {t("ui.connect_notion_6f6761d")}{" "}<ChevronRight size={13} />
                            </button>
                          )}
                        </div>
                        <p className="empty-hint">
                          <kbd>{t("ui.n_b51a607")}</kbd> {" "}{t("ui.capture_fbc259d")}{" "}<span>·</span> <kbd>{t("ui.ctrl_k")}</kbd>{" "}
                          {t("ui.find_anything")}</p>
                      </EmptyState>
                    )
                  )}
                  {(project || area) && !invalidContext && <button className="text-button add-task-line" onClick={() => setCapture(true)}>{t("ui.task_2cc1438")}</button>}
                  {view === "overview" && githubCount > 0 && <button className="inbox-summary text-button purple" onClick={() => navigate("inbox")}>{t("ui.inbox_github")}{" "}{githubCount} {" "}{t("ui.waiting")}{" "}<ChevronRight size={12} /></button>}
                  {view === "overview" && (contactCount ?? 0) > 0 && <button className="inbox-summary text-button" onClick={() => navigate("inbox")}>{t("ui.inbox_contact")}{" "}{contactCount} {" "}{t("ui.unread")}{" "}<ChevronRight size={12} /></button>}
                  {view === "overview" && local.drafts.length > 0 && <button className="inbox-summary text-button" onClick={() => navigate("inbox")}>{t("ui.inbox_e18a348")}{" "}{local.drafts.length} {local.drafts.length === 1 ? t("ui.draft") : t("ui.drafts")} <ChevronRight size={12} /></button>}
                  {unavailable && <div className="connection-notice" role="status">
                    <span className="notice-dot" />
                    <div><strong>{graphQuery.error && graphQuery.data ? t("ui.notion_refresh_failed") : graphQuery.error || notion?.status === "error" || notion?.status === "unavailable" ? t("ui.notion_is_unavailable") : t("ui.notion_not_connected")}</strong><p>{graph.syncedAt ? t("ui.last_synced_tasks_retained_retry_or_check_diagnostics") : t("ui.retry_or_check_diagnostics_drafts_are_still_available")}</p></div>
                    <button className="text-button" onClick={() => navigate("settings")}>{t("ui.diagnostics_3af2279")}{" "}<ChevronRight size={13} /></button>
                  </div>}
                  {entity && !invalidContext && !(project && !parentArea && project.areaIds.length > 1) && (
                    <EntityPanel
                      key={`${entity.type}:${entity.id}`}
                      entity={entity}
                      snapshot={local}
                    />
                  )}
                  {entity && project && entity.id !== project.id && [...local.notes, ...local.links, ...local.attachments].some(value => value.entityType === "project" && value.entityId === project.id) && <details className="shared-project-resources"><summary>{t("ui.shared")}{" "}<span className="meta-chip meta-project">{project.name}</span></summary><EntityPanel entity={{ type: "project", id: project.id }} snapshot={local} /></details>}
                  {mappedRepository && <GitHubRepositoryContext key={mappedRepository} repository={mappedRepository} local={local} onOpen={setGithubItem} />}
                  </div>{view === "inbox" && <aside className="inbox-inspector">{contactItem ? <ContactDetail key={contactItem.id} item={contactItem} onClose={() => setContactItem(null)} onUpdated={setContactItem} graph={graph} local={local} timezone={timezone} onTask={setSelectedId} /> : <p className="muted annotation">{t("ui.select_a_message")}</p>}</aside>}</div>
                </>
              )}
            </>
          )}
          </div>
        </main>
        <footer className="workspace-footer">
          <span>
            <span className={`status-dot ${unavailable ? "muted-dot" : ""}`} />
            {graph.syncedAt ? t("ui.synced_value", { p0: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(graph.syncedAt)) }) : t("ui.ready")}
          </span>
          <span>
            {timezone} <span className="footer-divider">/</span> Æ
          </span>
        </footer>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {tx(announcement)}
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
        githubSearchMessage={tx(githubCache.message)}
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
      <Modal open={!!localEntity} onOpenChange={open => { if (!open) setLocalEntity(null); }} title={t("ui.local_context")} description={t("ui.unavailable_in_notion_saved_notes_links_and_files_are_still_here")} className="inspector-dialog">
        {localEntity && <><p className="muted">{localEntity.type}:{localEntity.id}</p><EntityPanel key={`${localEntity.type}:${localEntity.id}`} entity={localEntity} snapshot={local} /></>}
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title={t("ui.shortcuts")}
      >
        <dl className="shortcut-list">
          <div>
            <dt>{t("ui.search_commands")}</dt>
            <dd>
              <kbd>{t("ui.ctrl_k_adc2882")}</kbd>
            </dd>
          </div>
          <div>
            <dt>{t("ui.new_capture")}</dt>
            <dd>
              <kbd>{t("ui.n_b51a607")}</kbd>
            </dd>
          </div>
          <div>
            <dt>{t("ui.close_a_dialog")}</dt>
            <dd>
              <kbd>{t("ui.esc")}</kbd>
            </dd>
          </div>
          <div>
            <dt>{t("ui.navigate_lists")}</dt>
            <dd>
              <kbd>{t("ui.k_6e39f5c")}</kbd> <kbd>{t("ui.j_282487c")}</kbd>
            </dd>
          </div>
          <div><dt>{t("ui.complete_reopen_focused_task")}</dt><dd><kbd>{t("ui.x_space")}</kbd></dd></div>
          <div><dt>{t("ui.edit_focused_task")}</dt><dd><kbd>{t("ui.e_e0184ad")}</kbd></dd></div>
          <div><dt>{t("ui.refresh_sources")}</dt><dd><kbd>{t("ui.r_0657655")}</kbd></dd></div>
          <div>
            <dt>{t("ui.open_focused_item")}</dt>
            <dd>
              <kbd>{t("ui.enter")}</kbd>
            </dd>
          </div>
          <div>
            <dt>{t("ui.show_shortcuts")}</dt>
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
        title={t("ui.delete_this_draft")}
        description={t("ui.this_removes_the_draft_it_cannot_be_undone")}
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



