import { expect, test } from "@playwright/test";
import { capture, workspace } from "./workspace.fixture";
import { initialSnapshot } from "./startup.fixture";
import { projectView } from "../../src/lib/view-context";

for (const [input, projectId, name, savedAlias] of [
  ["Add Notification in Nook", "nook-project", "Nook", false],
  ["Add Notification for HealthSync", "healthsync-project", "HealthSync", false],
  ["Add Notification to Nook", "nook-project", "Nook", false],
  ["Add Notification in Nook", "nook-project", "Nook App", true],
] as const) {
  test(`quick add previews and creates ${input}${savedAlias ? " via saved alias" : ""}`, async ({ page }) => {
    const state = await workspace(page, false, false, false, false);
    state.graph.projects.push({ ...state.graph.projects[0], id: projectId, name, areaIds: ["work"] });
    state.graph.areas.find(area => area.id === "work")!.projectIds.push(projectId);
    if (savedAlias) state.local.aliases.push({ id: "nook-alias", entityType: "project", entityId: projectId, alias: "Nook" });
    await initialSnapshot(page, state.graph, state.local, projectView("english", "homework"));
    await page.goto("/?view=project&project=english&area=homework");
    await expect(page.locator("h1")).toHaveText(/English/);
    await capture(page, input);
    const dialog = page.getByRole("dialog", { name: "Quick add" });
    await expect(dialog.locator(".preview-title")).toHaveText("Add Notification");
    await expect(dialog.locator(".preview-meta")).toContainText(`$${name}`);
    await expect(dialog.locator(".preview-meta")).toContainText("@Work");
    await expect(dialog.getByLabel("Task project", { exact: true })).toHaveValue(projectId);
    await expect(dialog.getByLabel("Task area", { exact: true })).toHaveValue("work");
    await dialog.getByRole("button", { name: "Create task", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Created in Notion");
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0].task).toMatchObject({ title: "Add Notification", projectId, areaId: "work" });
  });
}
