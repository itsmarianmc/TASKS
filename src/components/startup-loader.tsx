"use client";
import { useTranslation } from "./localization";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StartupStep } from "@/lib/startup-status";

const markers = ["[-]", "[|]", "[/]", "[\\]"];

export function StartupLoader({ steps, ready = false, onRetry, children }: { steps: StartupStep[]; ready?: boolean; onRetry?: () => void; children?: ReactNode }) {
  const { t, text: tx } = useTranslation();
  // Freeze only the presentation at the existing one-time data release.
  const [releasedSteps, setReleasedSteps] = useState<StartupStep[] | null>(null);
  if (ready && !releasedSteps) setReleasedSteps(steps);
  const currentSteps = releasedSteps ?? steps;
  const settled = currentSteps.some(step => step.id === "notion" && (step.state === "done" || step.state === "warning"));
  const [delay, setDelay] = useState({ settled, elapsed: false });
  if (delay.settled !== settled) setDelay({ settled, elapsed: false });
  const [finished, setFinished] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const prepared = ready && delay.elapsed;
  const [hold, setHold] = useState({ prepared, elapsed: false });
  if (hold.prepared !== prepared) setHold({ prepared, elapsed: false });
  const exiting = prepared && hold.elapsed;
  const shownSteps = currentSteps.filter(step => step.id !== "ready" || prepared).map(step =>
    step.id === "prepare" && !prepared ? { ...step, state: "active" as const } : step);
  const active = !finished && shownSteps.some(step => step.state === "active");
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => setDelay({ settled: true, elapsed: true }), 250);
    return () => clearTimeout(timer);
  }, [settled]);
  useEffect(() => {
    if (!prepared) return;
    const timer = setTimeout(() => setHold({ prepared: true, elapsed: true }), 400);
    return () => clearTimeout(timer);
  }, [prepared]);
  useEffect(() => {
    if (!exiting || finished) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const complete = () => setFinished(true);
    if (motion.matches) { complete(); return; }
    // Computed animation durations are seconds; CSS also defines the fallback deadline.
    const duration = parseFloat(getComputedStyle(content.current!).animationDuration) * 1000;
    const timer = setTimeout(complete, duration);
    const update = () => { if (motion.matches) complete(); };
    motion.addEventListener("change", update);
    return () => { clearTimeout(timer); motion.removeEventListener("change", update); };
  }, [exiting, finished]);
  useEffect(() => {
    if (finished) return;
    // inert blocks element input, but not the workspace's window shortcuts.
    const blockShortcuts = (event: KeyboardEvent) => event.stopPropagation();
    window.addEventListener("keydown", blockShortcuts, true);
    return () => window.removeEventListener("keydown", blockShortcuts, true);
  }, [finished]);
  useEffect(() => {
    if (!active) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      setFrame(0);
      if (!motion.matches) timer = setInterval(() => setFrame(value => (value + 1) % markers.length), 200);
    };
    update();
    motion.addEventListener("change", update);
    return () => { if (timer) clearInterval(timer); motion.removeEventListener("change", update); };
  }, [active]);
  return <>
    {children && <div className="startup-workspace" inert={!finished} aria-hidden={!finished}>{children}</div>}
    <div className={finished ? "sr-only startup-announcement" : "boot-screen"} data-phase={finished ? "finished" : exiting ? "exiting" : prepared ? "holding" : "waiting"}>
      <div className="boot-content" ref={content} onAnimationEnd={event => {
        if (exiting && event.target === event.currentTarget && event.animationName === "boot-exit") setFinished(true);
      }}>
        {!finished && <span className="boot-brand">T<span className="brand-mark"><span>[</span><i>Æ</i><span>]</span></span>SKS.</span>}
        <div className="boot-status" role="status" aria-live="polite" aria-atomic="true">
          {shownSteps.map(step => <p className={`boot-line ${step.state}`} key={step.id} data-step={step.id}>
            <span className="boot-marker" aria-hidden="true">{step.state === "active" ? markers[frame] : step.state === "done" ? "[✓]" : "[!]"}</span>
            <span>{tx(step.text)}{step.state === "active" && <span className="boot-cursor" aria-hidden="true">_</span>}</span>
          </p>)}
        </div>
        {!finished && onRetry && <button className="button" onClick={onRetry}>{t("ui.retry_9f5cd8a")}</button>}
      </div>
    </div>
  </>;
}
