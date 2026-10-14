import { describe, expect, it } from "vitest";
import { assertSameOrigin, validatedJson, readLimitedBody } from "@/lib/server/http";
import { localMutationSchema, httpUrlSchema, datesSchema } from "@/lib/schemas";
import { sanitizeFilename, validateUploadMime } from "@/lib/server/uploads";

describe("request and upload boundaries", () => {
  it("rejects missing and foreign origins but accepts the app origin", () => {
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/local", { method: "POST" }))).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/local", { method: "POST", headers: { origin: "https://evil.example" } }))).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/local", { method: "POST", headers: { origin: "http://localhost:3000" } }))).not.toThrow();
  });
  it("accepts the browser host when Next uses an internal bind address", () => {
    const headers = { host: "localhost:3001", origin: "http://localhost:3001" };
    expect(() => assertSameOrigin(new Request("http://0.0.0.0:3001/api/local", { method: "POST", headers }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("http://0.0.0.0:3001/api/local", { method: "POST", headers: { ...headers, origin: "http://evil.example" } }))).toThrow();
  });
  it("limits streamed bodies and validates local action fields", async () => {
    const request = new Request("http://localhost:3000/api/local", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ action: "setPreferences", patch: { theme: "light" } }) });
    expect(await validatedJson(request, localMutationSchema)).toEqual({ action: "setPreferences", patch: { theme: "light" } });
    await expect(readLimitedBody(new Request("http://localhost:3000", { method: "POST", body: "12345" }), 4)).rejects.toThrow("size limit");
    expect(localMutationSchema.safeParse({ action: "setTaskMetadata", taskId: "t", patch: { title: "core overwrite" } }).success).toBe(false);
  });
  it("rejects unsafe URLs and backwards ranges", () => {
    for (const url of ["", "not a URL", "http://[bad", "javascript:alert(1)", "data:text/html,hello", "https://user:password@example.com"]) expect(httpUrlSchema.safeParse(url).success).toBe(false);
    expect(httpUrlSchema.safeParse("https://example.com/docs").success).toBe(true);
    expect(datesSchema.safeParse({ start: "2026-10-10", end: "2026-10-01" }).success).toBe(false);
    expect(datesSchema.safeParse({ start: "2026-02-30", end: null }).success).toBe(false);
  });
  it("strips traversal and controls from filenames", () => {
    expect(sanitizeFilename("../../secret.txt")).toBe("secret.txt");
    expect(sanitizeFilename("C:\\folder\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("\u0000<script>.txt")).toBe("__script_.txt");
  });
  it("checks signatures and prevents active HTML/SVG content types", () => {
    expect(validateUploadMime(Buffer.from("%PDF-1.7 test"), "application/pdf")).toBe("application/pdf");
    expect(validateUploadMime(Buffer.from("plain text"), "text/plain")).toBe("text/plain");
    expect(() => validateUploadMime(Buffer.from("plain text"), "image/png")).toThrow();
    expect(() => validateUploadMime(Buffer.from("<svg onload='alert(1)'/>"), "image/svg+xml")).toThrow();
    expect(() => validateUploadMime(Buffer.from("<script>alert(1)</script>"), "text/html")).toThrow();
  });
});
