"use client";
import { useSyncExternalStore } from "react";
import type { PushPublicConfig } from "./push-contracts";

const TOKEN = "taesks.push.device";
const CONFIRMED = "taesks.push.confirmed";
const EVENT = "taesks-push-change";
let revision = 0;
function confirmed() { try { return localStorage.getItem(CONFIRMED) || ""; } catch { return ""; } }
export function hasConfirmedPush() { return !!confirmed(); }
function subscribe(callback: () => void) { window.addEventListener(EVENT, callback); window.addEventListener("storage", callback); return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", callback); }; }
export function usePushRegistered() { return !!useSyncExternalStore(subscribe, confirmed, () => ""); }
function mark(endpoint: string | null) {
  revision++;
  if (endpoint) localStorage.setItem(CONFIRMED, endpoint); else localStorage.removeItem(CONFIRMED);
  window.dispatchEvent(new Event(EVENT));
}
function deviceToken(create = false) {
  let token = localStorage.getItem(TOKEN);
  if (!token && create) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(TOKEN, token);
  }
  return token;
}
export function pushPrerequisite(): string | null {
  if (!window.isSecureContext) return "Push needs HTTPS. Open the secure TÆSKS address.";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (appleMobile && !standalone) return "On iPhone or iPad: Share → Add to Home Screen, then open TÆSKS there.";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "This browser does not support push. In-app reminders remain available.";
  if (process.env.NODE_ENV !== "production") return "Push is available in the production app.";
  return null;
}
export async function loadPushConfig(): Promise<PushPublicConfig> {
  const response = await pushRequest({ cache: "no-store", credentials: "same-origin" });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Could not reach TÆSKS. Check your connection and Cloudflare Access session.");
  const value = await response.json();
  if (typeof value.available !== "boolean" || !(value.publicKey === null || typeof value.publicKey === "string") || !(value.reason === null || typeof value.reason === "string") || value.available && !value.publicKey) throw new Error("Could not check the server push configuration. Retry after signing in.");
  return { available: value.available, publicKey: value.publicKey, reason: value.reason };
}
async function pushRequest(options: RequestInit) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try { return await fetch("/api/push", { ...options, signal: controller.signal }); }
  catch { throw new Error("Could not reach TÆSKS. Check your connection and Cloudflare Access session."); }
  finally { clearTimeout(timer); }
}
async function action(body: object): Promise<{ registered: boolean }> {
  const response = await pushRequest({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Could not reach TÆSKS. Check your connection and Cloudflare Access session.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Push setup failed. Try again.");
  if (typeof result.registered !== "boolean") throw new Error("Could not confirm this device's push registration. Retry.");
  return result;
}
export async function refreshPushRegistration() {
  if (!("serviceWorker" in navigator)) { mark(null); return false; }
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager?.getSubscription();
  const token = deviceToken();
  if (!subscription || !token || !("Notification" in window) || Notification.permission !== "granted") { mark(null); return false; }
  // An unavailable network retains the last confirmed registration for this endpoint.
  if (confirmed() && confirmed() !== subscription.endpoint) mark(null);
  const checkedRevision = revision;
  const result = await action({ action: "status", deviceToken: token, endpoint: subscription.endpoint });
  if (checkedRevision !== revision) return hasConfirmedPush();
  mark(result.registered ? subscription.endpoint : null);
  return result.registered;
}
async function pushWorker() {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const ready = registration.active ? registration : await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The app worker is not ready. Reload TÆSKS and retry.")), 10_000)),
  ]);
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Close all TÆSKS windows, reopen the app and retry to finish its push update.")); }, 2_000);
    channel.port1.onmessage = event => { if (event.data?.pushVersion === 1) { clearTimeout(timer); channel.port1.close(); resolve(); } };
    ready.active?.postMessage({ type: "push-capability" }, [channel.port2]);
  });
  return ready;
}
function publicKeyBytes(key: string) { return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0)); }
// Called only by the explicit settings button. Permission is requested before any await.
export async function enablePush(config: PushPublicConfig) {
  const prerequisite = pushPrerequisite();
  if (prerequisite) throw new Error(prerequisite);
  if (!config.available || !config.publicKey) throw new Error(config.reason || "Push is not configured.");
  const token = deviceToken(true)!;
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") throw new Error("Allow notifications in browser or device settings, then retry.");
  const registration = await pushWorker();
  const key = publicKeyBytes(config.publicKey);
  let subscription = await registration.pushManager.getSubscription();
  const previousKey = subscription?.options.applicationServerKey;
  if (subscription && (!previousKey || Array.from(new Uint8Array(previousKey)).join(",") !== Array.from(key).join(","))) {
    if (!await subscription.unsubscribe()) throw new Error("Could not replace the browser subscription. Retry.");
    mark(null); subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await action({ action: "register", deviceToken: token, subscription: subscription.toJSON() });
  mark(subscription.endpoint);
}
export async function disablePush() {
  const token = deviceToken();
  // Stop server delivery first. A network error leaves the registration visibly active.
  if (token) await action({ action: "revoke", deviceToken: token });
  mark(null);
  const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (subscription && !await subscription.unsubscribe()) throw new Error("Server push is off. The browser subscription could not be removed; retry.");
}
