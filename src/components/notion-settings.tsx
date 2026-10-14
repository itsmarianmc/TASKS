"use client";
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
    <summary>Property mappings</summary>
    <p>Empty fields use defaults. Highlight cannot be the completion property.</p>
    <InlineError error={schema.error || save.error || refresh.error} />
    {message && <p className="success-text" role="status">✓ {message}</p>}
    {schema.data?.diagnostics.map((diagnostic, index) => <div key={index} role={diagnostic.status === "error" ? "alert" : "status"} className={diagnostic.status === "error" ? "error-text" : "muted"}>
      <p>{diagnostic.message}</p>{diagnostic.details?.map(detail => <p key={detail}>{detail}</p>)}
    </div>)}
    <p className="muted">API {schema.data?.apiVersion || "…"} · {schema.data?.completion?.enabled ? "completion enabled" : "completion disabled"}</p>
    <button type="button" className="text-button" disabled={schema.isFetching || refresh.isPending} onClick={() => refresh.mutate()}>Refresh schema</button>
    <form className="form-grid" onSubmit={submit} key={JSON.stringify(local.notionMapping)}>
      {fields.map(field => {
        const options = schema.data?.properties[field.source].filter(property => property.type === field.type) || [];
        const current = local.notionMapping[field.key] || "";
        return <label key={field.key}>{field.label}<select name={field.key} defaultValue={current} disabled={!schema.data?.configured}>
          <option value="">Server default / discover</option>
          {current && !options.some(option => option.name === current) && <option value={current}>{current} (unavailable)</option>}
          {options.map(option => <option key={option.id} value={option.name}>{option.name}</option>)}
        </select></label>;
      })}
      <label>Completion property<select name="completionProperty" value={selected} onChange={event => setSelected(event.target.value)} disabled={!schema.data?.configured}>
        <option value="">Discover safely</option>
        {selected && !schema.data?.completionCandidates.includes(selected) && <option value={selected}>{selected} (unavailable)</option>}
        {schema.data?.completionCandidates.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {property?.type === "status" && (["completionValue", "reopenValue"] as const).map(key => <label key={`${propertyName}:${key}`}>{key === "completionValue" ? "Completed status" : "Reopened status"}<select name={key} defaultValue={local.notionMapping[key] || ""}>
        <option value="">Discover safely</option>
        {local.notionMapping[key] && !property.options.some(option => option.name === local.notionMapping[key]) && <option value={local.notionMapping[key]}>{local.notionMapping[key]} (unavailable)</option>}
        {property.options.map(option => <option key={option.id} value={option.name}>{option.name}{option.group ? ` · ${option.group}` : ""}</option>)}
      </select></label>)}
      <div className="form-footer"><button className="button" disabled={save.isPending || !schema.data?.configured}>Save mappings</button></div>
    </form>
    {schema.data?.configured && <details><summary>Detected fields</summary>{(["tasks", "projects", "areas"] as const).map(source => <p key={source}><strong>{source}</strong> {schema.data!.properties[source].map(property => `${property.name} (${property.type})`).join(" · ") || "Unavailable"}</p>)}</details>}
  </details>;
}
