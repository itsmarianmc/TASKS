"use client";

export function TerminalToggle({ label, checked, onChange, compact = false, disabled = false, title }: { label: string; checked: boolean; onChange: (checked: boolean) => void; compact?: boolean; disabled?: boolean; title?: string }) {
  return <button type="button" role="checkbox" aria-label={label} aria-checked={checked} disabled={disabled} title={title} className={`terminal-toggle ${compact ? "compact" : ""} ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
    {compact ? <><span>{label}</span><span className="toggle-state" aria-hidden="true">[{checked ? "on" : "off"}]</span></> : <><span>{label}</span><span className="toggle-state" aria-hidden="true">[{checked ? "on" : "off"}]</span></>}
  </button>;
}
