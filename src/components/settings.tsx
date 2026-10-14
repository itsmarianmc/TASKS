"use client";

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
  const mutation = useLocalMutation();
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
          ✓ {message}
        </p>
      )}
      <section className="settings-section">
        <h2>appearance</h2>
        <div className="setting-line">
          <label htmlFor="theme">Theme</label>
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
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="setting-line">
          <span>Calendar timezone</span>
          <span className="muted">{timezone}</span>
        </div>
      </section>
      <section className="settings-section"><h2>display</h2><DisplayControls preferences={local.preferences} /></section>
      <section className="settings-section" id="integrations">
        <div className="section-heading">
          <h2>connections</h2>
          <button
            className="text-button"
            disabled={health.isFetching}
            onClick={() => {
              void health.refetch();
              void refresh();
              void client.fetchQuery({ queryKey: ["notion-schema"], queryFn: () => apiRequest<NotionSchemaResponse>("/api/notion/schema?refresh=1"), staleTime: 0 }).catch(() => {});
            }}
          >
            Check connections
          </button>
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
                    state === "ok"
                      ? "success-text"
                      : state === "error"
                        ? "error-text"
                        : "muted"
                  }
                >
                  {state === "ok" ? "✓" : state === "error" ? "!" : "○"}
                </span>
                <div>
                  <strong>
                    {source === "localDatabase"
                      ? "Local database"
                      : source === "contact"
                        ? "Contact API"
                        : source === "notion"
                          ? "Notion"
                          : "GitHub"}
                  </strong>
                  <p>
                    {diagnostic?.message ??
                      (state === "configured"
                        ? "Configured · unverified"
                        : state === "disabled"
                          ? "Not configured · add credentials and restart"
                          : state === "ok"
                            ? "Healthy"
                            : "Checking…")}
                  </p>
                  {diagnostic?.details?.map((detail) => (
                    <p key={detail} className="diagnostic-detail">
                      {detail}
                    </p>
                  ))}
                </div>
                <span className="status-label">{state}</span>
              </div>
            );
          },
        )}
        <details className="setup-details">
          <summary>Set up Notion</summary>
          <p>
            Share your Tasks, Projects and Areas databases with your Notion
            integration. Set <code>NOTION_TOKEN</code> and the three database
            IDs in your server environment, then restart TÆSKS.
          </p>
          <p>
            Tasks stay in Notion. Notes, files, filters and drafts stay in your
            local storage. Tokens are never entered or shown here.
          </p>
        </details>
        <details className="setup-details">
          <summary>Set up GitHub</summary>
          <p>Set <code>GITHUB_TOKEN</code> and restart TÆSKS.</p>
          <p>Read permissions: Metadata, Issues, Pull requests, Actions and Contents.</p>
        </details>
        <NotionSettings local={local} />
      </section>
      <PwaSettings />
      <section className="settings-section">
        <h2>quick add parser</h2>
        <div className="setting-line"><span>Language support</span><span className="muted">{parserMode.label}</span></div>
        <div className="setting-line"><span>Optional AI fallback · Gemini</span><span className="status-label">{ai.data?.status ?? "Checking…"}</span></div>
        {ai.data && <div className="setting-line"><span>Model</span><span className="muted">{ai.data.model}</span></div>}
        <p className="muted">Rules first. Optional fallback on request for uncertain input. Ready means configured; connectivity is checked only during parsing.</p>
      </section>
      <section className="settings-section">
        <h2>
          parser aliases <span>{local.aliases.length}</span>
        </h2>
        <p className="muted">
          Short names for projects and areas. Ambiguous names require a choice.
        </p>
        {local.aliases.map((value) => (
          <div className="resource-row" key={value.id}>
            <span className="accent">{value.alias}</span>
            <span className="muted">→</span>
            <span className="resource-name">
              {value.entityType === "project"
                ? graph.projects.find(
                    (project) => project.id === value.entityId,
                  )?.name
                : graph.areas.find((area) => area.id === value.entityId)?.name}
              {!(value.entityType === "project"
                ? graph.projects.some(
                    (project) => project.id === value.entityId,
                  )
                : graph.areas.some((area) => area.id === value.entityId)) &&
                "Entity unavailable"}
            </span>
            <button
              className="icon-button"
              aria-label={`Edit alias ${value.alias}`}
              onClick={() => setAlias(value)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={`Delete alias ${value.alias}`}
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
            Project or area
            <select
              name="entity"
              required
              defaultValue={
                alias ? `${alias.entityType}:${alias.entityId}` : ""
              }
              disabled={!graph.areas.length && !graph.projects.length}
            >
              <option value="" disabled>
                {graph.projects.length || graph.areas.length
                  ? "Select an entity"
                  : "Connect Notion first"}
              </option>
              <optgroup label="Projects">
                {graph.projects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Areas">
                {graph.areas.map((area) => (
                  <option key={area.id} value={`area:${area.id}`}>
                    {area.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            Alias
            <input
              name="alias"
              defaultValue={alias?.alias ?? ""}
              placeholder="e.g. English"
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
              {alias ? "Update" : "Add alias"}
            </button>
            {alias && (
              <button
                type="button"
                className="text-button"
                onClick={() => setAlias(null)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="settings-section">
        <h2>
          saved filters <span>{local.filters.length}</span>
        </h2>
        {local.filters.map((value) => (
          <div className="resource-row" key={value.id}>
            <span className="resource-name">{value.name}</span>
            <button
              className="icon-button"
              aria-label={`Edit filter ${value.name}`}
              onClick={() => setFilter(value)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={`Delete filter ${value.name}`}
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
            Name
            <input
              name="name"
              defaultValue={filter?.name ?? ""}
              required
              maxLength={64}
              placeholder="My focus list"
            />
          </label>
          <label>
            Area
            <select name="areaId" defaultValue={filter?.criteria.areaId ?? ""}>
              <option value="">All areas</option>
              {graph.areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select
              name="projectId"
              defaultValue={filter?.criteria.projectId ?? ""}
            >
              <option value="">All projects</option>
              {graph.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              name="priority"
              defaultValue={filter?.criteria.priority ?? ""}
            >
              <option value="">Any priority</option>
              {["none", "low", "medium", "high", "urgent"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              name="startDate"
              defaultValue={filter?.criteria.startDate ?? ""}
            />
          </label>
          <label>
            Until
            <input
              type="date"
              name="endDate"
              defaultValue={filter?.criteria.endDate ?? ""}
            />
          </label>
          {(["highlight", "someday", "completed"] as const).map((key) => (
            <label key={key}>
              {key}
              <select
                name={key}
                defaultValue={
                  filter?.criteria[key] === undefined
                    ? ""
                    : String(filter.criteria[key])
                }
              >
                <option value="">Either</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          ))}
          {local.tags.length > 0 && (
            <label>
              Tags (all selected)
              <select
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
              {filter ? "Update filter" : "Save filter"}
            </button>
            {filter && (
              <button
                type="button"
                className="text-button"
                onClick={() => setFilter(null)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="settings-section">
        <h2>
          project repositories <span>{local.integrations.length}</span>
        </h2>
          <datalist id="github-repositories">{github.data?.repositories.items.map(repo => <option key={repo.id} value={repo.name} />)}</datalist>
          {local.integrations.some(mapping => github.data?.repositories.status === "ok" && !github.data.repositories.items.some(repo => repo.name.toLowerCase() === mapping.repository.toLowerCase())) && <p className="muted">Some repositories are unverified. Open their projects to check access.</p>}
          {local.integrations.map((value) => (
          <div className="resource-row" key={value.id}>
            <span className="resource-name">
              {graph.projects.find((project) => project.id === value.projectId)
                ?.name ?? "Project unavailable"}
            </span>
            <span className="purple">{value.repository}</span>
            <button
              className="icon-button"
              aria-label={`Delete repository mapping ${value.repository}`}
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
            Project
            <select name="projectId" required disabled={!graph.projects.length}>
              <option value="">
                {graph.projects.length
                  ? "Select project"
                  : "Connect Notion first"}
              </option>
              {graph.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Repository
            <input
              name="repository"
              required
              pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
              placeholder="owner/repository"
              maxLength={256}
                list="github-repositories"
            />
          </label>
          <button
            className="button"
            disabled={ !graph.projects.length}
          >
            Save mapping
          </button>
        </form>
      </section>
      <ConfirmDialog optimistic
        open={!!remove}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        title={remove?.title ?? "Delete?"}
        description="This removes the setting. Notion and GitHub data stay."
        onConfirm={async () => {
          if (remove) await mutation.mutateAsync(remove.action);
        }}
      />
    </div>
  );
}

