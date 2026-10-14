"use client";
import { useEffect, useState, useSyncExternalStore, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readDeviceDrafts, syncDeviceDrafts } from "@/lib/device-drafts";
import { useCachedRead, useOnline } from "@/lib/connectivity";
import { queryKeys } from "@/lib/queries";
import { optimisticCache } from "@/lib/optimistic";
import type { LocalSnapshot } from "@/lib/types";
import { disablePush, enablePush, loadPushConfig, pushPrerequisite, refreshPushRegistration, usePushRegistered } from "@/lib/push-client";
import type { PushPublicConfig } from "@/lib/push-contracts";

function subscribe(callback: () => void) { window.addEventListener("storage", callback); window.addEventListener("taesks-device-drafts", callback); return () => { window.removeEventListener("storage", callback); window.removeEventListener("taesks-device-drafts", callback); }; }
export function useDeviceDrafts() {
  const value = useSyncExternalStore(subscribe, () => { try { return JSON.stringify(readDeviceDrafts()); } catch { return "[]"; } }, () => "[]");
  return useMemo(() => JSON.parse(value) as ReturnType<typeof readDeviceDrafts>, [value]);
}
export function PwaRuntime() {
  const client = useQueryClient(); const online = useOnline(); const entries = useDeviceDrafts();
  const [error, setError] = useState("");
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => { /* Settings explains browser constraints. */ });
    const refresh = () => { void refreshPushRegistration().catch(() => undefined); };
    refresh(); const timer = setInterval(refresh, 60_000); window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    if (!online || !entries.length) return;
    let active = true;
    const sync = () => { void syncDeviceDrafts(snapshot => optimisticCache(client).merge<LocalSnapshot>(queryKeys.local, old => old && { ...old, drafts: snapshot.drafts })).then(() => { if (active) setError(""); }).catch(() => { if (active) setError("Drafts waiting to sync. Retrying while TÆSKS is open."); }); };
    sync(); const interval = window.setInterval(sync, 15_000); return () => { active = false; clearInterval(interval); };
  }, [online, entries, client]);
  return error && entries.length ? <p className="device-sync-status" role="status">{error}</p> : null;
}
export function OfflineBanner() {
  const online = useOnline(); const at = useCachedRead();
  return !online || at ? <p className="offline-banner" role="status">{!online ? "Offline" : "Offline copy"}{at ? ` · saved ${new Date(at).toLocaleString()}` : ""} · changes can wait for a connection. Drafts stay on this device.</p> : null;
}
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function PwaSettings() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null); const [status, setStatus] = useState("Checking browser support…");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const registered = usePushRegistered();
  const [config, setConfig] = useState<PushPublicConfig | null>(null);
  const [prerequisite, setPrerequisite] = useState<string | null>("Checking push support…");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [hasSubscription, setHasSubscription] = useState(false);
  useEffect(() => {
    const update = () => { setPrerequisite(pushPrerequisite()); setPermission(window.isSecureContext && "Notification" in window ? Notification.permission : "unsupported"); setStatus(window.matchMedia("(display-mode: standalone)").matches ? "Installed" : !window.isSecureContext ? "Installation and offline caching need HTTPS or localhost." : /iPad|iPhone|iPod/.test(navigator.userAgent) ? "Safari: Share → Add to Home Screen." : "Install from your browser menu, if available."); };
    update(); const install = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); }; const installed = () => { setPrompt(null); update(); };
    window.addEventListener("beforeinstallprompt", install); window.addEventListener("appinstalled", installed); window.addEventListener("focus", update);
    return () => { window.removeEventListener("beforeinstallprompt", install); window.removeEventListener("appinstalled", installed); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const value = await loadPushConfig(); if (active) setConfig(value);
        if (window.isSecureContext && "serviceWorker" in navigator) {
          const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager?.getSubscription();
          if (active) setHasSubscription(!!subscription);
          await refreshPushRegistration();
        }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "Could not check push registration."); }
    };
    void refresh(); window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, []);
  const changePush = async (enabled: boolean) => {
    setBusy(true); setError("");
    try { if (enabled && config) await enablePush(config); else await disablePush(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Push setup failed. Try again."); }
    finally {
      setPermission("Notification" in window ? Notification.permission : "unsupported");
      try { if ("serviceWorker" in navigator) setHasSubscription(!!await (await navigator.serviceWorker.getRegistration())?.pushManager?.getSubscription()); }
      catch { /* Keep the preceding actionable error and allow another attempt. */ }
      finally { setBusy(false); }
    }
  };
  return <section className="settings-section"><h2>app & reminders</h2><p className="muted">{status}</p>{prompt && <button className="button" onClick={async () => { await prompt.prompt(); await prompt.userChoice; setPrompt(null); }}>Install TÆSKS</button>}
    <div className="setting-line"><span>Push on this device</span><span>{registered ? config && !config.available ? "Paused" : "Enabled" : "Off"}</span></div>
    <p className="muted">{prerequisite || (config ? config.reason || "Reminders can arrive while TÆSKS is closed." : "Checking server configuration…")}</p>
    {!registered && !prerequisite && config?.available && permission !== "denied" && <button className="button" disabled={busy} onClick={() => { void changePush(true); }}>{busy ? "Saving…" : "Enable push"}</button>}
    {(registered || hasSubscription) && <button className="button" disabled={busy} onClick={() => { void changePush(false); }}>{busy ? "Saving…" : "Disable push"}</button>}
    {permission === "denied" && <p className="muted">Notifications are blocked. Allow them in browser or device settings.</p>}
    {error && <p role="alert">{error} <button className="text-button" disabled={busy} onClick={() => { setError(""); void loadPushConfig().then(setConfig).catch(failure => setError(failure.message)); }}>Retry check</button></p>}
    <div className="setting-line"><span>Browser permission</span><span>{permission}</span></div>
    {permission === "default" && (prerequisite === "Push is available in the production app." || !prerequisite && config && !config.available) && <button className="button" onClick={async () => { try { setPermission(await Notification.requestPermission()); } catch { setPermission("unsupported"); } }}>Enable open-app notifications</button>}
    <p className="muted">In-app reminders remain available. Push messages contain no task titles or notes.</p><p className="muted">Offline content requires a previous visit. Files need a connection. Drafts sync when online; create tasks manually.</p></section>;
}
