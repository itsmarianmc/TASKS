"use client";
import { useEffect, useRef, useState } from "react";
import { validatedDateDraft } from "@/lib/calendar";
import { useTranslation } from "./localization";

/** Native date inputs may emit years with more than four digits. Keep those drafts out of shared state. */
export function DateInput({ value, onChange, label }: { value: string | null; onChange: (date: string | null) => void; label: string }) {
  const { t } = useTranslation();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const field = fieldRef.current;
    if (field && document.activeElement !== field) field.value = value ?? "";
  }, [value]);
  function validate(field: HTMLInputElement, commit: boolean) {
    const validated = validatedDateDraft(field.value, field.validity.badInput);
    const invalid = validated === undefined;
    field.setCustomValidity(invalid ? t("date.invalid") : "");
    setInvalid(invalid);
    if (commit && validated !== undefined && validated !== value) onChange(validated);
  }
  // The browser owns segmented drafts; a controlled empty value would erase partially typed segments.
  return <input ref={fieldRef} aria-label={label} title={invalid ? t("date.invalid") : undefined} type="date" min="0100-01-01" max="9999-12-31" defaultValue={value ?? ""} aria-invalid={invalid || undefined}
    onChange={event => validate(event.currentTarget, false)}
    // The inspector must see the committed date before its debounced save, rather than saving the old date during bubbling.
    onBlur={event => { event.stopPropagation(); validate(event.currentTarget, true); }}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); validate(event.currentTarget, true); } }} />;
}
