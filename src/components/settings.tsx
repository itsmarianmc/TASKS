"use client";
import { useTranslation } from "./localization";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Pencil } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { useLocalMutation, useRefresh } from "@/lib/queries";
import type { NotionSchemaResponse } from "@/lib/notion-contracts";
import type {
  Diagnostic,
  FilterCriteria,
  Graph,
  LocalSnapshot,
  ParserAlias,
  SavedFilter,
  Theme,
} from "@/lib/types";
import type { LocalMutation } from "@/lib/schemas";
import { ConfirmDialog, InlineError } from "./primitives";
import { NotionSettings } from "./notion-settings";
import { useGitHub } from "@/lib/github-queries";
import { parserMode } from "@/lib/parser";
import type { AiFallbackStatus } from "@/lib/ai-contracts";
import { DisplayControls } from "./display-controls";
import { TerminalToggle } from "./terminal-toggle";
import { useConfig } from "@/lib/queries";
import { PwaSettings } from "./pwa";

export function SettingsView({
  graph,
  local,
  diagnostics,
  timezone,
}: {
  graph: Graph;
  local: LocalSnapshot;
  diagnostics: Diagnostic[];
  timezone: string;
}) {
  const { t, text: tx } = useTranslation();
  const mutation = useLocalMutation();
  const catalogConfig = useConfig();
  const { languages, selection } = useTranslation();
  const github = useGitHub();
  const refresh = useRefresh();
  const client = useQueryClient();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      apiRequest<{ services: Record<string, string> }>("/api/health"),
    staleTime: 30_000,
  });
  const ai = useQuery({ queryKey: ["diagnostics", "ai"], queryFn: () => apiRequest<AiFallbackStatus>("/api/ai/status"), staleTime: 30_000, retry: false });
  const [message, setMessage] = useState("");
  const [alias, setAlias] = useState<ParserAlias | null>(null);
  const [filter, setFilter] = useState<SavedFilter | null>(null);
  const [remove, setRemove] = useState<{
    title: string;
    action: LocalMutation;
  } | null>(null);
  async function save(action: LocalMutation, success: string) {
    setMessage("");
    mutation.reset();
    try {
      await mutation.mutateAsync(action);
      setMessage(success);
      return true;
    } catch {
      return false;
    }
  }
  async function saveAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const [type, id] = String(data.get("entity")).split(":");
    if (
      await save(
        {
          action: "saveAlias",
          ...(alias ? { id: alias.id } : {}),
          entityType: type as "project" | "area",
          entityId: id,
          alias: String(data.get("alias")),
        },
        "Alias saved.",
      )
    ) {
      const current = new FormData(form);
      if (current.get("alias") === data.get("alias") && current.get("entity") === data.get("entity")) { setAlias(null); form.reset(); }
    }
  }
  async function saveFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const criteria: FilterCriteria = {};
    for (const key of [
      "areaId",
      "projectId",
      "priority",
      "startDate",
      "endDate",
    ] as const) {
      const value = String(data.get(key) ?? "");
      if (value) Object.assign(criteria, { [key]: value });
    }
    const tags = data.getAll("tagIds").map(String);
    if (tags.length) criteria.tagIds = tags;
    for (const key of ["highlight", "someday", "completed"] as const) {
      const value = String(data.get(key));
      if (value === "true" || value === "false")
        criteria[key] = value === "true";
    }
    if (
      await save(
        {
          action: "saveFilter",
          ...(filter ? { id: filter.id } : {}),
          name: String(data.get("name")),
          criteria,
        },
        "Filter saved.",
      )
    ) {
      if (JSON.stringify([...new FormData(form)]) === JSON.stringify([...data])) { setFilter(null); form.reset(); }
    }
  }
  return (
    <div className="settings-view">
      <InlineError error={health.error} />
      {message && (
        <p className="success-text" role="status">
          ✓ {tx(message)}
        </p>
      )}
      <section className="settings-section">
        <h2>{t("ui.language_parsing")}</h2>
        <label htmlFor="language">{t("ui.language_89b86ab")}</label>
        <select id="language" aria-label={t("ui.language_89b86ab")} aria-describedby="language-origin" value={selection} onChange={event => mutation.mutate({ action: "setPreferences", patch: { language: event.target.value } })}>
          {languages.some(language => language.origin === "external") && <optgroup label={t("catalogs.external_group")}>
            {languages.filter(language => language.origin === "external").map(language => <option key={language.id} value={language.id}>[!] {language.locName} ({language.sourceOrder})</option>)}
          </optgroup>}
          <optgroup label={t("catalogs.verified_group")}>
            {languages.filter(language => language.origin !== "external").map(language => <option key={language.id ?? language.lang} value={language.id ?? language.lang}>{language.locName}</option>)}
          </optgroup>
        </select>
        {catalogConfig.data?.catalogs?.diagnostics.map((message, index) => {
          const failure = /^Catalog (\d+) \((language|date)\): (.*)$/.exec(message);
          return <p key={index} className="muted">{failure ? t("catalogs.failure", { index: failure[1], kind: tx(failure[2]), reason: tx(failure[3]) }) : tx(message)}</p>;
        })}
      </section>
      <section className="settings-section">
        <h2>{t("ui.appearance")}</h2>
        <div className="setting-line">
          <label htmlFor="theme">{t("ui.theme_a797e30")}</label>
          <select
            id="theme"
            value={local.preferences.theme}
            
            onChange={(event) =>
              void save(
                {
                  action: "setPreferences",
                  patch: { theme: event.target.value as Theme },
                },
                "Theme updated.",
              )
            }
          >
            <option value="system">{t("ui.system_bc0792d")}</option>
            <option value="dark">{t("ui.dark_ae1ef01")}</option>
            <option value="light">{t("ui.light_a36ef8a")}</option>
          </select>
        </div>
        <div className="setting-line">
          <span>{t("ui.calendar_timezone")}</span>
          <span className="muted">{timezone}</span>
        </div>
      </section>
      <section className="settings-section"><h2>{t("ui.display")}</h2><DisplayControls preferences={local.preferences} /></section>
      <section className="settings-section" id="integrations">
        <div className="section-heading">
          <h2>{t("ui.connections")}</h2>
          <button
            className="text-button"
            disabled={health.isFetching}
            onClick={() => {
              void health.refetch();
              void refresh();
              void client.fetchQuery({ queryKey: ["notion-schema"], queryFn: () => apiRequest<NotionSchemaResponse>("/api/notion/schema?refresh=1"), staleTime: 0 }).catch(() => {});
            }}
          >
            {t("ui.check_connections")}</button>
        </div>
        {(["notion", "github", "contact", "localDatabase"] as const).map(
          (source) => {
            const diagnostic = diagnostics.find(
              (value) => value.source === source,
            );
            const state =
              diagnostic?.status ?? health.data?.services[source] ?? "checking";
            return (
              <div className="diagnostic-row" key={source}>
                <span
                  className={
                    state === "ok" ? "success-text" : state === "error" ? "error-text" : "muted"
                  }
                >
                  {state === "ok" ? "✓" : state === "error" ? "!" : "○"}
                </span>
                <div>
                  <strong>
                    {source === "localDatabase" ? t("ui.local_database") : source === "contact" ? t("ui.contact_api") : source === "notion" ? t("ui.notion_486af5d") : t("ui.github_5442e2b")}
                  </strong>
                  <p>
                    {diagnostic?.message ?? (state === "configured"
                        ? "Configured · unverified"
                        : state === "disabled"
                          ? "Not configured · add credentials and restart"
                          : state === "ok"
                            ? "Healthy"
                            : "Checking…")}
                  </p>
                  {diagnostic?.details?.map((detail) => (
                    <p key={tx(detail)} className="diagnostic-detail">
                      {tx(detail)}
                    </p>
                  ))}
                </div>
                <span className="status-label">{tx(state)}</span>
              </div>
            );
          },
        )}
        <details className="setup-details">
          <summary>{t("ui.set_up_notion")}</summary>
          <p>
            {t("ui.share_your_tasks_projects_and_areas_databases_with_your_notion_integration_set")}{" "}<code>NOTION_TOKEN</code> {" "}{t("ui.and_the_three_database_ids_in_your_server_environment_then_restart_t_sks")}</p>
          <p>
            {t("ui.tasks_stay_in_notion_notes_files_filters_and_drafts_stay_in_your_local_storage_tokens_are_never")}</p>
        </details>
        <details className="setup-details">
          <summary>{t("ui.set_up_github")}</summary>
          <p>{t("ui.set")}{" "}<code>GITHUB_TOKEN</code> {" "}{t("ui.and_restart_t_sks")}</p>
          <p>{t("ui.read_permissions_metadata_issues_pull_requests_actions_and_contents")}</p>
        </details>
        <NotionSettings local={local} />
      </section>
      <PwaSettings />
      <section className="settings-section">
        <h2>{t("ui.quick_add_parser")}</h2>
        <div className="setting-line"><span>{t("ui.language_support")}</span><span className="muted">{tx(parserMode.label)}</span></div>
        <div className="setting-line"><span>{t("ui.optional_ai_fallback_gemini")}</span><span className="status-label">{ai.data?.status ? tx(ai.data.status) : t("ui.checking_820d600")}</span></div>
        {ai.data && <div className="setting-line"><span>{t("ui.model")}</span><span className="muted">{ai.data.model}</span></div>}
        <p className="muted">{t("ui.rules_first_optional_fallback_on_request_for_uncertain_input_ready_means_configured_connectivit")}</p>
      </section>
      <section className="settings-section">
        <h2>
          {t("ui.parser_aliases_c378ff0")}{" "}<span>{local.aliases.length}</span>
        </h2>
        <p className="muted">
          {t("ui.short_names_for_projects_and_areas_ambiguous_names_require_a_choice")}</p>
        <TerminalToggle label={t("ui.treat_quoted_text_as_literal")} checked={local.preferences.literalQuotedText !== false} onChange={literalQuotedText => mutation.mutate({ action: "setPreferences", patch: { literalQuotedText } })} />
        <p className="muted">{t("ui.quoted_text_stays_in_the_task_title_and_is_excluded_from_date_relation_tag_priority_and_recurre")}</p>
        {local.aliases.map((value) => (
          <div className="resource-row" key={value.id}>
            <span className="accent">{value.alias}</span>
            <span className="muted">→</span>
            <span className="resource-name">
              {value.entityType === "project" ? graph.projects.find(
                    (project) => project.id === value.entityId,
                  )?.name : graph.areas.find((area) => area.id === value.entityId)?.name}
              {!(value.entityType === "project"
                ? graph.projects.some(
                    (project) => project.id === value.entityId,
                  )
                : graph.areas.some((area) => area.id === value.entityId)) &&
                "Entity unavailable"}
            </span>
            <button
              className="icon-button"
              aria-label={t("ui.edit_alias_value", { p0: value.alias })}
              onClick={() => setAlias(value)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={t("ui.delete_alias_value", { p0: value.alias })}
              onClick={() =>
                setRemove({
                  title: `Delete alias “${value.alias}”?`,
                  action: { action: "deleteAlias", id: value.id },
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <form
          className="compact-form"
          onSubmit={saveAlias}
          key={alias?.id ?? "new-alias"}
        >
          <label>
            {t("ui.project_or_area")}<select
              name="entity"
              required
              defaultValue={
                alias ? `${alias.entityType}:${alias.entityId}` : ""
              }
              disabled={!graph.areas.length && !graph.projects.length}
            >
              <option value="" disabled>
                {graph.projects.length || graph.areas.length ? t("ui.select_an_entity") : t("ui.connect_notion_first")}
              </option>
              <optgroup label={t("ui.projects_53e890d")}>
                {graph.projects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("ui.areas_14ce09a")}>
                {graph.areas.map((area) => (
                  <option key={area.id} value={`area:${area.id}`}>
                    {area.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            {t("ui.alias_0425981")}<input
              name="alias"
              defaultValue={alias?.alias ?? ""}
              placeholder={t("ui.e_g_english")}
              required
              maxLength={128}
            />
          </label>
          <div className="inline-actions">
            <button
              className="button"
              disabled={
                
                (!graph.areas.length && !graph.projects.length)
              }
            >
              {alias ? t("ui.update") : t("ui.add_alias")}
            </button>
            {alias && (
              <button
                type="button"
                className="text-button"
                onClick={() => setAlias(null)}
              >
                {t("ui.cancel")}</button>
            )}
          </div>
        </form>
      </section>
      <section className="settings-section">
        <h2>
          {t("ui.saved_filters_110768b")}{" "}<span>{local.filters.length}</span>
        </h2>
        {local.filters.map((value) => (
          <div className="resource-row" key={value.id}>
            <span className="resource-name">{value.name}</span>
            <button
              className="icon-button"
              aria-label={t("ui.edit_filter_value", { p0: value.name })}
              onClick={() => setFilter(value)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={t("ui.delete_filter_value", { p0: value.name })}
              onClick={() =>
                setRemove({
                  title: `Delete filter “${value.name}”?`,
                  action: { action: "deleteFilter", id: value.id },
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <form
          className="form-grid"
          onSubmit={saveFilter}
          key={filter?.id ?? "new-filter"}
        >
          <label>
            {t("ui.name_709a232")}<input
              name="name"
              defaultValue={filter?.name ?? ""}
              required
              maxLength={64}
              placeholder={t("ui.my_focus_list")}
            />
          </label>
          <label>
            {t("ui.area_2745deb")}<select name="areaId" defaultValue={filter?.criteria.areaId ?? ""}>
              <option value="">{t("ui.all_areas")}</option>
              {graph.areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("ui.project_f6f4da8")}<select
              name="projectId"
              defaultValue={filter?.criteria.projectId ?? ""}
            >
              <option value="">{t("ui.all_projects")}</option>
              {graph.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("ui.priority_886cbff")}<select
              name="priority"
              defaultValue={filter?.criteria.priority ?? ""}
            >
              <option value="">{t("ui.any_priority")}</option>
              {["none", "low", "medium", "high", "urgent"].map((value) => (
                <option value={value} key={value}>{tx(value)}</option>
              ))}
            </select>
          </label>
          <label>
            {t("ui.from_3f66052")}<input
              type="date"
              name="startDate"
              defaultValue={filter?.criteria.startDate ?? ""}
            />
          </label>
          <label>
            {t("ui.until")}<input
              type="date"
              name="endDate"
              defaultValue={filter?.criteria.endDate ?? ""}
            />
          </label>
          {(["highlight", "someday", "completed"] as const).map((key) => (
            <label key={key}>
              {tx(key)}
              <select
                name={key}
                defaultValue={
                  filter?.criteria[key] === undefined ? "" : String(filter.criteria[key])
                }
              >
                <option value="">{t("ui.either")}</option>
                <option value="true">{t("ui.yes")}</option>
                <option value="false">{t("ui.no_816c52f")}</option>
              </select>
            </label>
          ))}
          {local.tags.length > 0 && (
            <label>
              {t("ui.tags_all_selected")}<select
                multiple
                name="tagIds"
                defaultValue={filter?.criteria.tagIds ?? []}
              >
                {local.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-footer inline-actions">
            <button className="button" >
              {filter ? t("ui.update_filter") : t("ui.save_filter")}
            </button>
            {filter && (
              <button
                type="button"
                className="text-button"
                onClick={() => setFilter(null)}
              >
                {t("ui.cancel")}</button>
            )}
          </div>
        </form>
      </section>
      <section className="settings-section">
        <h2>
          {t("ui.project_repositories")}{" "}<span>{local.integrations.length}</span>
        </h2>
          <datalist id="github-repositories">{github.data?.repositories.items.map(repo => <option key={repo.id} value={repo.name} />)}</datalist>
          {local.integrations.some(mapping => github.data?.repositories.status === "ok" && !github.data.repositories.items.some(repo => repo.name.toLowerCase() === mapping.repository.toLowerCase())) && <p className="muted">{t("ui.some_repositories_are_unverified_open_their_projects_to_check_access")}</p>}
          {local.integrations.map((value) => (
          <div className="resource-row" key={value.id}>
            <span className="resource-name">
              {graph.projects.find((project) => project.id === value.projectId)
                ?.name ?? t("ui.project_unavailable")}
            </span>
            <span className="purple">{value.repository}</span>
            <button
              className="icon-button"
              aria-label={t("ui.delete_repository_mapping_value", { p0: value.repository })}
              onClick={() =>
                setRemove({
                  title: "Remove repository mapping?",
                  action: { action: "deleteIntegration", id: value.id },
                })
              }
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <form
          className="compact-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            if (
              await save(
                {
                  action: "saveIntegration",
                  projectId: String(data.get("projectId")),
                  repository: String(data.get("repository")),
                },
                "Repository mapping saved.",
              )
            )
              if (JSON.stringify([...new FormData(form)]) === JSON.stringify([...data])) form.reset();
          }}
        >
          <label>
            {t("ui.project_f6f4da8")}<select name="projectId" required disabled={!graph.projects.length}>
              <option value="">
                {graph.projects.length ? t("ui.select_project") : t("ui.connect_notion_first")}
              </option>
              {graph.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("ui.repository_3123868")}<input
              name="repository"
              required
              pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
              placeholder={t("ui.owner_repository")}
              maxLength={256}
                list="github-repositories"
            />
          </label>
          <button
            className="button"
            disabled={ !graph.projects.length}
          >
            {t("ui.save_mapping")}</button>
        </form>
      </section>
      <ConfirmDialog optimistic
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title={remove?.title ? tx(remove.title) : t("ui.delete_042dc9b")}
        description={t("ui.this_removes_the_setting_notion_and_github_data_stay")}
        onConfirm={async () => {
          if (remove) await mutation.mutateAsync(remove.action);
        }}
      />
    </div>
  );
}

