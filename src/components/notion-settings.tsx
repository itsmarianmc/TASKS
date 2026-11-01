"use client";
import { useTranslation } from "./localization";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { NotionMapping, LocalSnapshot } from "@/lib/types";
import type { NotionSchemaResponse, NotionGraphResponse } from "@/lib/notion-contracts";
import { queryKeys } from "@/lib/queries";
import { optimisticCache, optimisticRead } from "@/lib/optimistic";
import { InlineError } from "./primitives";

const fields: { key: keyof NotionMapping; label: string; source: "tasks" | "projects" | "areas"; type: string }[] = [
  { key: "taskTitleProperty", label: "Task title", source: "tasks", type: "title" },
  { key: "taskDateProperty", label: "Task dates", source: "tasks", type: "date" },
  { key: "taskAreaProperty", label: "Task area", source: "tasks", type: "relation" },
  { key: "taskProjectProperty", label: "Task project", source: "tasks", type: "relation" },
  { key: "taskHighlightProperty", label: "Task highlight", source: "tasks", type: "checkbox" },
  { key: "projectTitleProperty", label: "Project title", source: "projects", type: "title" },
  { key: "projectAreaProperty", label: "Project areas", source: "projects", type: "relation" },
  { key: "areaTitleProperty", label: "Area title", source: "areas", type: "title" },
];
export function NotionSettings({ local }: { local: LocalSnapshot }) {
  const { t, text: tx } = useTranslation();
  const client = useQueryClient();
  const schema = useQuery({ queryKey: ["notion-schema"], queryFn: () => apiRequest<NotionSchemaResponse>("/api/notion/schema"), staleTime: 60_000, retry: false });
  const [selected, setSelected] = useState(local.notionMapping.completionProperty || "");
  const [message, setMessage] = useState("");
  const propertyName = selected || schema.data?.completion?.property;
  const property = schema.data?.properties.tasks.find(property => property.name === propertyName);
  const save = useMutation({
    mutationFn: (mapping: NotionMapping) => apiRequest<{ schema: NotionSchemaResponse; snapshot: LocalSnapshot }>("/api/notion/mapping", { method: "POST", body: JSON.stringify(mapping) }),
    onSuccess: async result => {
      optimisticCache(client).merge<LocalSnapshot>(queryKeys.local, old => old && { ...old, notionMapping: result.snapshot.notionMapping });
      client.setQueryData(["notion-schema"], result.schema);
      setMessage("Mappings verified and saved.");
      void client.fetchQuery({ queryKey: queryKeys.graph, queryFn: ({ signal }) => optimisticRead(client, queryKeys.graph, () => apiRequest<NotionGraphResponse>("/api/graph?refresh=1", { signal })), staleTime: 0 }).catch(() => {});
    },
  });
  const refresh = useMutation({
    mutationFn: () => apiRequest<NotionSchemaResponse>("/api/notion/schema?refresh=1"),
    onSuccess: async result => {
      client.setQueryData(["notion-schema"], result);
      void client.fetchQuery({ queryKey: queryKeys.graph, queryFn: ({ signal }) => optimisticRead(client, queryKeys.graph, () => apiRequest<NotionGraphResponse>("/api/graph?refresh=1", { signal })), staleTime: 0 }).catch(() => {});
    },
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const data = new FormData(event.currentTarget);
    const mapping: NotionMapping = {};
    for (const key of [...fields.map(field => field.key), "completionProperty", "completionValue", "reopenValue"] as (keyof NotionMapping)[]) {
      const value = String(data.get(key) || "").trim();
      if (value) mapping[key] = value;
    }
    try { await save.mutateAsync(mapping); } catch { /* Inline error keeps the form available. */ }
  }
  return <details className="setup-details">
    <summary>{t("ui.property_mappings")}</summary>
    <p>{t("ui.empty_fields_use_defaults_highlight_cannot_be_the_completion_property")}</p>
    <InlineError error={schema.error || save.error || refresh.error} />
    {message && <p className="success-text" role="status">✓ {tx(message)}</p>}
    {schema.data?.diagnostics.map((diagnostic, index) => <div key={index} role={diagnostic.status === "error" ? "alert" : "status"} className={diagnostic.status === "error" ? "error-text" : "muted"}>
      <p>{tx(diagnostic.message)}</p>{diagnostic.details?.map(detail => <p key={tx(detail)}>{tx(detail)}</p>)}
    </div>)}
    <p className="muted">{t("ui.api")}{" "}{schema.data?.apiVersion || "…"} · {schema.data?.completion?.enabled ? t("ui.completion_enabled") : t("ui.completion_disabled")}</p>
    <button type="button" className="text-button" disabled={schema.isFetching || refresh.isPending} onClick={() => refresh.mutate()}>{t("ui.refresh_schema")}</button>
    <form className="form-grid" onSubmit={submit} key={JSON.stringify(local.notionMapping)}>
      {fields.map(field => {
        const options = schema.data?.properties[field.source].filter(property => property.type === field.type) || [];
        const current = local.notionMapping[field.key] || "";
        return <label key={field.key}>{tx(field.label)}<select name={field.key} defaultValue={current} disabled={!schema.data?.configured}>
          <option value="">{t("ui.server_default_discover")}</option>
          {current && !options.some(option => option.name === current) && <option value={current}>{current} {" "}{t("ui.unavailable_b2cac27")}</option>}
          {options.map(option => <option key={option.id} value={option.name}>{option.name}</option>)}
        </select></label>;
      })}
      <label>{t("ui.completion_property")}<select name="completionProperty" value={selected} onChange={event => setSelected(event.target.value)} disabled={!schema.data?.configured}>
        <option value="">{t("ui.discover_safely")}</option>
        {selected && !schema.data?.completionCandidates.includes(selected) && <option value={selected}>{selected} {" "}{t("ui.unavailable_b2cac27")}</option>}
        {schema.data?.completionCandidates.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {property?.type === "status" && (["completionValue", "reopenValue"] as const).map(key => <label key={`${propertyName}:${key}`}>{key === "completionValue" ? t("ui.completed_status") : t("ui.reopened_status")}<select name={key} defaultValue={local.notionMapping[key] || ""}>
        <option value="">{t("ui.discover_safely")}</option>
        {local.notionMapping[key] && !property.options.some(option => option.name === local.notionMapping[key]) && <option value={local.notionMapping[key]}>{local.notionMapping[key]} {" "}{t("ui.unavailable_b2cac27")}</option>}
        {property.options.map(option => <option key={option.id} value={option.name}>{option.name}{option.group ? t("ui.value_105f5fa", { p0: option.group }) : ""}</option>)}
      </select></label>)}
      <div className="form-footer"><button className="button" disabled={save.isPending || !schema.data?.configured}>{t("ui.save_mappings")}</button></div>
    </form>
    {schema.data?.configured && <details><summary>{t("ui.detected_fields")}</summary>{(["tasks", "projects", "areas"] as const).map(source => <p key={source}><strong>{tx(source)}</strong> {schema.data!.properties[source].map(property => `${property.name} (${property.type})`).join(" · ") || t("ui.unavailable_2c9c1f7")}</p>)}</details>}
  </details>;
}
