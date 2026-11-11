// Duplicate chart review: evidence comparison + primary-record rule.
// Pure functions, no store access.

export interface RecordFacts {
  mrn: string;
  name: string; // "Last, First" (also accepts "First Last")
  dob: string; // yyyy-mm-dd
  lastAppt?: string; // most recent past appointment, yyyy-mm-dd
  nextAppt?: string; // soonest upcoming appointment, yyyy-mm-dd
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z\s-]/g, "").replace(/\s+/g, " ");

export function splitName(name: string): { first: string; last: string } {
  if (name.includes(",")) {
    const [last, rest] = name.split(",");
    return { last: norm(last), first: norm(rest).split(" ")[0] ?? "" };
  }
  const parts = norm(name).split(" ");
  return { first: parts[0] ?? "", last: parts[parts.length - 1] ?? "" };
}

/** Which identifiers agree. A shared DOB alone is a coincidence, not evidence. */
export function matchEvidence(a: RecordFacts, b: RecordFacts): string[] {
  const x = splitName(a.name);
  const y = splitName(b.name);
  const out: string[] = [];
  if (x.last && x.last === y.last) out.push("Last name");
  if (x.first && x.first === y.first) out.push("First name");
  if (a.dob && a.dob === b.dob) out.push("Date of birth");
  return out;
}

export const MIN_EVIDENCE_TO_MERGE = 2;

/** Soonest upcoming appointment wins; else most recent past appointment; else no determination (human review). */
export function pickPrimary(a: RecordFacts, b: RecordFacts): { primary: string | null; secondary: string | null; reason: string } {
  const win = (p: RecordFacts, s: RecordFacts, reason: string) => ({ primary: p.mrn, secondary: s.mrn, reason });
  if (a.nextAppt && b.nextAppt) {
    return a.nextAppt <= b.nextAppt
      ? win(a, b, `Both have upcoming appts; ${a.mrn} is sooner (${a.nextAppt} vs ${b.nextAppt})`)
      : win(b, a, `Both have upcoming appts; ${b.mrn} is sooner (${b.nextAppt} vs ${a.nextAppt})`);
  }
  if (a.nextAppt) return win(a, b, `${a.mrn} has an upcoming appt (${a.nextAppt}); ${b.mrn} has none`);
  if (b.nextAppt) return win(b, a, `${b.mrn} has an upcoming appt (${b.nextAppt}); ${a.mrn} has none`);
  if (a.lastAppt && b.lastAppt) {
    return a.lastAppt >= b.lastAppt
      ? win(a, b, `Neither has upcoming appts; ${a.mrn} was seen more recently (${a.lastAppt} vs ${b.lastAppt})`)
      : win(b, a, `Neither has upcoming appts; ${b.mrn} was seen more recently (${b.lastAppt} vs ${a.lastAppt})`);
  }
  if (a.lastAppt) return win(a, b, `${a.mrn} has appt history (${a.lastAppt}); ${b.mrn} has none`);
  if (b.lastAppt) return win(b, a, `${b.mrn} has appt history (${b.lastAppt}); ${a.mrn} has none`);
  return { primary: null, secondary: null, reason: "Neither record has any appointment history - cannot determine primary automatically, escalate to human review" };
}
