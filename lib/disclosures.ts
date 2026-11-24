// Accounting of disclosures (45 CFR 164.528): which disclosures must be logged, and the six-year lookback.
// Pure functions, no store access.

// Disclosures made without the patient's authorization that the rule requires a covered entity to account for.
export const ACCOUNTABLE_BASES = [
  "Required by law",
  "Public health activity",
  "Abuse, neglect or domestic violence report",
  "Health oversight (audit or inspection)",
  "Judicial or administrative proceeding",
  "Law enforcement",
  "Research under an IRB or privacy board waiver",
  "Other permitted disclosure without authorization",
] as const;

// Disclosures the rule exempts from the accounting. Recording one is refused, with the reason.
export const EXEMPT_BASES = [
  "Treatment, payment or health care operations",
  "To the patient about their own record (right of access)",
  "Under the patient's signed authorization",
] as const;

export const ALL_BASES: string[] = [...ACCOUNTABLE_BASES, ...EXEMPT_BASES];
export const isExempt = (basis: string) => (EXEMPT_BASES as readonly string[]).includes(basis);

export const LOOKBACK_YEARS = 6;

/** First date (yyyy-mm-dd) an accounting requested on `requestDate` must cover. Empty string if the date is invalid. */
export function lookbackStart(requestDate: string, years = LOOKBACK_YEARS): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(requestDate);
  return m ? `${Number(m[1]) - years}-${m[2]}-${m[3]}` : "";
}

/** Disclosures an accounting requested on `requestDate` must list: on or after the lookback start, and not after the request. */
export function withinLookback<T extends { date: string }>(items: T[], requestDate: string, years = LOOKBACK_YEARS): T[] {
  const start = lookbackStart(requestDate, years);
  if (!start) return [];
  return items.filter((d) => d.date >= start && d.date <= requestDate).sort((a, b) => a.date.localeCompare(b.date));
}
