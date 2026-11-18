"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  ClipboardList,
  CheckSquare,
  Plus,
  UserCheck,
  RotateCcw,
  FileCheck2,
  ScanSearch,
  AlertCircle,
  Check,
  PenTool,
  Calendar,
  Type,
  ChevronRight,
  Trash2,
} from "lucide-react";
import type { Viewer } from "@embedpdf/viewer/core";
import type { FormField, FormFieldValue } from "@embedpdf/plugin-form";
import {
  AutofillProfile,
  EMPTY_AUTOFILL_PROFILE,
  getAutofillProfile,
  saveAutofillProfile,
} from "@/lib/localDb";
import { formatFieldLabel, matchProfileValueForField } from "@/lib/formAutofill";
import { detectFormFieldsOnPage } from "@/lib/formDetector";

export interface FormFillerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  viewer: Viewer | null;
  pdfBlob: Blob | null;
  currentPageIndex: number;
  fields: readonly FormField[];
  onFieldsChanged: () => void;
  onFlattenRequest: () => void;
  onOpenSignature: () => void;
  onNotify: (message: string, type?: "success" | "error" | "info") => void;
}

type PanelTab = "fill" | "build" | "profile";

export function FormFillerPanel({
  isOpen,
  onClose,
  viewer,
  pdfBlob,
  currentPageIndex,
  fields,
  onFieldsChanged,
  onFlattenRequest,
  onOpenSignature,
  onNotify,
}: FormFillerPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("fill");
  const [profile, setProfile] = useState<AutofillProfile>(EMPTY_AUTOFILL_PROFILE);
  const [profileSaved, setProfileSaved] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [missingNames, setMissingNames] = useState<Set<string>>(new Set());
  const [customFieldLabel, setCustomFieldLabel] = useState("");
  const inputRefs = useRef<Record<string, HTMLElement | null>>({});

  // Load Autofill Profile when panel opens
  useEffect(() => {
    if (isOpen) {
      getAutofillProfile().then(setProfile);
      // If document has zero AcroForm fields, default user to the Make Fillable tab helper hint or stay on fill with clear CTA
      if (fields.length === 0) {
        setActiveTab("build");
      } else {
        setActiveTab("fill");
      }
    }
  }, [isOpen, fields.length]);

  const fillableFields = useMemo(
    () => fields.filter((f) => f.kind !== "pushbutton"),
    [fields]
  );

  const filledCount = useMemo(() => {
    return fillableFields.filter((f) => {
      if (f.kind === "text") return f.value.trim().length > 0;
      if (f.kind === "checkbox") return f.checked;
      if (f.kind === "radio") return f.value && f.value !== "Off";
      if (f.kind === "combobox") return f.value.trim().length > 0;
      if (f.kind === "listbox") return f.selectedValues.length > 0;
      return false;
    }).length;
  }, [fillableFields]);

  const progressPct =
    fillableFields.length > 0
      ? Math.round((filledCount / fillableFields.length) * 100)
      : 0;

  if (!isOpen) return null;

  const getForm = () => {
    if (!viewer) return null;
    try {
      return viewer.tryGet("form");
    } catch {
      return null;
    }
  };

  const handleSetFieldValue = async (field: FormField, value: FormFieldValue) => {
    const form = getForm();
    if (!form) return;
    try {
      await form.setValue(field.ref, value);
      if (missingNames.has(field.name)) {
        setMissingNames((prev) => {
          const next = new Set(prev);
          next.delete(field.name);
          return next;
        });
      }
      onFieldsChanged();
    } catch (err: any) {
      onNotify(err?.message || "Could not update field", "error");
    }
  };

  const handleFocusField = (field: FormField) => {
    const form = getForm();
    if (!form) return;
    try {
      form.focus(field.ref);
    } catch {
      // Field may not have a visible widget on current layout
    }
  };

  const handleAdvanceNext = (idx: number) => {
    const nextField = fillableFields[idx + 1];
    if (nextField) {
      handleFocusField(nextField);
      const el = inputRefs.current[nextField.name];
      if (el && typeof el.focus === "function") {
        el.focus();
      }
    }
  };

  const handleSmartAutofill = async () => {
    const form = getForm();
    if (!form) return;

    const entries: { ref: FormField["ref"]; value: FormFieldValue }[] = [];
    for (const field of fillableFields) {
      if (field.readOnly) continue;
      if (field.kind === "text" || (field.kind === "combobox" && field.edit)) {
        const matched = matchProfileValueForField(
          field.name,
          field.alternateName,
          profile
        );
        if (matched) {
          entries.push({ ref: field.ref, value: { value: matched } });
        }
      }
    }

    if (entries.length === 0) {
      const hasAnyProfileData = Object.entries(profile).some(
        ([k, v]) => k !== "updatedAt" && typeof v === "string" && v.trim().length > 0
      );
      if (!hasAnyProfileData) {
        setActiveTab("profile");
        onNotify("Add your details in 'My Info' first to enable 1-click autofill.", "info");
      } else {
        onNotify("No matching text fields found for your saved profile.", "info");
      }
      return;
    }

    try {
      await form.setValues(entries);
      onFieldsChanged();
      onNotify(`Autofilled ${entries.length} field${entries.length === 1 ? "" : "s"}`, "success");
    } catch (err: any) {
      onNotify(`Autofill failed: ${err?.message || "Unknown error"}`, "error");
    }
  };

  const handleValidate = () => {
    const form = getForm();
    if (!form) return;
    const result = form.validate();
    if (result.valid) {
      setMissingNames(new Set());
      onNotify("All required fields are filled.", "success");
    } else {
      const names = new Set(result.missing.map((m) => m.name));
      setMissingNames(names);
      if (result.missing[0]) {
        handleFocusField(result.missing[0]);
      }
      onNotify(
        `${result.missing.length} required field${result.missing.length === 1 ? " is" : "s are"} empty.`,
        "error"
      );
    }
  };

  const handleResetForm = async () => {
    const form = getForm();
    if (!form) return;
    try {
      await form.reset();
      setMissingNames(new Set());
      onFieldsChanged();
      onNotify("Form fields reset to default values.", "info");
    } catch (err: any) {
      onNotify(`Reset failed: ${err?.message || "Unknown error"}`, "error");
    }
  };

  const handleAutoDetectPageFields = async () => {
    const form = getForm();
    if (!form || !viewer || !pdfBlob) return;

    try {
      setIsDetecting(true);
      const pages = viewer.documents.listPages();
      const targetPage = pages[currentPageIndex] || pages[0];
      if (!targetPage) {
        onNotify("No active page found.", "error");
        return;
      }

      const detected = await detectFormFieldsOnPage(pdfBlob, currentPageIndex);
      if (detected.length === 0) {
        onNotify(
          "No blank lines or checkboxes detected on this page. Use '+ Add Field' below to place one manually.",
          "info"
        );
        return;
      }

      const existingNames = new Set(fields.map((f) => f.name));
      let createdCount = 0;

      for (const draft of detected) {
        let name = draft.name;
        let suffix = 2;
        while (existingNames.has(name)) {
          name = `${draft.name}_${suffix++}`;
        }
        existingNames.add(name);

        try {
          if (draft.kind === "checkbox") {
            await form.create({
              kind: "checkbox",
              name,
              alternateName: draft.label,
              widgets: [
                {
                  page: targetPage.ref,
                  rect: draft.rect,
                  borderStyle: "solid",
                  strokeWidth: 1,
                },
              ],
            });
          } else {
            await form.create({
              kind: "text",
              name,
              alternateName: draft.label,
              widgets: [
                {
                  page: targetPage.ref,
                  rect: draft.rect,
                  fontSize: 11,
                  borderStyle: "underline",
                  strokeWidth: 1,
                },
              ],
            });
          }
          createdCount++;
        } catch (createErr) {
          console.warn("[FormFillerPanel] Skipped detected field:", name, createErr);
        }
      }

      onFieldsChanged();
      if (createdCount > 0) {
        setActiveTab("fill");
        onNotify(
          `Detected & created ${createdCount} fillable field${createdCount === 1 ? "" : "s"} on Page ${currentPageIndex + 1}.`,
          "success"
        );
      } else {
        onNotify("Could not place detected fields on this page.", "info");
      }
    } catch (err: any) {
      onNotify(`Detection error: ${err?.message || "Failed"}`, "error");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleQuickAddField = async (preset: "text" | "checkbox" | "date") => {
    const form = getForm();
    if (!form || !viewer) return;

    const pages = viewer.documents.listPages();
    const targetPage = pages[currentPageIndex] || pages[0];
    if (!targetPage) return;

    const existingNames = new Set(fields.map((f) => f.name));
    const baseLabel =
      customFieldLabel.trim() ||
      (preset === "checkbox" ? "Checkbox" : preset === "date" ? "Date" : "Text Field");
    const baseSlug =
      baseLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || preset;

    let name = baseSlug;
    let n = 2;
    while (existingNames.has(name)) {
      name = `${baseSlug}_${n++}`;
    }

    const offsetStep = (fields.length % 8) * 28;
    const x = 72;
    const y = Math.min(targetPage.size.height - 60, 120 + offsetStep);

    try {
      const res =
        preset === "checkbox"
          ? await form.create({
              kind: "checkbox",
              name,
              alternateName: baseLabel,
              widgets: [
                {
                  page: targetPage.ref,
                  rect: { x, y, width: 18, height: 18 },
                  borderStyle: "solid",
                  strokeWidth: 1,
                },
              ],
            })
          : await form.create({
              kind: "text",
              name,
              alternateName: baseLabel,
              defaultValue: preset === "date" ? new Date().toISOString().slice(0, 10) : "",
              widgets: [
                {
                  page: targetPage.ref,
                  rect: { x, y, width: preset === "date" ? 130 : 220, height: 22 },
                  fontSize: 11,
                  borderStyle: "solid",
                  strokeWidth: 1,
                },
              ],
            });

      if (preset === "date") {
        await form.setValue(res.field.ref, {
          value: new Date().toISOString().slice(0, 10),
        });
      }

      setCustomFieldLabel("");
      onFieldsChanged();
      setActiveTab("fill");
      form.focus(res.field.ref);
      onNotify(`Added "${baseLabel}" to Page ${currentPageIndex + 1}`, "success");
    } catch (err: any) {
      onNotify(`Could not add field: ${err?.message || "Error"}`, "error");
    }
  };

  const handleDeleteField = async (field: FormField) => {
    const form = getForm();
    if (!form) return;
    try {
      await form.delete(field.ref);
      onFieldsChanged();
      onNotify(`Removed "${formatFieldLabel(field.name, field.alternateName)}"`, "info");
    } catch (err: any) {
      onNotify(`Could not delete field: ${err?.message || "Error"}`, "error");
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await saveAutofillProfile(profile);
    setProfile(saved);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
    onNotify("Autofill profile saved locally to IndexedDB.", "success");
  };

  return (
    <aside className="fixed inset-x-0 bottom-0 top-14 md:static md:w-[360px] md:inset-auto border-l border-white/[0.08] bg-[#0c0d12] flex flex-col z-40 shrink-0 shadow-2xl md:shadow-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-[#09090b]">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-4 h-4 text-zinc-300 shrink-0" />
          <span className="text-xs font-semibold text-zinc-100 truncate">
            Form Studio
          </span>
          {fillableFields.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums bg-white/[0.08] text-zinc-200 border border-white/10">
              {filledCount}/{fillableFields.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Close Form Studio"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Segmented Tabs */}
      <div className="px-3 pt-3 pb-2 border-b border-white/[0.06]">
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#111113] border border-white/[0.07]">
          {(
            [
              { id: "fill", label: `Fill (${fillableFields.length})` },
              { id: "build", label: "Add Fields" },
              { id: "profile", label: "My Info" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium tabular-nums transition-[transform,background-color,color] duration-150 cursor-pointer active:scale-[0.98] ${
                activeTab === tab.id
                  ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* ======================================================= */}
        {/* TAB 1: GUIDED FORM FILLER                               */}
        {/* ======================================================= */}
        {activeTab === "fill" && (
          <>
            {fillableFields.length === 0 ? (
              <div className="rounded-[18px] border border-white/[0.08] bg-[#111113] p-4 space-y-3 text-center">
                <p className="text-xs font-medium text-zinc-200">
                  No interactive form fields detected in this PDF.
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  If this is a flat or scanned form, switch to{" "}
                  <strong className="text-zinc-200">Add Fields</strong> to
                  auto-detect blank lines and checkboxes or place inputs anywhere.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("build")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#fafafa] text-zinc-950 text-xs font-semibold hover:bg-white transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <ScanSearch className="w-3.5 h-3.5" />
                  <span>Auto-Detect Fields</span>
                </button>
              </div>
            ) : (
              <>
                {/* Progress & Quick Actions */}
                <div className="rounded-[16px] border border-white/[0.08] bg-[#111113] p-3 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Completion</span>
                    <span className="font-mono tabular-nums text-zinc-200 font-semibold">
                      {progressPct}% ({filledCount}/{fillableFields.length})
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 transition-[width] duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={handleSmartAutofill}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-[#fafafa] text-zinc-950 font-semibold hover:bg-white transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Smart Autofill</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleValidate}
                      className="py-1.5 px-2.5 rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                      title="Check required fields"
                    >
                      Check
                    </button>
                    <button
                      type="button"
                      onClick={handleResetForm}
                      className="p-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                      title="Reset all fields"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Guided Field Inputs */}
                <div className="space-y-2.5">
                  {fillableFields.map((field, idx) => {
                    const label = formatFieldLabel(field.name, field.alternateName);
                    const isMissing = missingNames.has(field.name);

                    return (
                      <div
                        key={field.name}
                        className={`rounded-xl border p-3 space-y-2 transition-colors ${
                          isMissing
                            ? "border-red-500/50 bg-red-950/15"
                            : "border-white/[0.07] bg-[#111113] focus-within:border-white/25"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleFocusField(field)}
                            className="flex items-center gap-1.5 text-left text-[11px] font-medium text-zinc-200 hover:text-white truncate cursor-pointer"
                            title={`Jump to ${label} on PDF`}
                          >
                            <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <span className="truncate">{label}</span>
                            {field.required && (
                              <span className="text-red-400 font-bold">*</span>
                            )}
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleFocusField(field)}
                              className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] cursor-pointer"
                              title="Locate on page"
                            >
                              <ChevronRight className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteField(field)}
                              className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-white/[0.06] cursor-pointer"
                              title="Delete field"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {field.kind === "text" && (
                          field.multiline ? (
                            <textarea
                              ref={(el) => {
                                inputRefs.current[field.name] = el;
                              }}
                              rows={3}
                              disabled={field.readOnly}
                              value={field.value}
                              onFocus={() => handleFocusField(field)}
                              onChange={(e) =>
                                handleSetFieldValue(field, { value: e.target.value })
                              }
                              placeholder={`Enter ${label.toLowerCase()}...`}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/50 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35 resize-y"
                            />
                          ) : (
                            <input
                              ref={(el) => {
                                inputRefs.current[field.name] = el;
                              }}
                              type={field.password ? "password" : "text"}
                              disabled={field.readOnly}
                              value={field.value}
                              onFocus={() => handleFocusField(field)}
                              onChange={(e) =>
                                handleSetFieldValue(field, { value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAdvanceNext(idx);
                                }
                              }}
                              placeholder={`Enter ${label.toLowerCase()}...`}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/50 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35"
                            />
                          )
                        )}

                        {field.kind === "checkbox" && (
                          <label className="flex items-center gap-2.5 cursor-pointer py-0.5">
                            <input
                              ref={(el) => {
                                inputRefs.current[field.name] = el;
                              }}
                              type="checkbox"
                              disabled={field.readOnly}
                              checked={field.checked}
                              onFocus={() => handleFocusField(field)}
                              onChange={(e) =>
                                handleSetFieldValue(field, {
                                  checked: e.target.checked,
                                })
                              }
                              className="w-4 h-4 rounded border-white/20 bg-black accent-emerald-500 cursor-pointer"
                            />
                            <span className="text-xs text-zinc-300">
                              {field.checked ? "Checked" : "Unchecked"}
                            </span>
                          </label>
                        )}

                        {field.kind === "radio" && (
                          <div className="flex flex-wrap gap-1.5">
                            {Array.from(
                              new Set(
                                field.widgets
                                  .map((w) => w.exportValue)
                                  .filter((v) => v && v !== "Off")
                              )
                            ).map((opt) => {
                              const selected = field.value === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={field.readOnly}
                                  onClick={() =>
                                    handleSetFieldValue(field, {
                                      value: selected && !field.noToggleToOff ? "Off" : opt,
                                    })
                                  }
                                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                                    selected
                                      ? "border-white/30 bg-white/[0.14] text-white"
                                      : "border-white/10 bg-black/40 text-zinc-400 hover:text-zinc-200"
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {field.kind === "combobox" && (
                          <select
                            ref={(el) => {
                              inputRefs.current[field.name] = el;
                            }}
                            disabled={field.readOnly}
                            value={field.value}
                            onFocus={() => handleFocusField(field)}
                            onChange={(e) =>
                              handleSetFieldValue(field, { value: e.target.value })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/60 text-xs text-white focus:outline-none focus:border-white/35"
                          >
                            <option value="">Select option...</option>
                            {field.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label || o.value}
                              </option>
                            ))}
                          </select>
                        )}

                        {field.kind === "listbox" && (
                          <div className="flex flex-wrap gap-1.5">
                            {field.options.map((o) => {
                              const active = field.selectedValues.includes(o.value);
                              return (
                                <button
                                  key={o.value}
                                  type="button"
                                  disabled={field.readOnly}
                                  onClick={() => {
                                    const next = field.multiSelect
                                      ? active
                                        ? field.selectedValues.filter((v) => v !== o.value)
                                        : [...field.selectedValues, o.value]
                                      : [o.value];
                                    handleSetFieldValue(field, {
                                      selectedValues: next,
                                    });
                                  }}
                                  className={`px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer ${
                                    active
                                      ? "border-white/30 bg-white/[0.14] text-white"
                                      : "border-white/10 bg-black/40 text-zinc-400"
                                  }`}
                                >
                                  {o.label || o.value}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {field.kind === "signature" && (
                          <button
                            type="button"
                            onClick={onOpenSignature}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] text-zinc-200 hover:bg-white/[0.1] cursor-pointer"
                          >
                            <PenTool className="w-3.5 h-3.5" />
                            <span>Open E-Signature Studio</span>
                          </button>
                        )}

                        {isMissing && (
                          <div className="flex items-center gap-1 text-[10px] text-red-400">
                            <AlertCircle className="w-3 h-3" />
                            <span>Required field</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ======================================================= */}
        {/* TAB 2: MAKE ANY FLAT PDF FILLABLE (DETECT + ADD FIELDS) */}
        {/* ======================================================= */}
        {activeTab === "build" && (
          <div className="space-y-4">
            <div className="rounded-[18px] border border-white/[0.08] bg-[#111113] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-white">
                  Auto-Detect Flat Form Fields
                </h4>
                <span className="text-[10px] font-mono tabular-nums text-zinc-500">
                  Page {currentPageIndex + 1}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Scans the current page for blank lines (
                <code className="text-zinc-300">Name: ____</code>), trailing
                prompts, and <code className="text-zinc-300">[ ]</code>{" "}
                checkboxes, turning a flat PDF into an interactive AcroForm.
              </p>
              <button
                type="button"
                disabled={isDetecting}
                onClick={handleAutoDetectPageFields}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#fafafa] text-zinc-950 text-xs font-semibold hover:bg-white disabled:opacity-60 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
              >
                {isDetecting ? (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-900 border-t-transparent animate-spin" />
                ) : (
                  <ScanSearch className="w-3.5 h-3.5" />
                )}
                <span>
                  {isDetecting
                    ? "Scanning Page..."
                    : `Auto-Detect Fields on Page ${currentPageIndex + 1}`}
                </span>
              </button>
            </div>

            <div className="rounded-[18px] border border-white/[0.08] bg-[#111113] p-4 space-y-3">
              <h4 className="text-xs font-semibold text-white">
                Place Interactive Field on Page{" "}
                <span className="tabular-nums">{currentPageIndex + 1}</span>
              </h4>
              <input
                type="text"
                value={customFieldLabel}
                onChange={(e) => setCustomFieldLabel(e.target.value)}
                placeholder="Optional field label (e.g. Full Name)"
                className="w-full px-2.5 py-2 rounded-lg border border-white/10 bg-black/50 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35"
              />
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickAddField("text")}
                  className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-200 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <Type className="w-4 h-4 text-zinc-300" />
                  <span className="text-[11px] font-medium">+ Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAddField("checkbox")}
                  className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-200 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <CheckSquare className="w-4 h-4 text-zinc-300" />
                  <span className="text-[11px] font-medium">+ Check</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAddField("date")}
                  className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-200 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-zinc-300" />
                  <span className="text-[11px] font-medium">+ Date</span>
                </button>
              </div>
              <p className="text-[11px] text-zinc-500">
                Tip: In the PDF toolbar, click <strong className="text-zinc-300">Insert</strong> or drag fields directly on the canvas to reposition or resize them.
              </p>
            </div>
          </div>
        )}

        {/* ======================================================= */}
        {/* TAB 3: LOCAL AUTOFILL PROFILE VAULT                     */}
        {/* ======================================================= */}
        {activeTab === "profile" && (
          <form onSubmit={handleSaveProfile} className="space-y-3">
            <div className="rounded-[16px] border border-white/[0.08] bg-[#111113] p-3 text-[11px] text-zinc-400 leading-relaxed">
              Stored strictly on your device in IndexedDB. Click{" "}
              <strong className="text-zinc-200">Smart Autofill</strong> in the
              Fill tab to populate matching fields across any PDF form.
            </div>

            {(
              [
                { key: "fullName", label: "Full Name", placeholder: "Jordan Sterling" },
                { key: "firstName", label: "First Name", placeholder: "Jordan" },
                { key: "lastName", label: "Last Name", placeholder: "Sterling" },
                { key: "email", label: "Email Address", placeholder: "jordan@example.com" },
                { key: "phone", label: "Phone / Mobile", placeholder: "+27 82 555 0199" },
                { key: "company", label: "Company / Organization", placeholder: "Acme Studio" },
                { key: "jobTitle", label: "Job Title", placeholder: "Director" },
                { key: "address", label: "Street Address", placeholder: "120 Main Road" },
                { key: "city", label: "City", placeholder: "Cape Town" },
                { key: "postalCode", label: "Postal / ZIP Code", placeholder: "8001" },
                { key: "country", label: "Country", placeholder: "South Africa" },
                { key: "idNumber", label: "ID / Tax / VAT Number", placeholder: "Optional" },
              ] as const
            ).map((item) => (
              <div key={item.key} className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-400">
                  {item.label}
                </label>
                <input
                  type="text"
                  value={profile[item.key]}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      [item.key]: e.target.value,
                    }))
                  }
                  placeholder={item.placeholder}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#111113] text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35"
                />
              </div>
            ))}

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#fafafa] text-zinc-950 text-xs font-semibold hover:bg-white transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
            >
              {profileSaved ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Saved to Device</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save Autofill Profile</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Footer Actions */}
      {fillableFields.length > 0 && (
        <div className="p-3 border-t border-white/[0.08] bg-[#09090b] flex items-center gap-2">
          <button
            type="button"
            onClick={onFlattenRequest}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs font-medium hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Lock &amp; Flatten Form</span>
          </button>
        </div>
      )}
    </aside>
  );
}
