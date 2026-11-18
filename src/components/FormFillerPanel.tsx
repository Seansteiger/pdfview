"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  Search,
  ArrowRight,
  Download,
  Upload,
  AlignLeft,
  ChevronDown,
} from "lucide-react";
import type { Viewer } from "@embedpdf/viewer/core";
import type { FormField, FormFieldValue, FormPlainValue } from "@embedpdf/plugin-form";
import {
  AutofillProfile,
  EMPTY_AUTOFILL_PROFILE,
  getAutofillProfile,
  saveAutofillProfile,
} from "@/lib/localDb";
import {
  formatFieldLabel,
  getQuickInsertChips,
  matchProfileValueForField,
} from "@/lib/formAutofill";
import {
  detectFormFieldsOnPage,
  detectFormFieldsAllPages,
  detectPageTypography,
  toEmbedPdfFontFamily,
  type DetectedFieldDraft,
  type PageTypography,
  type StandardPdfFont,
} from "@/lib/formDetector";

export interface FormFillerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  viewer: Viewer | null;
  pdfBlob: Blob | null;
  documentTitle?: string;
  totalPages?: number;
  currentPageIndex: number;
  fields: readonly FormField[];
  onFieldsChanged: () => void;
  onFlattenRequest: () => void;
  onOpenSignature: () => void;
  onNotify: (message: string, type?: "success" | "error" | "info") => void;
}

type PanelTab = "fill" | "build" | "profile";
type FieldFilterMode = "all" | "empty" | "required";
type FontPreference = "auto" | StandardPdfFont;
type FontSizePreference = 0 | 9 | 10 | 11 | 12 | 14;
type InkPresetId = "carbon" | "archival" | "navy";

const INK_PRESETS: Record<
  InkPresetId,
  { label: string; shortLabel: string; color: string; dotStyle: string }
> = {
  carbon: {
    label: "Carbon Print",
    shortLabel: "Carbon",
    color: "#18181b",
    dotStyle: "bg-[#18181b] border-zinc-400/70",
  },
  archival: {
    label: "Archival Black",
    shortLabel: "Archival",
    color: "#09090b",
    dotStyle: "bg-[#09090b] border-zinc-300/80",
  },
  navy: {
    label: "Ballpoint Navy",
    shortLabel: "Navy",
    color: "#1e3a5f",
    dotStyle: "bg-[#1e3a5f] border-sky-300/60",
  },
};

function fontFamilyToCssClass(font?: string | null): string {
  const lower = (font || "").toLowerCase();
  if (lower.includes("times") || lower.includes("serif")) return "font-serif";
  if (lower.includes("courier") || lower.includes("mono")) return "font-mono";
  return "font-sans";
}

interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: RectBox, b: RectBox): boolean {
  const aCx = a.x + a.width / 2;
  const aCy = a.y + a.height / 2;
  const bCx = b.x + b.width / 2;
  const bCy = b.y + b.height / 2;

  const aCenterInB =
    aCx >= b.x - 2 &&
    aCx <= b.x + b.width + 2 &&
    aCy >= b.y - 2 &&
    aCy <= b.y + b.height + 2;
  if (aCenterInB) return true;

  const bCenterInA =
    bCx >= a.x - 2 &&
    bCx <= a.x + a.width + 2 &&
    bCy >= a.y - 2 &&
    bCy <= a.y + a.height + 2;
  if (bCenterInA) return true;

  const interX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const interY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const interArea = interX * interY;
  const minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return interArea / minArea > 0.4;
}

function extractTextValue(field: FormField): string {
  if (field.kind === "text" || field.kind === "combobox") {
    return field.value;
  }
  return "";
}

