"use client";
import { useTranslation } from "./localization";
import { useState } from "react";
import type { Graph, LocalSnapshot } from "@/lib/types";
import { mainViews, viewTaskCount, viewTitle, type ViewId } from "@/lib/views";
import { moveListFocus } from "./primitives";
import { sidebarAreas } from "@/lib/sidebar-visibility";
import { projectContext, projectView } from "@/lib/view-context";

// Keep this mapping local: other surfaces retain their existing view symbols.
const primaryIcons = {
  overview: "table-columns", inbox: "inbox", today: "sun", next: "calendar-week",
  upcoming: "calendar-days", anytime: "infinity", someday: "moon",
} as const;

function SidebarIcon({ name, brands = false, size, expanded = false }: {
  name: string; brands?: boolean; size?: number; expanded?: boolean;
}) {
  return <i aria-hidden="true" className={`sidebar-icon ${brands ? "fa-brands" : "fa-solid"} fa-${name}${expanded ? " expanded" : ""}`} style={size ? { fontSize: size } : undefined} />;
}

export function Navigation({
  view,
  graph,
  local,
  today,
  onNavigate,
  onSearch,
  onCapture,
  onToggleSidebar,
  onHelp,
  externalInboxCount = 0,
  githubCount = 0,
  contactCount,
}: {
  view: ViewId;
  graph: Graph;
  local: LocalSnapshot;
  today: string;
  onNavigate: (view: ViewId) => void;
  onSearch: () => void;
  onCapture: () => void;
  onToggleSidebar: () => void;
  onHelp: () => void;
  externalInboxCount?: number;
  githubCount?: number;
  contactCount?: number;
}) {
  const { t, text: tx } = useTranslation();
  const tree = sidebarAreas(graph, local, today, view);
  const sidebarCollapsed = local.preferences.sidebarCollapsed;
  // Detail views retain their context in the workspace; Overview represents them in the rail.
  const primaryView = sidebarCollapsed && view !== "settings" && !mainViews.some(item => item.id === view) ? "overview" : view;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((values) => {
      const next = new Set(values);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = (id: string) =>
    viewTaskCount(id, graph, local, today) + (id === "inbox" ? local.drafts.length + externalInboxCount : 0);
  const row = (
    id: string,
    label: string,
    symbol: React.ReactNode,
    countValue?: number,
    indent = false,
  ) => (
    <button
      key={id}
      data-list-row
      className={`nav-row ${primaryView === id ? "active" : ""} ${indent ? "indented" : ""}`}
      aria-label={sidebarCollapsed ? label : undefined}
      title={primaryView === id && view !== id ? t("ui.value_value_9482534", { p0: label, p1: viewTitle(view, graph, local, tx) }) : label}
      aria-current={view === id ? "page" : primaryView === id ? "location" : undefined}
      onClick={() => onNavigate(id)}
    >
      <span className={`nav-symbol${id.startsWith("area:") ? " meta-chip meta-area" : id.startsWith("project:") ? " meta-chip meta-project" : ""}`} aria-hidden="true">{symbol}</span>
      <span className="nav-label">{label}</span>
      {countValue !== undefined && (
        <span className="nav-count">{countValue}</span>
      )}
    </button>
  );
  return (
    <nav className="navigation" aria-label={t("ui.lists")} onKeyDown={moveListFocus}>
      <div className="sidebar-brand">
        <button
          className="icon-button"
          aria-label={t("ui.new_task")}
          title={t("ui.new_task")}
          onClick={onCapture}
        >
          <SidebarIcon name="plus" size={17} />
        </button>
        <button
          className="brand"
          onClick={() => onNavigate("overview")}
          aria-label={t("ui.t_sks_overview")}
        >
          T<span className="brand-mark"><span>[</span><i>Æ</i><span>]</span></span>SKS<span className="brand-period">.</span>
        </button>
        <button
          type="button"
          className="icon-button sidebar-brand-toggle"
          aria-label={sidebarCollapsed ? t("ui.expand_sidebar") : t("ui.collapse_sidebar")}
          title={sidebarCollapsed ? t("ui.expand_sidebar") : t("ui.collapse_sidebar")}
          aria-expanded={!sidebarCollapsed}
          aria-controls="sidebar-lists"
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? "[>]" : "[<]"}
        </button>
      </div>
      <button className="search-trigger" aria-label={t("ui.search")} title={t("ui.search")} onClick={onSearch}>
        <SidebarIcon name="magnifying-glass" size={13} />
        <span>{t("ui.search")}</span>
        <kbd>{t("ui.k_f1f00b4")}</kbd>
      </button>
      <div className="nav-scroll" id="sidebar-lists">
        <div className="nav-group">
          {mainViews.map((item) =>
            row(
              item.id,
              tx(item.label),
              <SidebarIcon name={primaryIcons[item.id]} />,
              item.id === "overview" ? undefined : count(item.id),
            ),
          )}
        </div>
        <section className="nav-group">
          <button
            className="nav-section-title"
            aria-expanded={!collapsed.has("areas")}
            onClick={() => toggle("areas")}
          >
            <SidebarIcon name="chevron-right" expanded={!collapsed.has("areas")} size={11} />
            {t("ui.areas_14ce09a")}{" "}<span>{tree.length}</span>
          </button>
          {!collapsed.has("areas") &&
            (graph.areas.length ? (
              tree.map(({ area, projects }) => (
                <div className={`area-tree ${projectContext(view)?.areaId === area.id ? "context-active" : ""}`} key={area.id}>
                  <div className="area-tree-header">
                    <button
                      className="tree-toggle"
                      aria-label={t("ui.value_value_99ecfde", { p0: collapsed.has(area.id) ? t("ui.expand") : t("ui.collapse"), p1: area.name })}
                      aria-expanded={!collapsed.has(area.id)}
                      onClick={() => toggle(area.id)}
                    >
                      <SidebarIcon name="chevron-right" expanded={!collapsed.has(area.id)} size={11} />
                    </button>
                    {row(
                      `area:${area.id}`,
                      area.name,
                      <SidebarIcon name="layer-group" />,
                      count(`area:${area.id}`),
                    )}
                  </div>
                  {!collapsed.has(area.id) &&
                    projects
                      .map((project) =>
                        row(
                          projectView(project.id, area.id),
                          project.name,
                          <SidebarIcon name="folder" />,
                          count(projectView(project.id, area.id)),
                          true,
                        ),
                      )}
                </div>
              ))
            ) : (
              <button
                className="nav-empty"
                onClick={() => onNavigate("settings")}
              >
                {t("ui.connect_notion")}<SidebarIcon name="arrow-right" />
              </button>
            ))}
        </section>
        <section className="nav-group">
          <button
            className="nav-section-title"
            aria-expanded={!collapsed.has("tags")}
            onClick={() => toggle("tags")}
          >
            <SidebarIcon name="chevron-right" expanded={!collapsed.has("tags")} size={11} />
            {t("ui.tags_848eed0")}{" "}<span>{local.tags.length}</span>
          </button>
          {!collapsed.has("tags") &&
            (local.tags.length ? (
              local.tags.map((tag) =>
                row(
                  `tag:${tag.id}`,
                  `[${tag.name}]`,
                  <SidebarIcon name="tag" />,
                  count(`tag:${tag.id}`),
                ),
              )
            ) : (
              <p className="nav-empty">{t("ui.no_tags_yet")}</p>
            ))}
        </section>
        <section className="nav-group">
          <button
            className="nav-section-title"
            aria-expanded={!collapsed.has("filters")}
            onClick={() => toggle("filters")}
          >
            <SidebarIcon name="chevron-right" expanded={!collapsed.has("filters")} size={11} />
            {t("ui.filters_96e5782")}{" "}<span>{local.filters.length}</span>
          </button>
          {!collapsed.has("filters") &&
            (local.filters.length ? (
              local.filters.map((filter) =>
                row(
                  `filter:${filter.id}`,
                  filter.name,
                  <SidebarIcon name="filter" />,
                  count(`filter:${filter.id}`),
                ),
              )
            ) : (
              <button
                className="nav-empty"
                onClick={() => onNavigate("settings")}
              >
                <SidebarIcon name="plus" /> {" "}{t("ui.saved_filter")}</button>
            ))}
        </section>
        <section className="nav-group">
          <p className="nav-section-title">{t("ui.external")}</p>
          {row("github", "GitHub", <SidebarIcon name="github" brands size={13} />, githubCount)}
          {row("contact", tx("Contact"), <SidebarIcon name="envelope" size={13} />, contactCount)}
        </section>
      </div>
      <div className="sidebar-footer">
        {row("settings", tx("Settings & diagnostics"), <SidebarIcon name="sliders" size={13} />)}
        <div className="sidebar-footnote">
          <button className="text-button shortcut-help" aria-label={t("ui.shortcuts")} title={t("ui.shortcuts")} onClick={onHelp}>
            <SidebarIcon name="keyboard" size={12} /><span className="nav-label">{t("ui.shortcuts")}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
