"use client";
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api-client";
import { optimisticCache, type Operation } from "./optimistic";
import { queryKeys } from "./queries";
import { replaceWhere } from "./local-intents";
import type { Attachment, EntityRef, LocalSnapshot } from "./types";
import { clientId } from "./client-id";

type AttachmentAction = { kind: "upload"; file: File; entity: EntityRef } | { kind: "delete"; id: string };
export function useAttachmentMutation() {
  const client = useQueryClient(), cache = optimisticCache(client);
  const operations = useRef(new WeakMap<AttachmentAction, Operation<Attachment | null>>()).current;
  return useMutation({
    onMutate: (action: AttachmentAction) => {
      const id = action.kind === "upload" ? `temp:${clientId()}` : action.id, now = new Date().toISOString();
      const op = cache.begin<Attachment | null>({
        key: cache.entityKey("attachment", id), targets: [queryKeys.local],
        apply: (data, _key, state) => {
          if (!data) return data; const local = data as LocalSnapshot;
          return { ...local, attachments: action.kind === "delete" ? local.attachments.filter(item => item.id !== cache.resolveId(id) && item.clientKey !== id) : replaceWhere(local.attachments, item => item.id === id, [{ id, clientKey: id, entityType: action.entity.type, entityId: cache.resolveId(action.entity.id), name: action.file.name, mimeType: action.file.type, size: action.file.size, createdAt: now, uploadState: state === "pending" ? "uploading" : state === "offline" ? "queued" : "failed" }]) };
        },
        request: async () => {
          if (action.kind === "delete") { const real = cache.resolveId(id); if (real.startsWith("temp:")) throw new Error("Upload was not confirmed."); await apiRequest(`/api/attachments/${encodeURIComponent(real)}`, { method: "DELETE", body: JSON.stringify({ confirmed: true }) }); return null; }
          const body = new FormData(); body.set("file", action.file); body.set("entityType", action.entity.type); body.set("entityId", action.entity.type === "task" ? await cache.confirmedEntityId(action.entity.id) : action.entity.id);
          return apiRequest<Attachment>("/api/attachments", { method: "POST", body });
        },
        reconcile: (data, result) => {
          if (result) cache.assignId(id, result.id);
          if (!data) return data; const local = data as LocalSnapshot;
          return { ...local, attachments: replaceWhere(local.attachments, item => item.id === id || item.id === cache.resolveId(id), result ? [{ ...result, clientKey: id }] : []) };
        },
        errorMessage: action.kind === "upload" ? "Couldn't upload file." : "Couldn't delete file.", keepOnError: action.kind === "upload",
      });
      operations.set(action, op); return op;
    },
    mutationFn: (action: AttachmentAction) => cache.request(operations.get(action)!),
    onSuccess: (result, _action, op) => cache.succeed(op, result),
    onError: (error, _action, op) => { if (op) cache.fail(op, error); },
    onSettled: (_result, _error, _action, op) => op?.release(), retry: false,
  });
}