export function FormFillerPanel({
  isOpen,
  onClose,
  viewer,
  pdfBlob,
  documentTitle = "document",
  totalPages = 1,
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
  const [isDetecting, setIsDetecting] = useState<"page" | "all" | null>(null);
  const [missingNames, setMissingNames] = useState<Set<string>>(new Set());
  const [customFieldLabel, setCustomFieldLabel] = useState("");

  // Target page selector for Add Fields tab (follows active page automatically)
  const [targetPageIndex, setTargetPageIndex] = useState<number>(currentPageIndex);
  const [showDropdownBuilder, setShowDropdownBuilder] = useState(false);
  const [dropdownOptionsText, setDropdownOptionsText] = useState("Option 1, Option 2, Option 3");

  // Search & filter in Fill tab
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FieldFilterMode>("all");

  // Document-Matched Typography & Ink Texture settings
  const [fontPref, setFontPref] = useState<FontPreference>("auto");
  const [fontSizePref, setFontSizePref] = useState<FontSizePreference>(0);
  const [inkPreset, setInkPreset] = useState<InkPresetId>("carbon");
  const [detectedTypography, setDetectedTypography] = useState<PageTypography | null>(null);
  const [isHarmonizing, setIsHarmonizing] = useState(false);

  // Controlled-input draft buffer & debounce refs (eliminates cursor jump & async race)
  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>({});
  const [focusedFieldName, setFocusedFieldName] = useState<string | null>(null);
  const focusedFieldNameRef = useRef<string | null>(null);
  const debounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingValuesRef = useRef<Record<string, string>>({});

  const inputRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTargetPageIndex(currentPageIndex);
  }, [currentPageIndex]);

  // Clear pending debounce timers on unmount
  useEffect(() => {
    const timers = debounceTimersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  // Load Autofill Profile when panel opens
  useEffect(() => {
    if (isOpen) {
      getAutofillProfile().then(setProfile);
      if (fields.length === 0) {
        setActiveTab("build");
      } else {
        setActiveTab("fill");
      }
    }
  }, [isOpen, fields.length]);

  // Detect dominant page font & median label size whenever active page or PDF changes
  useEffect(() => {
    if (!isOpen || !pdfBlob) return;
    let active = true;
    detectPageTypography(pdfBlob, currentPageIndex)
      .then((typo) => {
        if (active) setDetectedTypography(typo);
      })
      .catch(() => {
        // Keep previous or fallback typography
      });
    return () => {
      active = false;
    };
  }, [isOpen, pdfBlob, currentPageIndex]);

  const effectiveFontFamily: StandardPdfFont =
    fontPref === "auto" ? (detectedTypography?.fontFamily ?? "Helvetica") : fontPref;
  const effectiveFontSize: number =
    fontSizePref === 0 ? (detectedTypography?.fontSize ?? 11) : fontSizePref;
  const effectiveInkColor: string = INK_PRESETS[inkPreset].color;

  const fillableFields = useMemo(
    () => fields.filter((f) => f.kind !== "pushbutton"),
    [fields]
  );

  // Sync local text drafts from PDFium snapshot for non-focused, non-pending fields
  useEffect(() => {
    setLocalTextValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const field of fillableFields) {
        if (field.kind !== "text" && field.kind !== "combobox") continue;
        if (field.name === focusedFieldNameRef.current) continue;
        if (pendingValuesRef.current[field.name] !== undefined) continue;
        if (next[field.name] !== field.value) {
          next[field.name] = field.value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [fillableFields]);

  const getForm = useCallback(() => {
    if (!viewer) return null;
    try {
      return viewer.tryGet("form");
    } catch {
      return null;
    }
  }, [viewer]);

  const pageCount = useMemo(() => {
    const viewerPages = viewer?.documents?.listPages()?.length ?? 0;
    return Math.max(1, totalPages, viewerPages);
  }, [viewer, totalPages]);

  // Map each field name -> 0-based page index
  const fieldPageIndexMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!viewer) return map;
    const form = getForm();
    for (const field of fillableFields) {
      let pageRef = field.widgets?.[0]?.page ?? null;
      if (!pageRef && form) {
        try {
          pageRef = form.getWidgets(field.ref)?.[0]?.page ?? null;
        } catch {
          pageRef = null;
        }
      }
      if (pageRef) {
        try {
          const idx = viewer.documents.getPageIndex(pageRef);
          if (idx >= 0) map[field.name] = idx;
        } catch {
          // Ignore unplaced widgets
        }
      }
    }
    return map;
  }, [viewer, fillableFields, getForm]);

  // Map each field name -> Tailwind font class mirroring its widget's typeface or detected page font
  const fieldFontClassMap = useMemo(() => {
    const map: Record<string, string> = {};
    const form = getForm();
    const fallbackClass = fontFamilyToCssClass(effectiveFontFamily);
    for (const field of fillableFields) {
      let widgetFont: string | null | undefined = null;
      if (form) {
        try {
          widgetFont = form.getWidgets(field.ref)?.[0]?.fontFamily ?? null;
        } catch {
          widgetFont = null;
        }
      }
      map[field.name] = widgetFont ? fontFamilyToCssClass(widgetFont) : fallbackClass;
    }
    return map;
  }, [fillableFields, getForm, effectiveFontFamily]);

  const isFieldEmpty = useCallback(
    (field: FormField): boolean => {
      if (field.kind === "text") {
        const val = localTextValues[field.name] ?? field.value;
        return val.trim().length === 0;
      }
      if (field.kind === "checkbox") return !field.checked;
      if (field.kind === "radio") return !field.value || field.value === "Off";
      if (field.kind === "combobox") {
        const val = localTextValues[field.name] ?? field.value;
        return val.trim().length === 0;
      }
      if (field.kind === "listbox") return field.selectedValues.length === 0;
      return false;
    },
    [localTextValues]
  );

  const filledCount = useMemo(() => {
    return fillableFields.filter((f) => {
      if (f.kind === "signature") return false;
      return !isFieldEmpty(f);
    }).length;
  }, [fillableFields, isFieldEmpty]);

  const progressPct =
    fillableFields.length > 0
      ? Math.round((filledCount / fillableFields.length) * 100)
      : 0;

  const filteredFields = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return fillableFields.filter((field) => {
      if (filterMode === "empty" && !isFieldEmpty(field)) return false;
      if (filterMode === "required" && !field.required) return false;
      if (!q) return true;
      const label = formatFieldLabel(field.name, field.alternateName).toLowerCase();
      return label.includes(q) || field.name.toLowerCase().includes(q);
    });
  }, [fillableFields, filterMode, searchQuery, isFieldEmpty]);

  const quickChips = useMemo(() => getQuickInsertChips(profile), [profile]);

  if (!isOpen) return null;

  const clearAllPendingTextWrites = () => {
    Object.values(debounceTimersRef.current).forEach(clearTimeout);
    debounceTimersRef.current = {};
    pendingValuesRef.current = {};
  };

  const forceSyncLocalFromForm = () => {
    const form = getForm();
    if (!form) return;
    const latest = form.list();
    const updated: Record<string, string> = {};
    for (const f of latest) {
      if (f.kind === "text" || f.kind === "combobox") {
        updated[f.name] = extractTextValue(f);
      }
    }
    setLocalTextValues(updated);
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

  const commitTextValue = async (field: FormField, value: string) => {
    if (debounceTimersRef.current[field.name]) {
      clearTimeout(debounceTimersRef.current[field.name]);
      delete debounceTimersRef.current[field.name];
    }
    delete pendingValuesRef.current[field.name];
    await handleSetFieldValue(field, { value });
  };

  const handleTextDraftChange = (field: FormField, nextVal: string) => {
    setLocalTextValues((prev) => ({ ...prev, [field.name]: nextVal }));
    pendingValuesRef.current[field.name] = nextVal;

    if (debounceTimersRef.current[field.name]) {
      clearTimeout(debounceTimersRef.current[field.name]);
    }
    debounceTimersRef.current[field.name] = setTimeout(() => {
      delete debounceTimersRef.current[field.name];
      const latestPending = pendingValuesRef.current[field.name];
      if (latestPending !== undefined) {
        commitTextValue(field, latestPending);
      }
    }, 120);
  };

  const flushTextField = async (field: FormField) => {
    const hasTimer = Boolean(debounceTimersRef.current[field.name]);
    const pending = pendingValuesRef.current[field.name];
    if (hasTimer || pending !== undefined) {
      const valueToCommit = pending ?? localTextValues[field.name] ?? extractTextValue(field);
      await commitTextValue(field, valueToCommit);
    }
  };

  const flushAllPendingTextFields = async () => {
    const pendingNames = Object.keys(pendingValuesRef.current);
    for (const name of pendingNames) {
      const target = fillableFields.find((f) => f.name === name);
      if (target) {
        await flushTextField(target);
      }
    }
  };

  const handleApplyQuickChip = async (field: FormField, chipValue: string) => {
    setLocalTextValues((prev) => ({ ...prev, [field.name]: chipValue }));
    await commitTextValue(field, chipValue);
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

  const handleInputFocus = (field: FormField) => {
    focusedFieldNameRef.current = field.name;
    setFocusedFieldName(field.name);
    handleFocusField(field);
  };

  const handleInputBlur = (field: FormField) => {
    if (focusedFieldNameRef.current === field.name) {
      focusedFieldNameRef.current = null;
      setFocusedFieldName(null);
    }
    flushTextField(field);
  };

  const focusFieldEverywhere = (target: FormField) => {
    handleFocusField(target);
    const card = cardRefs.current[target.name];
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const el = inputRefs.current[target.name];
    if (el && typeof el.focus === "function") {
      el.focus();
    }
  };

  const handleAdvanceNext = async (currentField: FormField) => {
    await flushTextField(currentField);
    const idxInFiltered = filteredFields.findIndex((f) => f.name === currentField.name);
    const nextField = filteredFields[idxInFiltered + 1];
    if (nextField) {
      focusFieldEverywhere(nextField);
    }
  };

  const handleJumpNextEmpty = () => {
    const emptyList = fillableFields.filter((f) => f.kind !== "signature" && isFieldEmpty(f));
    if (emptyList.length === 0) {
      onNotify("All fillable fields are already completed.", "success");
      return;
    }

    const currentIdx = focusedFieldName
      ? fillableFields.findIndex((f) => f.name === focusedFieldName)
      : -1;

    const afterCurrent = fillableFields
      .slice(currentIdx + 1)
      .find((f) => f.kind !== "signature" && isFieldEmpty(f));
    const nextEmpty = afterCurrent || emptyList[0];

    // If current search/filter hides the next empty field, clear filters so the user sees it
    const visibleInList = filteredFields.some((f) => f.name === nextEmpty.name);
    if (!visibleInList) {
      setSearchQuery("");
      setFilterMode("all");
      requestAnimationFrame(() => focusFieldEverywhere(nextEmpty));
    } else {
      focusFieldEverywhere(nextEmpty);
    }
  };

  const handleSmartAutofill = async () => {
    const form = getForm();
    if (!form) return;

    clearAllPendingTextWrites();

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
      forceSyncLocalFromForm();
      onFieldsChanged();
      onNotify(`Autofilled ${entries.length} field${entries.length === 1 ? "" : "s"}`, "success");
    } catch (err: any) {
      onNotify(`Autofill failed: ${err?.message || "Unknown error"}`, "error");
    }
  };

  const handleValidate = async () => {
    const form = getForm();
    if (!form) return;
    await flushAllPendingTextFields();
    const result = form.validate();
    if (result.valid) {
      setMissingNames(new Set());
      onNotify("All required fields are filled.", "success");
    } else {
      const names = new Set(result.missing.map((m) => m.name));
      setMissingNames(names);
      if (result.missing[0]) {
        focusFieldEverywhere(result.missing[0]);
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
      clearAllPendingTextWrites();
      await form.reset();
      setMissingNames(new Set());
      forceSyncLocalFromForm();
      onFieldsChanged();
      onNotify("Form fields reset to default values.", "info");
    } catch (err: any) {
      onNotify(`Reset failed: ${err?.message || "Unknown error"}`, "error");
    }
  };

  const handleExportJson = async () => {
    const form = getForm();
    if (!form) return;
    try {
      await flushAllPendingTextFields();
      const values = form.exportValues();
      const count = Object.keys(values).length;
      if (count === 0) {
        onNotify("Fill at least one field before exporting form data.", "info");
        return;
      }
      const safeStem = documentTitle
        .replace(/\.pdf$/i, "")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "form";
      const blob = new Blob([JSON.stringify(values, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeStem}-form-data.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Exported ${count} field value${count === 1 ? "" : "s"} to JSON.`, "success");
    } catch (err: any) {
      onNotify(`Export JSON failed: ${err?.message || "Unknown error"}`, "error");
    }
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const form = getForm();
    if (!form) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawValues =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed.values && typeof parsed.values === "object" && !Array.isArray(parsed.values)
            ? parsed.values
            : parsed
          : null;

      if (!rawValues) {
        onNotify("Invalid form JSON file. Expected a key-value object.", "error");
        return;
      }

      clearAllPendingTextWrites();
      const result = await form.importValues(rawValues as Record<string, FormPlainValue>);
      forceSyncLocalFromForm();
      onFieldsChanged();

      const appliedCount = result.applied?.length ?? 0;
      const skippedCount = result.skipped?.length ?? 0;
      onNotify(
        skippedCount > 0
          ? `Imported ${appliedCount} field${appliedCount === 1 ? "" : "s"} (${skippedCount} skipped).`
          : `Imported form data (${appliedCount} field${appliedCount === 1 ? "" : "s"} updated).`,
        "success"
      );
    } catch (err: any) {
      onNotify(`Import JSON failed: ${err?.message || "Invalid JSON"}`, "error");
    }
  };

  const handleHarmonizeAllFieldStyles = async () => {
    const form = getForm();
    if (!form || !viewer) return;

    setIsHarmonizing(true);
    try {
      const pageTypoCache = new Map<number, PageTypography>();
      const getPageTypo = async (pageIdx: number): Promise<PageTypography> => {
        if (pageTypoCache.has(pageIdx)) return pageTypoCache.get(pageIdx)!;
        if (pdfBlob) {
          try {
            const detected = await detectPageTypography(pdfBlob, pageIdx);
            pageTypoCache.set(pageIdx, detected);
            return detected;
          } catch {
            // Fall through to current page/default typography
          }
        }
        const fallback: PageTypography = detectedTypography ?? {
          fontFamily: "Helvetica",
          fontSize: 11,
        };
        pageTypoCache.set(pageIdx, fallback);
        return fallback;
      };

      let updatedCount = 0;
      for (const field of fillableFields) {
        if (field.kind === "signature") continue;
        const widgets = form.getWidgets(field.ref);
        for (const widget of widgets) {
          let pageIdx = currentPageIndex;
          try {
            const idx = viewer.documents.getPageIndex(widget.page);
            if (idx >= 0) pageIdx = idx;
          } catch {
            // Use active page fallback
          }

          const pageTypo = await getPageTypo(pageIdx);
          const resolvedFont = toEmbedPdfFontFamily(
            fontPref === "auto" ? pageTypo.fontFamily : fontPref
          );
          const rawSize = fontSizePref === 0 ? pageTypo.fontSize : fontSizePref;
          const widgetHeight = widget.rect?.height ?? 0;
          const isMultiline = field.kind === "text" && field.multiline;
          const resolvedSize =
            !isMultiline && widgetHeight > 0 && rawSize > widgetHeight * 0.85
              ? Math.max(8, Math.round(widgetHeight * 0.78 * 2) / 2)
              : rawSize;

          if (
            field.kind === "text" ||
            field.kind === "combobox" ||
            field.kind === "listbox"
          ) {
            await form.updateWidget(widget.ref, {
              fontFamily: resolvedFont,
              fontSize: resolvedSize,
              fontColor: effectiveInkColor,
              interiorColor: null,
              strokeWidth: 0,
              color: null,
            });
            updatedCount++;
          } else if (field.kind === "checkbox" || field.kind === "radio") {
            await form.updateWidget(widget.ref, {
              fontColor: effectiveInkColor,
              interiorColor: null,
            });
            updatedCount++;
          }
        }
      }

      onFieldsChanged();
      if (updatedCount > 0) {
        onNotify(
          `Matched ${updatedCount} widget${updatedCount === 1 ? "" : "s"} to ${effectiveFontFamily} · ${effectiveFontSize}pt (${INK_PRESETS[inkPreset].shortLabel}).`,
          "success"
        );
      } else {
        onNotify("No fillable field widgets found to update.", "info");
      }
    } catch (err: any) {
      onNotify(`Could not match field styles: ${err?.message || "Error"}`, "error");
    } finally {
      setIsHarmonizing(false);
    }
  };

  const createNonOverlappingDetectedDrafts = async (
    drafts: DetectedFieldDraft[]
  ): Promise<{ created: number; skippedOverlaps: number; pageSet: Set<number> }> => {
    const form = getForm();
    if (!form || !viewer) {
      return { created: 0, skippedOverlaps: 0, pageSet: new Set() };
    }

    const pages = viewer.documents.listPages();
    const existingNames = new Set(fields.map((f) => f.name));
    const occupiedByPage = new Map<number, RectBox[]>();

    const getOccupiedForPage = (pageIdx: number): RectBox[] => {
      if (occupiedByPage.has(pageIdx)) return occupiedByPage.get(pageIdx)!;
      const pageInfo = pages[pageIdx];
      if (!pageInfo) {
        occupiedByPage.set(pageIdx, []);
        return [];
      }
      try {
        const boxes = form.listWidgets(pageInfo.ref).map((w) => ({
          x: w.box.x,
          y: w.box.y,
          width: w.box.width,
          height: w.box.height,
        }));
        occupiedByPage.set(pageIdx, boxes);
        return boxes;
      } catch {
        occupiedByPage.set(pageIdx, []);
        return [];
      }
    };

    let created = 0;
    let skippedOverlaps = 0;
    const pageSet = new Set<number>();

    for (const draft of drafts) {
      const targetPage = pages[draft.pageIndex];
      if (!targetPage) continue;

      const occupied = getOccupiedForPage(draft.pageIndex);
      if (occupied.some((existingBox) => rectsOverlap(draft.rect, existingBox))) {
        skippedOverlaps++;
        continue;
      }

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
                borderStyle: draft.style.borderStyle ?? "solid",
                strokeWidth: draft.style.strokeWidth,
                color: draft.style.color ?? null,
                interiorColor: draft.style.interiorColor,
                fontColor: effectiveInkColor || draft.style.fontColor,
              },
            ],
          });
        } else {
          const resolvedFont = toEmbedPdfFontFamily(
            fontPref === "auto" ? draft.style.fontFamily : fontPref
          );
          const resolvedFontSize =
            fontSizePref === 0 ? draft.style.fontSize : fontSizePref;
          await form.create({
            kind: "text",
            name,
            alternateName: draft.label,
            widgets: [
              {
                page: targetPage.ref,
                rect: draft.rect,
                fontFamily: resolvedFont,
                fontSize: resolvedFontSize,
                fontColor: effectiveInkColor || draft.style.fontColor,
                interiorColor: draft.style.interiorColor,
                borderStyle: draft.style.borderStyle ?? "solid",
                strokeWidth: draft.style.strokeWidth,
                color: draft.style.color ?? null,
              },
            ],
          });
        }
        occupied.push(draft.rect);
        created++;
        pageSet.add(draft.pageIndex);
      } catch (createErr) {
        console.warn("[FormFillerPanel] Skipped detected field:", name, createErr);
      }
    }

    return { created, skippedOverlaps, pageSet };
  };

  const handleAutoDetectPageFields = async () => {
    const form = getForm();
    if (!form || !viewer || !pdfBlob) return;

    try {
      setIsDetecting("page");
      const pages = viewer.documents.listPages();
      const safePageIdx = Math.min(Math.max(0, targetPageIndex), Math.max(0, pages.length - 1));
      const targetPage = pages[safePageIdx];
      if (!targetPage) {
        onNotify("No active page found.", "error");
        return;
      }

      const detected = await detectFormFieldsOnPage(pdfBlob, safePageIdx);
      if (detected.length === 0) {
        onNotify(
          `No blank lines or checkboxes detected on Page ${safePageIdx + 1}. Use '+ Add Field' below to place one manually.`,
          "info"
        );
        return;
      }

      const { created, skippedOverlaps } = await createNonOverlappingDetectedDrafts(detected);
      onFieldsChanged();

      if (created > 0) {
        setActiveTab("fill");
        onNotify(
          `Detected & created ${created} field${created === 1 ? "" : "s"} on Page ${safePageIdx + 1}.`,
          "success"
        );
      } else if (skippedOverlaps > 0) {
        onNotify(`All ${skippedOverlaps} detected zones on Page ${safePageIdx + 1} already have fields.`, "info");
      } else {
        onNotify("Could not place detected fields on this page.", "info");
      }
    } catch (err: any) {
      onNotify(`Detection error: ${err?.message || "Failed"}`, "error");
    } finally {
      setIsDetecting(null);
    }
  };

  const handleAutoDetectAllPages = async () => {
    const form = getForm();
    if (!form || !viewer || !pdfBlob) return;

    try {
      setIsDetecting("all");
      const detected = await detectFormFieldsAllPages(pdfBlob);
      if (detected.length === 0) {
        onNotify("No blank lines or checkboxes detected in this document.", "info");
        return;
      }

      const { created, skippedOverlaps, pageSet } =
        await createNonOverlappingDetectedDrafts(detected);
      onFieldsChanged();

      if (created > 0) {
        setActiveTab("fill");
        onNotify(
          `Created ${created} field${created === 1 ? "" : "s"} across ${pageSet.size} page${pageSet.size === 1 ? "" : "s"}.`,
          "success"
        );
      } else if (skippedOverlaps > 0) {
        onNotify("All detected form zones across the document already have interactive fields.", "info");
      } else {
        onNotify("Could not place detected fields.", "info");
      }
    } catch (err: any) {
      onNotify(`Full-document scan error: ${err?.message || "Failed"}`, "error");
    } finally {
      setIsDetecting(null);
    }
  };

  const handleQuickAddField = async (
    preset: "text" | "checkbox" | "date" | "multiline" | "dropdown"
  ) => {
    const form = getForm();
    if (!form || !viewer) return;

    const pages = viewer.documents.listPages();
    const safePageIdx = Math.min(Math.max(0, targetPageIndex), Math.max(0, pages.length - 1));
    const targetPage = pages[safePageIdx];
    if (!targetPage) return;

    const existingNames = new Set(fields.map((f) => f.name));
    const defaultLabels: Record<typeof preset, string> = {
      text: "Text Field",
      checkbox: "Checkbox",
      date: "Date",
      multiline: "Notes",
      dropdown: "Selection",
    };
    const baseLabel = customFieldLabel.trim() || defaultLabels[preset];
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

    const offsetStep = (fields.length % 8) * 30;
    const x = 72;
    const y = Math.min(targetPage.size.height - 80, 120 + offsetStep);

    let pageTypo: PageTypography = detectedTypography ?? {
      fontFamily: "Helvetica",
      fontSize: 11,
    };
    if (pdfBlob && (fontPref === "auto" || fontSizePref === 0)) {
      try {
        pageTypo = await detectPageTypography(pdfBlob, safePageIdx);
      } catch {
        // Use active page fallback
      }
    }
    const resolvedFont = toEmbedPdfFontFamily(
      fontPref === "auto" ? pageTypo.fontFamily : fontPref
    );
    const resolvedFontSize = fontSizePref === 0 ? pageTypo.fontSize : fontSizePref;
    const fieldBoxHeight = Math.max(18, Math.round(resolvedFontSize * 1.65));

    try {
      let res;
      if (preset === "checkbox") {
        res = await form.create({
          kind: "checkbox",
          name,
          alternateName: baseLabel,
          widgets: [
            {
              page: targetPage.ref,
              rect: { x, y, width: 16, height: 16 },
              borderStyle: "solid",
              strokeWidth: 0.75,
              color: "#71717a",
              interiorColor: null,
              fontColor: effectiveInkColor,
            },
          ],
        });
      } else if (preset === "dropdown") {
        const parsedOptions = dropdownOptionsText
          .split(",")
          .map((opt) => opt.trim())
          .filter(Boolean);
        const optionsList = (parsedOptions.length > 0 ? parsedOptions : ["Option 1", "Option 2"]).map(
          (v) => ({ label: v, value: v })
        );
        res = await form.create({
          kind: "combobox",
          name,
          alternateName: baseLabel,
          options: optionsList,
          widgets: [
            {
              page: targetPage.ref,
              rect: { x, y, width: 200, height: fieldBoxHeight },
              fontFamily: resolvedFont,
              fontSize: resolvedFontSize,
              fontColor: effectiveInkColor,
              interiorColor: null,
              borderStyle: "solid",
              strokeWidth: 0.75,
              color: "#a1a1aa",
            },
          ],
        });
      } else if (preset === "multiline") {
        res = await form.create({
          kind: "text",
          name,
          alternateName: baseLabel,
          multiline: true,
          widgets: [
            {
              page: targetPage.ref,
              rect: { x, y, width: 260, height: 64 },
              fontFamily: resolvedFont,
              fontSize: resolvedFontSize,
              fontColor: effectiveInkColor,
              interiorColor: null,
              borderStyle: "solid",
              strokeWidth: 0.75,
              color: "#a1a1aa",
            },
          ],
        });
      } else {
        const today = new Date().toISOString().slice(0, 10);
        res = await form.create({
          kind: "text",
          name,
          alternateName: baseLabel,
          defaultValue: preset === "date" ? today : "",
          widgets: [
            {
              page: targetPage.ref,
              rect: {
                x,
                y,
                width: preset === "date" ? 130 : 220,
                height: fieldBoxHeight,
              },
              fontFamily: resolvedFont,
              fontSize: resolvedFontSize,
              fontColor: effectiveInkColor,
              interiorColor: null,
              borderStyle: "solid",
              strokeWidth: 0.75,
              color: "#a1a1aa",
            },
          ],
        });

        if (preset === "date") {
          await form.setValue(res.field.ref, { value: today });
        }
      }

      setCustomFieldLabel("");
      setShowDropdownBuilder(false);
      onFieldsChanged();
      setActiveTab("fill");
      form.focus(res.field.ref);
      onNotify(`Added "${baseLabel}" to Page ${safePageIdx + 1}`, "success");
    } catch (err: any) {
      onNotify(`Could not add field: ${err?.message || "Error"}`, "error");
    }
  };

  const handleDeleteField = async (field: FormField) => {
    const form = getForm();
    if (!form) return;
    try {
      if (debounceTimersRef.current[field.name]) {
        clearTimeout(debounceTimersRef.current[field.name]);
        delete debounceTimersRef.current[field.name];
      }
      delete pendingValuesRef.current[field.name];
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
    <aside className="fixed inset-x-0 bottom-0 top-14 md:static md:w-[368px] md:inset-auto border-l border-white/[0.08] bg-[#0c0d12] flex flex-col z-40 shrink-0 shadow-2xl md:shadow-none">
      {/* Hidden JSON File Input for Import */}
      <input
        ref={jsonFileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportJsonFile}
        className="hidden"
      />

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
        <div className="grid grid-cols-3 gap-1 p-1 rounded-[14px] bg-[#111113] border border-white/[0.07]">
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
        {/* DOCUMENT-MATCHED TYPOGRAPHY & INK TEXTURE BAR           */}
        {/* ======================================================= */}
        {(activeTab === "fill" || activeTab === "build") && (
          <div className="rounded-[20px] border border-white/[0.08] bg-[#111113] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Type className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-[11px] font-semibold text-zinc-200 truncate">
                  Typography &amp; Ink Texture
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.07] text-[10px] font-mono tabular-nums text-zinc-300 shrink-0">
                {effectiveFontFamily === "Times-Roman"
                  ? "Times"
                  : effectiveFontFamily}{" "}
                · {effectiveFontSize}pt
              </span>
            </div>

            {/* Font Family + Font Size */}
            <div className="flex items-center gap-1.5">
              <div className="flex-1 grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-black/40 border border-white/[0.07]">
                {(
                  [
                    { id: "auto", label: "Auto" },
                    { id: "Helvetica", label: "Sans" },
                    { id: "Times-Roman", label: "Serif" },
                    { id: "Courier", label: "Mono" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFontPref(opt.id)}
                    title={
                      opt.id === "auto"
                        ? `Match document (${detectedTypography?.fontFamily ?? "Helvetica"})`
                        : opt.id
                    }
                    className={`py-1 px-1.5 rounded-md text-[10px] font-medium transition-[transform,background-color,color] duration-150 active:scale-[0.98] cursor-pointer ${
                      fontPref === opt.id
                        ? "bg-white/[0.14] text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Form Font Size"
                value={fontSizePref}
                onChange={(e) =>
                  setFontSizePref(Number(e.target.value) as FontSizePreference)
                }
                className="px-2 py-1 rounded-lg border border-white/10 bg-black/50 text-[10px] font-mono tabular-nums text-zinc-200 focus:outline-none focus:border-white/30 cursor-pointer"
              >
                <option value={0}>Auto pt</option>
                <option value={9}>9pt</option>
                <option value={10}>10pt</option>
                <option value={11}>11pt</option>
                <option value={12}>12pt</option>
                <option value={14}>14pt</option>
              </select>
            </div>

            {/* Ink Texture Presets & 1-Click Match */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1">
                {(Object.keys(INK_PRESETS) as InkPresetId[]).map((presetKey) => {
                  const preset = INK_PRESETS[presetKey];
                  const active = inkPreset === presetKey;
                  return (
                    <button
                      key={presetKey}
                      type="button"
                      onClick={() => setInkPreset(presetKey)}
                      title={preset.label}
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-medium transition-[transform,background-color,border-color] duration-150 active:scale-[0.98] cursor-pointer ${
                        active
                          ? "border-white/30 bg-white/[0.1] text-white"
                          : "border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full border ${preset.dotStyle}`}
                      />
                      <span>{preset.shortLabel}</span>
                    </button>
                  );
                })}
              </div>

              {fillableFields.length > 0 && (
                <button
                  type="button"
                  disabled={isHarmonizing}
                  onClick={handleHarmonizeAllFieldStyles}
                  title="Apply matched font, size, ink tone, and transparent paper blending to all form fields"
                  className="px-2.5 py-1 rounded-lg bg-[#fafafa] text-zinc-950 text-[10px] font-semibold hover:bg-white disabled:opacity-60 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer shrink-0"
                >
                  {isHarmonizing ? "Matching..." : "Match All Fields"}
                </button>
              )}
            </div>
          </div>
        )}

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
                {/* Progress & Quick Actions (Concentric: outer p-3 + inner rounded-lg = rounded-[20px]) */}
                <div className="rounded-[20px] border border-white/[0.08] bg-[#111113] p-3 space-y-2.5">
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
                      onClick={handleJumpNextEmpty}
                      className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                      title="Jump to next empty field"
                    >
                      <span>Next Empty</span>
                      <ArrowRight className="w-3 h-3 translate-x-[0.5px]" />
                    </button>
                    <button
                      type="button"
                      onClick={handleValidate}
                      className="py-1.5 px-2 rounded-lg border border-white/10 bg-white/[0.04] text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
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

                  {/* Portable Form Data JSON Bar */}
                  <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-white/[0.06]">
                    <span className="text-[10px] text-zinc-500 font-medium">
                      Form Data JSON
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => jsonFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-white/10 bg-white/[0.03] text-[10px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                        title="Import field values from JSON"
                      >
                        <Upload className="w-3 h-3" />
                        <span>Import</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportJson}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-white/10 bg-white/[0.03] text-[10px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                        title="Export field values as JSON"
                      >
                        <Download className="w-3 h-3" />
                        <span>Export</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Search & Filter Bar (for forms with >= 4 fields) */}
                {fillableFields.length >= 4 && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter fields..."
                        className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-white/10 bg-[#111113] text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/30"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white cursor-pointer"
                          title="Clear filter"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {(
                        [
                          { id: "all", label: "All" },
                          { id: "empty", label: "Empty Only" },
                          { id: "required", label: "Required" },
                        ] as const
                      ).map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setFilterMode(mode.id)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer ${
                            filterMode === mode.id
                              ? "bg-white/[0.12] text-white border border-white/20"
                              : "bg-white/[0.03] text-zinc-400 border border-white/[0.06] hover:text-zinc-200"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Guided Field Inputs */}
                {filteredFields.length === 0 ? (
                  <div className="rounded-xl border border-white/[0.07] bg-[#111113] p-4 text-center text-[11px] text-zinc-400">
                    No fields match your current filter.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredFields.map((field) => {
                      const globalIdx = fillableFields.findIndex(
                        (f) => f.name === field.name
                      );
                      const label = formatFieldLabel(field.name, field.alternateName);
                      const isMissing = missingNames.has(field.name);
                      const pageIdx = fieldPageIndexMap[field.name];
                      const isFocused = focusedFieldName === field.name;
                      const textDraft =
                        localTextValues[field.name] ?? extractTextValue(field);
                      const fieldFontClass =
                        fieldFontClassMap[field.name] || "font-sans";

                      return (
                        <div
                          key={field.name}
                          ref={(el) => {
                            cardRefs.current[field.name] = el;
                          }}
                          className={`rounded-xl border p-3 space-y-2 transition-colors ${
                            isMissing
                              ? "border-red-500/50 bg-red-950/15"
                              : isFocused
                              ? "border-white/25 bg-[#111113]"
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
                                {String(globalIdx + 1).padStart(2, "0")}
                              </span>
                              <span className="truncate">{label}</span>
                              {field.required && (
                                <span className="text-red-400 font-bold">*</span>
                              )}
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              {typeof pageIdx === "number" && (
                                <span className="px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.07] text-[9px] font-mono tabular-nums text-zinc-400">
                                  P.{pageIdx + 1}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleFocusField(field)}
                                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] cursor-pointer"
                                title="Locate on page"
                              >
                                <ChevronRight className="w-3 h-3 translate-x-[0.5px]" />
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

                          {field.kind === "text" &&
                            (field.multiline ? (
                              <textarea
                                ref={(el) => {
                                  inputRefs.current[field.name] = el;
                                }}
                                rows={3}
                                disabled={field.readOnly}
                                value={textDraft}
                                onFocus={() => handleInputFocus(field)}
                                onBlur={() => handleInputBlur(field)}
                                onChange={(e) =>
                                  handleTextDraftChange(field, e.target.value)
                                }
                                placeholder={`Enter ${label.toLowerCase()}...`}
                                className={`w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/50 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35 resize-y ${fieldFontClass}`}
                              />
                            ) : (
                              <input
                                ref={(el) => {
                                  inputRefs.current[field.name] = el;
                                }}
                                type={field.password ? "password" : "text"}
                                disabled={field.readOnly}
                                value={textDraft}
                                onFocus={() => handleInputFocus(field)}
                                onBlur={() => handleInputBlur(field)}
                                onChange={(e) =>
                                  handleTextDraftChange(field, e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAdvanceNext(field);
                                  }
                                }}
                                placeholder={`Enter ${label.toLowerCase()}...`}
                                className={`w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/50 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35 ${fieldFontClass}`}
                              />
                            ))}

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
                                        value:
                                          selected && !field.noToggleToOff
                                            ? "Off"
                                            : opt,
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

                          {field.kind === "combobox" &&
                            (field.edit ? (
                              <>
                                <input
                                  ref={(el) => {
                                    inputRefs.current[field.name] = el;
                                  }}
                                  type="text"
                                  list={`combo-opts-${field.name}`}
                                  disabled={field.readOnly}
                                  value={textDraft}
                                  onFocus={() => handleInputFocus(field)}
                                  onBlur={() => handleInputBlur(field)}
                                  onChange={(e) =>
                                    handleTextDraftChange(field, e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      handleAdvanceNext(field);
                                    }
                                  }}
                                  placeholder={`Select or type ${label.toLowerCase()}...`}
                                  className={`w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/60 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35 ${fieldFontClass}`}
                                />
                                <datalist id={`combo-opts-${field.name}`}>
                                  {field.options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label || o.value}
                                    </option>
                                  ))}
                                </datalist>
                              </>
                            ) : (
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
                                className={`w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/60 text-xs text-white focus:outline-none focus:border-white/35 ${fieldFontClass}`}
                              >
                                <option value="">Select option...</option>
                                {field.options.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label || o.value}
                                  </option>
                                ))}
                              </select>
                            ))}

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
                                          ? field.selectedValues.filter(
                                              (v) => v !== o.value
                                            )
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

                          {/* Smart Quick-Insert Chips for focused text / editable combo inputs */}
                          {isFocused &&
                            !field.readOnly &&
                            ((field.kind === "text" && !field.password) ||
                              (field.kind === "combobox" && field.edit)) && (
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                {quickChips.map((chip) => (
                                  <button
                                    key={chip.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => handleApplyQuickChip(field, chip.value)}
                                    title={`Insert "${chip.value}"`}
                                    className="px-2 py-0.5 rounded-md border border-white/10 bg-white/[0.04] text-[10px] font-medium text-zinc-300 hover:text-white hover:bg-white/[0.1] tabular-nums transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                                  >
                                    {chip.label}
                                  </button>
                                ))}
                              </div>
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
                )}
              </>
            )}
          </>
        )}

        {/* ======================================================= */}
        {/* TAB 2: MAKE ANY FLAT PDF FILLABLE (DETECT + ADD FIELDS) */}
        {/* ======================================================= */}
        {activeTab === "build" && (
          <div className="space-y-4">
            {/* Target Page Selector */}
            <div className="flex items-center justify-between gap-2 rounded-[16px] border border-white/[0.08] bg-[#111113] px-3 py-2.5">
              <span className="text-[11px] font-medium text-zinc-300">
                Target Page
              </span>
              <select
                value={targetPageIndex}
                onChange={(e) => setTargetPageIndex(Number(e.target.value))}
                className="px-2.5 py-1 rounded-lg border border-white/10 bg-black/60 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-white/35"
              >
                {Array.from({ length: pageCount }).map((_, idx) => (
                  <option key={idx} value={idx}>
                    Page {idx + 1}
                    {idx === currentPageIndex ? " (Active)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-[20px] border border-white/[0.08] bg-[#111113] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-white">
                  Auto-Detect Flat Form Fields
                </h4>
                <span className="text-[10px] font-mono tabular-nums text-zinc-500">
                  Page {targetPageIndex + 1}/{pageCount}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Scans for blank lines (
                <code className="text-zinc-300">Name: ____</code>), trailing
                prompts, and <code className="text-zinc-300">[ ]</code>{" "}
                checkboxes, converting flat PDFs into interactive AcroForms
                without duplicating existing fields.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={isDetecting !== null}
                  onClick={handleAutoDetectPageFields}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#fafafa] text-zinc-950 text-xs font-semibold hover:bg-white disabled:opacity-60 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  {isDetecting === "page" ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-900 border-t-transparent animate-spin" />
                  ) : (
                    <ScanSearch className="w-3.5 h-3.5" />
                  )}
                  <span className="tabular-nums">
                    {isDetecting === "page"
                      ? "Scanning Page..."
                      : `Auto-Detect Page ${targetPageIndex + 1}`}
                  </span>
                </button>

                {pageCount > 1 && (
                  <button
                    type="button"
                    disabled={isDetecting !== null}
                    onClick={handleAutoDetectAllPages}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 text-xs font-medium hover:bg-white/[0.08] disabled:opacity-60 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    {isDetecting === "all" ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                    ) : (
                      <ScanSearch className="w-3.5 h-3.5 text-zinc-300" />
                    )}
                    <span className="tabular-nums">
                      {isDetecting === "all"
                        ? "Scanning All Pages..."
                        : `Scan Entire Document (${pageCount} Pages)`}
                    </span>
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-[20px] border border-white/[0.08] bg-[#111113] p-4 space-y-3">
              <h4 className="text-xs font-semibold text-white">
                Place Interactive Field on Page{" "}
                <span className="tabular-nums">{targetPageIndex + 1}</span>
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
                <button
                  type="button"
                  onClick={() => handleQuickAddField("multiline")}
                  className="flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-200 transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                >
                  <AlignLeft className="w-4 h-4 text-zinc-300" />
                  <span className="text-[11px] font-medium">+ Notes</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDropdownBuilder((prev) => !prev)}
                  className={`col-span-2 flex flex-col items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl border transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer ${
                    showDropdownBuilder
                      ? "border-white/30 bg-white/[0.1] text-white"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-zinc-200"
                  }`}
                >
                  <ChevronDown className="w-4 h-4 text-zinc-300" />
                  <span className="text-[11px] font-medium">+ Dropdown</span>
                </button>
              </div>

              {showDropdownBuilder && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2">
                  <label className="block text-[10px] font-medium text-zinc-400">
                    Dropdown Options (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={dropdownOptionsText}
                    onChange={(e) => setDropdownOptionsText(e.target.value)}
                    placeholder="Yes, No, N/A"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-white/10 bg-[#111113] text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/35"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickAddField("dropdown")}
                    className="w-full py-1.5 px-3 rounded-lg bg-[#fafafa] text-zinc-950 text-[11px] font-semibold hover:bg-white transition-[transform,background-color] duration-150 active:scale-[0.98] cursor-pointer"
                  >
                    Insert Dropdown on Page{" "}
                    <span className="tabular-nums">{targetPageIndex + 1}</span>
                  </button>
                </div>
              )}

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
