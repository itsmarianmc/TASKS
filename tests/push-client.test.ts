import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disablePush, enablePush, hasConfirmedPush, pushPrerequisite, refreshPushRegistration } from "@/lib/push-client";

const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const config = { available: true, publicKey, reason: null };
const endpoint = "https://web.push.apple.com/test";
let values: Map<string, string>;
let subscription: { endpoint: string; options: { applicationServerKey: ArrayBuffer }; toJSON: () => object; unsubscribe: ReturnType<typeof vi.fn> } | null;
let registration: { active: object; pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } };
let notification: { permission: string; requestPermission: ReturnType<typeof vi.fn> };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); values = new Map(); subscription = null;
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal("window", { isSecureContext: true, PushManager: {}, Notification: {}, matchMedia: () => ({ matches: false }), dispatchEvent: vi.fn() });
  notification = { permission: "default", requestPermission: vi.fn(async () => { notification.permission = "granted"; return "granted"; }) };
  vi.stubGlobal("Notification", notification);
  registration = { active: { postMessage: (_body: object, ports: { postMessage: (value: object) => void }[]) => ports[0].postMessage({ pushVersion: 1 }) }, pushManager: {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async () => {
      subscription = { endpoint, options: { applicationServerKey: Uint8Array.from(Buffer.from(publicKey, "base64url")).buffer }, toJSON: () => ({ endpoint, keys: { p256dh: publicKey, auth: Buffer.alloc(16, 1).toString("base64url") } }), unsubscribe: vi.fn(async () => { subscription = null; return true; }) }; return subscription;
    }),
  } };
  vi.stubGlobal("navigator", { userAgent: "Desktop", platform: "Windows", maxTouchPoints: 0, serviceWorker: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) } });
  vi.stubGlobal("MessageChannel", class {
    port1 = { onmessage: null as null | ((event: { data: object }) => void), close: vi.fn() };
    port2 = { postMessage: (data: object) => this.port1.onmessage?.({ data }) };
  });
  fetcher = vi.fn(async () => Response.json({ registered: true })); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("device push flow with browser fakes", () => {
  it("requires secure, supported installed iOS context without prompting", () => {
    expect(pushPrerequisite()).toBeNull();
    Object.defineProperty(navigator, "userAgent", { value: "iPhone", configurable: true });
    expect(pushPrerequisite()).toContain("Home Screen");
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    expect(pushPrerequisite()).toBeNull();
    window.isSecureContext = false; expect(pushPrerequisite()).toContain("HTTPS");
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });
  it("requests permission synchronously from enable and confirms only after server ACK", async () => {
    const work = enablePush(config);
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(hasConfirmedPush()).toBe(false); await work;
    expect(hasConfirmedPush()).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "register", deviceToken: expect.stringMatching(/^[a-f0-9]{64}$/), subscription: { endpoint } });
    await enablePush(config); expect(notification.requestPermission).toHaveBeenCalledTimes(1); expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });
  it("preserves the subscription for retry after uncertain server failure without claiming success", async () => {
    fetcher.mockRejectedValue(new Error("Offline")); await expect(enablePush(config)).rejects.toThrow("Could not reach"); expect(hasConfirmedPush()).toBe(false); expect(subscription).not.toBeNull();
    fetcher.mockResolvedValue(Response.json({ registered: true })); await enablePush(config); expect(hasConfirmedPush()).toBe(true);
  });
  it("rechecks on resume and keeps confirmed suppression during a network outage", async () => {
    await enablePush(config); fetcher.mockRejectedValue(new Error("Offline")); await expect(refreshPushRegistration()).rejects.toThrow(); expect(hasConfirmedPush()).toBe(true);
    fetcher.mockResolvedValue(Response.json({ registered: false })); await refreshPushRegistration(); expect(hasConfirmedPush()).toBe(false);
  });
  it("does not unsubscribe or clear server status when revocation fails", async () => {
    await enablePush(config); const unsubscribe = subscription!.unsubscribe; fetcher.mockRejectedValue(new Error("Offline")); await expect(disablePush()).rejects.toThrow(); expect(hasConfirmedPush()).toBe(true); expect(unsubscribe).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(Response.json({ registered: false })); await disablePush(); expect(hasConfirmedPush()).toBe(false); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it("keeps permission prompts out of unsupported and unconfigured flows", async () => {
    await expect(enablePush({ available: false, publicKey: null, reason: "No configuration" })).rejects.toThrow("No configuration");
    window.isSecureContext = false; await expect(enablePush(config)).rejects.toThrow("HTTPS"); expect(notification.requestPermission).not.toHaveBeenCalled();
  });
});
