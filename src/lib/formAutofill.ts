import type { AutofillProfile } from "./localDb";

/**
 * Converts a dotted or snake/camelCase AcroForm field name into a clean human-readable label.
 * e.g. "applicant.fullName" -> "Full Name", "billing_zip_code" -> "Billing Zip Code"
 */
export function formatFieldLabel(name: string, alternateName?: string | null): string {
  const raw = (alternateName && alternateName.trim()) || name;
  // Take last dotted segment if no alternateName was given
  const leaf = alternateName?.trim()
    ? raw
    : raw.split(".").pop() || raw;

  return leaf
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Semantic fuzzy matcher that maps a PDF AcroForm field's name & tooltip
 * to the corresponding value in the user's local Autofill Profile (or today's date).
 */
export function matchProfileValueForField(
  fieldName: string,
  alternateName: string | null | undefined,
  profile: AutofillProfile
): string | null {
  const haystack = `${fieldName} ${alternateName || ""}`
    .toLowerCase()
    .replace(/[._-]+/g, " ");

  const fullName =
    profile.fullName.trim() ||
    [profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ");

  // First / Given Name
  if (/(first\s*name|given\s*name|fname)\b/.test(haystack) && profile.firstName.trim()) {
    return profile.firstName.trim();
  }
  // Last / Surname / Family Name
  if (/(last\s*name|surname|family\s*name|lname)\b/.test(haystack) && profile.lastName.trim()) {
    return profile.lastName.trim();
  }
  // Email
  if (/(e\s*-?\s*mail|email\s*address)\b/.test(haystack) && profile.email.trim()) {
    return profile.email.trim();
  }
  // Phone / Mobile / Tel
  if (/(phone|mobile|cell|telephone|tel\b|contact\s*num)/.test(haystack) && profile.phone.trim()) {
    return profile.phone.trim();
  }
  // Company / Organization
  if (/(company|organization|organisation|employer|business\s*name|org\b|firm)/.test(haystack) && profile.company.trim()) {
    return profile.company.trim();
  }
  // Job Title / Role
  if (/(job\s*title|position|role|occupation|designation|title\b)/.test(haystack) && profile.jobTitle.trim()) {
    return profile.jobTitle.trim();
  }
  // Postal / ZIP
  if (/(zip|postal|post\s*code)\b/.test(haystack) && profile.postalCode.trim()) {
    return profile.postalCode.trim();
  }
  // City / Town
  if (/(city|town|municipality|suburb)\b/.test(haystack) && profile.city.trim()) {
    return profile.city.trim();
  }
  // Country
  if (/(country|nation)\b/.test(haystack) && profile.country.trim()) {
    return profile.country.trim();
  }
  // Street Address
  if (/(address|street|residence|location)\b/.test(haystack) && profile.address.trim()) {
    return profile.address.trim();
  }
  // ID / Passport / Tax Number
  if (/(id\s*num|passport|tax\s*id|ssn|vat|identity)\b/.test(haystack) && profile.idNumber.trim()) {
    return profile.idNumber.trim();
  }
  // Full Name / Signer / Applicant Name
  if (/(full\s*name|signer|applicant|client\s*name|your\s*name|\bname\b)/.test(haystack) && fullName) {
    return fullName;
  }
  // Date fields -> today's ISO date
  if (/(^|\s)(date|signed\s*on|today|dob\s*excluded)(\s|$)/.test(haystack) && !/birth|dob/.test(haystack)) {
    return new Date().toISOString().slice(0, 10);
  }

  return null;
}

export interface QuickInsertChip {
  id: string;
  label: string;
  value: string;
}

/**
 * Builds contextual 1-tap quick-insert chips for a focused text input:
 * Today's ISO date, checkmark, N/A, plus populated profile fields.
 */
export function getQuickInsertChips(profile: AutofillProfile): QuickInsertChip[] {
  const today = new Date().toISOString().slice(0, 10);
  const chips: QuickInsertChip[] = [
    { id: "today", label: "Today", value: today },
    { id: "check", label: "✓", value: "✓" },
    { id: "na", label: "N/A", value: "N/A" },
  ];

  const fullName =
    profile.fullName.trim() ||
    [profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ");

  if (fullName) chips.push({ id: "fullName", label: "Name", value: fullName });
  if (profile.email.trim()) chips.push({ id: "email", label: "Email", value: profile.email.trim() });
  if (profile.phone.trim()) chips.push({ id: "phone", label: "Phone", value: profile.phone.trim() });
  if (profile.company.trim()) chips.push({ id: "company", label: "Company", value: profile.company.trim() });

  return chips;
}
