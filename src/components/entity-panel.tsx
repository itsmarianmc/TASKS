"use client";
import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Link2, Paperclip, Trash2 } from "lucide-react";
import { useConfig, useLocalMutation } from "@/lib/queries";
import { useAttachmentMutation } from "@/lib/attachment-queries";
import { emptyMutationStatus, mutationStatusKey, optimisticCache, type MutationStatus } from "@/lib/optimistic";
import { httpUrlSchema } from "@/lib/schemas";
import type { EntityLink, EntityRef, LocalSnapshot } from "@/lib/types";
import { ConfirmDialog, InlineError } from "./primitives";

export function EntityPanel({ entity, snapshot }: { entity: EntityRef; snapshot: LocalSnapshot }) {
  const mutation = useLocalMutation(), files = useAttachmentMutation(), client = useQueryClient(), cache = optimisticCache(client), config = useConfig();
  const note = snapshot.notes.find(note => note.entityType === entity.type && note.entityId === entity.id);
  const links = snapshot.links.filter(link => link.entityType === entity.type && link.entityId === entity.id);
  const attachments = snapshot.attachments.filter(file => file.entityType === entity.type && file.entityId === entity.id);
  const { data: status = emptyMutationStatus } = useQuery<MutationStatus>({ queryKey: mutationStatusKey, enabled: false, queryFn: () => emptyMutationStatus });
  const [draftKey] = useState(`taesks.note:${entity.type}:${entity.id}`);
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) ?? note?.content ?? ""; } catch { return note?.content ?? ""; } });
  const [editing, setEditing] = useState(() => { try { return localStorage.getItem(draftKey) !== null; } catch { return false; } }), [linkForm, setLinkForm] = useState(false), [uploadError, setUploadError] = useState<unknown>(null);
  const [noteError, setNoteError] = useState(() => { try { return localStorage.getItem(draftKey) !== null ? "Unsaved changes." : ""; } catch { return ""; } });
  const [editingLink, setEditingLink] = useState<EntityLink | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), revision = useRef(0);
  const [remove, setRemove] = useState<{ title: string; action: () => Promise<unknown> } | null>(null);
  async function persistNote(content: string, version: number, close = false) {
    try {
      await mutation.mutateAsync({ action: "saveNote", entityType: entity.type, entityId: entity.id, content });
      if (version === revision.current) { try { localStorage.removeItem(draftKey); } catch { /* Confirmed cache content remains. */ } setNoteError(""); if (close) setEditing(false); }
    } catch { if (version === revision.current) { setNoteError("Couldn't save note. Unsaved."); setEditing(true); } }
  }
  function changeNote(content: string) {
    setText(content); const version = ++revision.current;
    try { localStorage.setItem(draftKey, content); if (entity.type === "task") localStorage.setItem(`taesks.note:task:${cache.resolveId(entity.id)}`, content); } catch { setNoteError("Device copy unavailable. Keep this editor open until saved."); }
    if (timer.current) clearTimeout(timer.current);
    // The pending timer deliberately survives panel unmount; the durable device copy also survives reload.
    timer.current = setTimeout(() => { timer.current = null; void persistNote(content, version); }, 500);
  }
  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (timer.current) clearTimeout(timer.current); timer.current = null;
    void persistNote(text, ++revision.current, true);
  }
  async function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form), label = String(data.get("label")), url = String(data.get("url"));
    try {
      await mutation.mutateAsync(editingLink ? { action: "updateLink", id: editingLink.id, label, url } : { action: "addLink", entityType: entity.type, entityId: entity.id, label, url });
      const current = new FormData(form); if (current.get("label") === label && current.get("url") === url) setLinkForm(false);
    } catch { /* Entered link fields stay available. */ }
  }
  return <div className="entity-panel">
    <section className="entity-section"><div className="section-heading"><h2>note {note?.unsaved && <span className="note-save-state">unsaved</span>}</h2><div className="inline-actions"><button className="text-button" onClick={() => { mutation.reset(); setEditing(!editing); }}>{editing ? "Close editor" : note?.content ? "Edit" : "+ note"}</button>{note && <button className="icon-button" aria-label="Delete note" onClick={() => setRemove({ title: "Delete this note?", action: async () => { if (timer.current) clearTimeout(timer.current); timer.current = null; const version = ++revision.current; await mutation.mutateAsync({ action: "deleteNote", entityType: entity.type, entityId: entity.id }); if (revision.current === version) { setText(""); setNoteError(""); try { localStorage.removeItem(draftKey); } catch {} } } })}><Trash2 size={13} /></button>}</div></div>
      {editing ? <form onSubmit={saveNote}><textarea name="content" aria-label="Markdown note" value={text} onChange={event => changeNote(event.target.value)} placeholder="Write in Markdown…" rows={8} autoFocus maxLength={500000} /><div className="editor-footer"><button className="button primary">Save note</button></div></form> : note?.content ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: props => httpUrlSchema.safeParse(props.href).success ? <a href={props.href} target="_blank" rel="noopener noreferrer">{props.children}</a> : <span>{props.children}</span> }}>{note.content}</ReactMarkdown></div> : <p className="muted annotation">{"// no note yet."}</p>}
      {noteError && <p className="error-text" role="alert">{noteError} <button className="text-button" onClick={() => void persistNote(text, ++revision.current, true)}>Retry</button></p>}
    </section>
    <section className="entity-section"><div className="section-heading"><h2>links <span>{links.length}</span></h2><button className="text-button" onClick={() => { mutation.reset(); setEditingLink(null); setLinkForm(!linkForm); }}>{linkForm ? "Cancel" : "+ link"}</button></div>
      {links.map(link => <div className="resource-row" key={link.id}><Link2 size={13} /><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label || new URL(link.url).hostname}</a><button className="text-button" aria-label={`Edit link ${link.label || link.url}`} onClick={() => { setEditingLink(link); setLinkForm(true); }}>Edit</button><button className="icon-button" aria-label={`Delete link ${link.label || link.url}`} onClick={() => setRemove({ title: "Delete this link?", action: () => mutation.mutateAsync({ action: "deleteLink", id: link.id }) })}><Trash2 size={13} /></button></div>)}
      {linkForm && <form key={editingLink?.id ?? "new-link"} className="compact-form" onSubmit={addLink}><label>Label<input name="label" defaultValue={editingLink?.label} maxLength={256} placeholder="Documentation" /></label><label>URL<input type="url" name="url" defaultValue={editingLink?.url} required placeholder="https://" /></label><button className="button">{editingLink ? "Save link" : "Add link"}</button></form>}
    </section>
    <section className="entity-section"><div className="section-heading"><h2>attachments <span>{attachments.length}</span></h2><label className="text-button upload-label"><Paperclip size={12} /> + file<input type="file" aria-label="Upload attachment" onChange={event => { const file = event.target.files?.[0]; setUploadError(null); if (file) { if (file.size > (config.data?.maxUploadBytes ?? 20 * 1024 * 1024)) setUploadError(new Error("This file exceeds the upload limit.")); else files.mutate({ kind: "upload", file, entity }); } event.currentTarget.value = ""; }} /></label></div>
      <InlineError error={uploadError} />
      {attachments.map(file => {
        const operation = status.operations.find(op => op.key === cache.entityKey("attachment", file.clientKey ?? file.id));
        return <div className="resource-row" key={file.clientKey ?? file.id}><FileText size={13} />{file.uploadState ? <span>{file.name}</span> : <a href={`/api/attachments/${encodeURIComponent(file.id)}`} download>{file.name}</a>}<span className="muted">{formatBytes(file.size)}</span>{file.uploadState && <span className="upload-state" role="status">{file.uploadState === "failed" ? "upload failed" : file.uploadState === "queued" ? "queued" : "uploading…"}</span>}
          {file.uploadState === "failed" || file.uploadState === "queued" ? <>{operation && <button className="text-button" onClick={() => void cache.retry(operation.id)}>Retry</button>}<button className="text-button" onClick={() => { if (operation) cache.discard(operation.id); }}>Remove</button></> : <button className="icon-button" aria-label={`Delete attachment ${file.name}`} onClick={() => setRemove({ title: `Delete ${file.name}?`, action: () => files.mutateAsync({ kind: "delete", id: file.clientKey ?? file.id }) })}><Trash2 size={13} /></button>}
        </div>;
      })}
    </section>
    <ConfirmDialog optimistic open={!!remove} onOpenChange={open => { if (!open) setRemove(null); }} title={remove?.title ?? "Delete?"} description="This cannot be undone." onConfirm={async () => { await remove?.action(); }} />
  </div>;
}
function formatBytes(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }
