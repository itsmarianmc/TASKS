"use client";
import { useTranslation } from "./localization";

export function TerminalToggle({ label, checked, onChange, compact = false, disabled = false, title }: { label: string; checked: boolean; onChange: (checked: boolean) => void; compact?: boolean; disabled?: boolean; title?: string }) {
  const { t } = useTranslation();
  return <button type="button" role="checkbox" aria-label={label} aria-checked={checked} disabled={disabled} title={title} className={`terminal-toggle ${compact ? "compact" : ""} ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
    {compact ? <><span>{label}</span><span className="toggle-state" aria-hidden="true">[{checked ? t("ui.on") : t("ui.off_da7a687")}]</span></> : <><span>{label}</span><span className="toggle-state" aria-hidden="true">[{checked ? t("ui.on") : t("ui.off_da7a687")}]</span></>}
  </button>;
}
