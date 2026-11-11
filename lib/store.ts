// Canonical state store — single source of truth, framework-light (no external dep).
// Mutations are synchronous (store updates immediately; getState() is fresh right after a
// mutation) so the structured-API modality keeps read-after-write semantics for grading.
// React subscribes via useSim() (useSyncExternalStore). The agent API (agentApi.ts) bridges
// these same actions onto window.SimEHR, so UI clicks and programmatic calls share one path.

import { useSyncExternalStore } from "react";
import type { Case, Medication, Order, Problem, AuditEntry } from "./types";
import { NORMAL_DEFAULTS } from "./noteTemplate";
import { isExempt, EXEMPT_BASES } from "./disclosures";
import { matchEvidence, pickPrimary, MIN_EVIDENCE_TO_MERGE, type RecordFacts } from "./duplicates";

export interface Modal {
  type: "advisory" | "signvisit" | "signresult" | "menu" | "report" | "phonecall" | "letter" | "addendum" | "roi" | "referrals" | "duplicates" | "disclosures";
  kind?: string | null;
}

export interface PhoneCall { id: string; with: string; phone: string; reason: string; outcome: string; notes: string; }
export interface LetterRecord { id: string; to: string; kind: string; body: string; }
export interface Addendum { id: string; text: string; }

export interface RoiRequest {
  id: string;
  kind: "access" | "authorization"; // 45 CFR 164.524 patient access vs 164.508 third-party authorization
  requester: string;
  recipient: string;
  info: string;
  received: string; // yyyy-mm-dd
  due: string; // received + 30 calendar days
  missing: string[]; // authorization elements not present (always empty for access requests)
  status: "Ready to release" | "Deficient - return to requester";
}

export const REFERRAL_FLOW = ["Ordered", "Sent", "Scheduled", "Completed", "Report Received"] as const;
export type ReferralStatus = (typeof REFERRAL_FLOW)[number] | "Cancelled";
export interface Referral {
  id: string;
  specialty: string;
  reason: string;
  orderedBy: string;
  ordered: string; // yyyy-mm-dd
  status: ReferralStatus;
  scheduled?: string;
  completed?: string;
  reportDate?: string;
  reportFrom?: string;
  history: { status: ReferralStatus; at: string }[];
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type DuplicateDecision = "merge" | "not_duplicate" | "escalate";
export interface DuplicateReview {
  id: string;
  thisMrn: string;
  otherMrn: string;
  evidence: string[];
  decision: DuplicateDecision;
  primary: string | null; // surviving MRN (merge only)
  secondary: string | null;
  primaryReason: string;
  rationale: string;
}

export interface Disclosure {
  id: string;
  date: string; // yyyy-mm-dd
  recipient: string;
  address: string; // optional, "" if unknown
  description: string; // brief description of the PHI disclosed
  purpose: string; // brief statement of the purpose
  basis: string;
}

export interface SimState {
  caseData: Case | null;
  activity: string;
  crSubtab: string;
  crNoteSel: string | null; // a note to select when Chart Review › Notes next renders (set by an encounter report link)
  alertsAcked: number[]; // indices into caseData.recentActivity acknowledged through the bell
  orders: Order[];
  deliverable: string;
  noteDraft: string;
  patientReply: string; // the reply sent to the patient's message (the last Send wins)
  patientReplyDraft: string;
  noteExam: Record<string, string[]>;
  advisoryResponses: { kind: string | null; action: string }[];
  visitSigned: boolean;
  phoneCalls: PhoneCall[];
  letters: LetterRecord[];
  addenda: Addendum[];
  roiRequests: RoiRequest[];
  referrals: Referral[];
  duplicateReviews: DuplicateReview[];
  disclosures: Disclosure[];
  modal: Modal | null;
  menuOpen: boolean;
  searchOpen: boolean;
  audit: AuditEntry[];
  runId: string;
}

// Opening a patient lands on Chart Review › Encounters (the
// activity strip opens on Chart Review and its sub-tab bar sits on Encounters, not Labs). Patient Summary stays
// reachable from the tab strip. Measured on the 20-task sample, this drops the share of graded values
// legible without navigating from 48% to 41% — the remainder is the patient sidebar, which pins vitals in production
// charts too, so some free exposure is inherent to the chart rather than a defect in this mock.
const START_ACTIVITY = "chart-review";
const START_SUBTAB = "Encounters";

const rid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

let state: SimState = {
  caseData: null,
  activity: START_ACTIVITY,
  crSubtab: START_SUBTAB,
  crNoteSel: null,
  alertsAcked: [],
  orders: [],
  deliverable: "",
  noteDraft: "",
  patientReply: "",
  patientReplyDraft: "",
  noteExam: {},
  advisoryResponses: [],
  visitSigned: false,
  phoneCalls: [],
  letters: [],
  addenda: [],
  roiRequests: [],
  referrals: [],
  duplicateReviews: [],
  disclosures: [],
  modal: null,
  menuOpen: false,
  searchOpen: false,
  audit: [],
  runId: rid(),
};

const listeners = new Set<() => void>();
export const getState = (): SimState => state;
function set(patch: Partial<SimState> | ((s: SimState) => Partial<SimState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

// ---- actions (every mutation funnels through here + logs) ----
export function log(actor: string, action: string, detail = "") {
  set((s) => ({ audit: [...s.audit, { ts: now(), actor, action, detail }] }));
}

const FRESH: Partial<SimState> = { orders: [], deliverable: "", noteDraft: "", patientReply: "", patientReplyDraft: "", noteExam: {}, advisoryResponses: [], visitSigned: false, phoneCalls: [], letters: [], addenda: [], roiRequests: [], referrals: [], duplicateReviews: [], disclosures: [], modal: null, crNoteSel: null, alertsAcked: [], menuOpen: false, searchOpen: false };

export function loadCase(c: Case, actor = "system") {
  _orderSeq = 0;   // ids restart per episode, so an audit log id means the same thing across runs
  set({ caseData: structuredClone(c), activity: START_ACTIVITY, crSubtab: START_SUBTAB, runId: rid(), ...FRESH });
  log(actor, "load_case", c.id);
}

export function reset(actor = "system") {
  const c = state.caseData;
  _orderSeq = 0;
  set({ activity: START_ACTIVITY, crSubtab: START_SUBTAB, audit: [], runId: rid(), ...FRESH });
  if (c) set({ caseData: structuredClone(c) });
  log(actor, "reset_state", c?.id ?? "");
}

// ---- patient reply: the answer to a patient message, composed under the message in Chart Review ----
export function setPatientReplyDraft(text: string) {
  set({ patientReplyDraft: text });
}
export function sendPatientReply(text: string, actor = "human") {
  set({ patientReply: text, patientReplyDraft: text });
  log(actor, "send_patient_reply", `${text.length} characters`);
}

// ---- modal ----
export function openModal(type: Modal["type"], kind?: string | null, actor = "human") {
  set({ modal: { type, kind } });
  if (type === "advisory") log("system", "advisory_fired", kind ?? "");
}
export function closeModal() {
  set({ modal: null });
}

// ---- master menu + Ctrl+K search overlay ----
export function openMainMenu(actor = "human") {
  set({ menuOpen: true, searchOpen: false });
  log(actor, "open_main_menu", "");
}
export function closeMainMenu() {
  set({ menuOpen: false });
}
export function openSearch(actor = "human") {
  set({ searchOpen: true, menuOpen: false });
  log(actor, "open_chart_search", "");
}
export function closeSearch() {
  set({ searchOpen: false });
}
export function menuSelect(cat: string, label: string, actor = "human") {
  log(actor, "main_menu_select", `${cat} › ${label}`);
  set({ menuOpen: false });
}

// ---- Clinical Notes exam pills ----
export function togglePill(section: string, pill: string, actor = "human") {
  set((s) => {
    const exam = { ...s.noteExam };
    const arr = [...(exam[section] ?? [])];
    const i = arr.indexOf(pill);
    if (i === -1) arr.push(pill);
    else arr.splice(i, 1);
    exam[section] = arr;
    return { noteExam: exam };
  });
  log(actor, "toggle_pill", `${section}: ${pill}`);
}
export function applyNormalExam(actor = "human") {
  set({ noteExam: structuredClone(NORMAL_DEFAULTS) });
  log(actor, "apply_macro", "Normal Exam");
}
export function clearExam(actor = "human") {
  set({ noteExam: {} });
  log(actor, "clear_exam", "all sections");
}
export function signNote(actor = "human") {
  log(actor, "sign_note", `${state.deliverable.length} chars A&P`);
}

// ---- advisory ----
export function respondAdvisory(kind: string | null, action: string, actor = "human") {
  // Generic recorder — no case-specific side-effects. The agent must enact any suggested change itself
  // (place the order / modify the med); the benchmark grades that, not a free auto-apply on "accept".
  set((s) => ({ advisoryResponses: [...s.advisoryResponses, { kind, action }], modal: null }));
  log(actor, "advisory_response", `${kind}: ${action}`);
}

/** Identity of advisory i. The case data leaves `kind` null in every shipped case, so responses would all
 *  collapse to the same key and a second advisory could never be told apart from the first. */
export const advisoryId = (b: { kind?: string | null }, i: number) => b?.kind ?? String(i);

// ---- Telephone Call / Send Letter / Addendum (Patient Care menu) ----
export function logPhoneCall(c: Omit<PhoneCall, "id">, actor = "human") {
  const id = `call${state.phoneCalls.length + 1}`;
  set((s) => ({ phoneCalls: [...s.phoneCalls, { id, ...c }], modal: null }));
  log(actor, "phone_call", `${id}: ${c.with} (${c.outcome}) ${c.reason}`);
  return id;
}
export function sendLetter(l: Omit<LetterRecord, "id">, actor = "human") {
  const id = `let${state.letters.length + 1}`;
  set((s) => ({ letters: [...s.letters, { id, ...l }], modal: null }));
  log(actor, "send_letter", `${id}: ${l.kind} to ${l.to}`);
  return id;
}
export function saveAddendum(text: string, actor = "human") {
  const id = `add${state.addenda.length + 1}`;
  set((s) => ({ addenda: [...s.addenda, { id, text }], modal: null }));
  log(actor, "addendum", `${id}: ${text.length} chars`);
  return id;
}

// ---- Release of Information ----
export const ROI_CORE = ["Description of the information", "Who may disclose", "Who may receive", "Purpose", "Expiration date or event", "Patient signature and date"];
export const ROI_STATEMENTS = ["Right to revoke in writing", "Treatment not conditioned on signing", "Redisclosure may no longer be protected"];

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function submitRoi(r: Omit<RoiRequest, "id" | "due" | "status" | "missing"> & { present: string[] }, actor = "human") {
  const id = `roi${state.roiRequests.length + 1}`;
  const required = r.kind === "authorization" ? [...ROI_CORE, ...ROI_STATEMENTS] : [];
  const missing = required.filter((e) => !r.present.includes(e));
  const status: RoiRequest["status"] = missing.length ? "Deficient - return to requester" : "Ready to release";
  const { present: _p, ...rest } = r;
  const req: RoiRequest = { id, ...rest, due: addDays(r.received, 30), missing, status };
  set((s) => ({ roiRequests: [...s.roiRequests, req], modal: null }));
  log(actor, "roi_request", `${id}: ${r.kind} -> ${status}${missing.length ? ` (missing: ${missing.join("; ")})` : ""}`);
  return id;
}

// ---- Referral tracking (closed loop) ----
export function addReferral(r: { specialty: string; reason: string; orderedBy: string; ordered: string }, actor = "human") {
  const id = `ref${state.referrals.length + 1}`;
  const ref: Referral = { id, ...r, status: "Ordered", history: [{ status: "Ordered", at: r.ordered }] };
  set((s) => ({ referrals: [...s.referrals, ref] }));
  log(actor, "referral_added", `${id}: ${r.specialty} (${r.reason})`);
  return id;
}

/** Move a referral forward one step, or cancel it. Returns an error message (and changes nothing) if a rule fails. */
export function advanceReferral(id: string, to: ReferralStatus, d: { date?: string; reportFrom?: string }, actor = "human"): string | null {
  const ref = state.referrals.find((r) => r.id === id);
  if (!ref) return "Referral not found.";
  if (ref.status === "Report Received" || ref.status === "Cancelled") return "This referral is already closed.";
  const at = d.date || todayLocal();
  const next = { ...ref };
  if (to === "Cancelled") {
    if (ref.status === "Completed") return "A completed visit cannot be cancelled; record the report instead.";
  } else {
    if (REFERRAL_FLOW.indexOf(to) !== REFERRAL_FLOW.indexOf(ref.status) + 1) return `Next step after ${ref.status} is ${REFERRAL_FLOW[REFERRAL_FLOW.indexOf(ref.status) + 1]}.`;
    if (at < ref.ordered) return "Date cannot be before the referral was ordered.";
    if (to === "Scheduled") next.scheduled = at;
    if (to === "Completed") next.completed = at;
    if (to === "Report Received") {
      // Closed loop only counts a consult report from the specialist, received after the order (CMS50 logic).
      const from = (d.reportFrom ?? "").trim();
      if (!from) return "Enter who sent the report.";
      if (from.toLowerCase() === ref.orderedBy.trim().toLowerCase()) return "The report must come from the specialist, not the ordering provider.";
      next.reportDate = at;
      next.reportFrom = from;
    }
  }
  next.status = to;
  next.history = [...ref.history, { status: to, at }];
  set((s) => ({ referrals: s.referrals.map((r) => (r.id === id ? next : r)) }));
  log(actor, "referral_status", `${id}: ${ref.status} -> ${to}${to === "Report Received" ? " (loop closed)" : ""}`);
  return null;
}

// ---- Duplicate chart review ----
/** Records a reviewer's decision on a suspected duplicate pair. It never merges anything: the chart is unchanged, and a
 *  "merge" is a decision for HIM to carry out. Returns an error message (and records nothing) if a rule fails. */
export function reviewDuplicate(a: RecordFacts, b: RecordFacts, decision: DuplicateDecision, rationale: string, actor = "human"): string | null {
  if (!rationale.trim()) return "Enter a rationale.";
  if (!b.mrn.trim()) return "Enter the other record's MRN.";
  if (a.mrn === b.mrn) return "Both records have the same MRN; that is one chart, not a duplicate pair.";
  const evidence = matchEvidence(a, b);
  let primary: string | null = null;
  let secondary: string | null = null;
  let primaryReason = "";
  if (decision === "merge") {
    if (evidence.length < MIN_EVIDENCE_TO_MERGE) return `Not enough evidence to merge: only ${evidence.length ? evidence.join(", ") : "no identifiers"} matched. A shared date of birth alone is a coincidence. Choose "Not a duplicate" or "Escalate".`;
    const pick = pickPrimary(a, b);
    if (!pick.primary) return `${pick.reason}.`;
    ({ primary, secondary } = pick);
    primaryReason = pick.reason;
  }
  const id = `dup${state.duplicateReviews.length + 1}`;
  const rev: DuplicateReview = { id, thisMrn: a.mrn, otherMrn: b.mrn, evidence, decision, primary, secondary, primaryReason, rationale: rationale.trim() };
  set((s) => ({ duplicateReviews: [...s.duplicateReviews, rev], modal: null }));
  log(actor, "duplicate_review", `${id}: ${a.mrn} vs ${b.mrn} -> ${decision}${primary ? ` (primary ${primary})` : ""}; matched: ${evidence.join(", ") || "none"}`);
  return null;
}

// ---- Accounting of disclosures ----
/** Logs a disclosure the patient could ask to see in an accounting. Returns an error message (and records nothing) if a
 *  required field is missing or the disclosure is one the rule exempts from the accounting. */
export function logDisclosure(d: Omit<Disclosure, "id">, actor = "human"): string | null {
  if (!d.date) return "Enter the date of the disclosure.";
  if (d.date > todayLocal()) return "The disclosure date cannot be in the future.";
  if (!d.recipient.trim()) return "Enter who received the information.";
  if (!d.description.trim()) return "Enter a brief description of what was disclosed.";
  if (!d.purpose.trim()) return "Enter a brief statement of the purpose.";
  if (isExempt(d.basis)) return `Not recorded: "${d.basis}" is exempt from the accounting of disclosures. Exempt: ${EXEMPT_BASES.join("; ")}.`;
  const id = `disc${state.disclosures.length + 1}`;
  set((s) => ({ disclosures: [...s.disclosures, { id, ...d }] }));
  log(actor, "disclosure_logged", `${id}: ${d.date} to ${d.recipient} (${d.basis})`);
  return null;
}

// ---- Sign Visit ----
export function signVisit(actor = "human") {
  set({ visitSigned: true, modal: { type: "signresult" } });
  log(actor, "sign_visit", "");
}

export function switchActivity(name: string, actor = "human") {
  set({ activity: name });
  log(actor, "switch_activity", name);
}

export function setCrSubtab(name: string, actor = "human") {
  set({ crSubtab: name });
  log(actor, "chart_review_subtab", name);
}

/** Open one note in Chart Review › Notes, e.g. from the documentation list of an encounter report. */
export function openChartNote(noteId: string, actor = "human") {
  if (state.activity !== "chart-review") switchActivity("chart-review", actor);
  setCrSubtab("Notes/Trans", actor);
  set({ crNoteSel: noteId, modal: null });
  log(actor, "open_note", noteId);
}
export function clearChartNote() {
  set({ crNoteSel: null });
}

// ---- alerts (the bell). The items are the chart's recent-activity entries: events, not assessments, so
// nothing graded is handed over. Each can be opened (a keyword heuristic picks the activity) and acknowledged.
export function alertTarget(text: string): { activity: string; subtab?: string } {
  const t = text.toLowerCase();
  if (/consult|referral/.test(t)) return { activity: "chart-review", subtab: "Referrals" };
  if (/message|portal|phone|telephone|email/.test(t)) return { activity: "chart-review", subtab: "Encounters" };
  if (/imaging|\bct\b|mri|ultrasound|x-ray|\bxr\b|echo|scan|radiolog/.test(t)) return { activity: "chart-review", subtab: "Rad" };
  if (/lab|result|panel|a1c|tsh|cbc|cmp|bmp|creatinine|level|culture|biopsy|patholog/.test(t)) return { activity: "results" };
  if (/medication|refill|prescri|dose|started|stopped|discontinu/.test(t)) return { activity: "medications" };
  if (/problem list|diagnos/.test(t)) return { activity: "problem-list" };
  return { activity: "chart-review", subtab: "Encounters" };
}
export function openAlert(i: number, actor = "human") {
  const text = state.caseData?.recentActivity?.[i] ?? "";
  const target = alertTarget(text);
  log(actor, "open_alert", text.slice(0, 80));
  switchActivity(target.activity, actor);
  if (target.subtab) setCrSubtab(target.subtab, actor);
}
export function ackAlert(i: number, actor = "human") {
  if (state.alertsAcked.includes(i)) return;
  set((s) => ({ alertsAcked: [...s.alertsAcked, i] }));
  log(actor, "alert_ack", (state.caseData?.recentActivity?.[i] ?? "").slice(0, 80));
}

/** Show a chart record in the full-size report viewer (double-click on a Chart Review row). */
export function openReport(kind: string, actor = "human") {
  set({ modal: { type: "report", kind } });
  log(actor, "open_report", kind);
}

// Monotonic, never reused. Deriving the id from orders.length collided after any removal: add four, drop
// ord3, and the next add computes "ord" + (3 + 1) = ord4, which already exists. adrenal_incidentaloma did
// exactly that and ended with two rows keyed ord4, which React reports as "two children with the same key"
// (24 times) and which lets an action on one row address the other, since key is how it identifies rows.
let _orderSeq = 0;

export function addOrder(o: Partial<Order>, actor = "human") {
  set((s) => ({
    orders: [
      ...s.orders,
      {
        id: "ord" + (_orderSeq = Math.max(_orderSeq + 1, s.orders.length + 1)),
        status: "pending",
        intent: "order",
        datetime: now(),
        name: "Order",
        ...o,
      } as Order,
    ],
  }));
  log(actor, "add_order", `${o.type ?? ""} ${o.name ?? ""}`.trim());
}

export function removeOrder(id: string, actor = "human") {
  set((s) => ({ orders: s.orders.filter((o) => o.id !== id) }));
  log(actor, "remove_order", id);
}

/** Edit a pending medication order's sig (dose / route / frequency / duration). Keystrokes update the
 *  store silently; `commit` (a select change, or leaving a text field) writes one audit entry. */
export function updateOrder(id: string, patch: Partial<Order>, actor = "human", commit = true) {
  set((s) => ({
    orders: s.orders.map((o) => {
      if (o.id !== id) return o;
      const n = { ...o, ...patch };
      n.sig = [n.dose, n.route, n.frequency, n.duration].filter((x) => x && x.trim()).join(" ") || undefined;
      return n;
    }),
  }));
  if (commit) {
    const o = state.orders.find((x) => x.id === id);
    log(actor, "edit_order", `${o?.name ?? id}: ${o?.sig ?? "—"}`);
  }
}

export function signOrders(actor = "human") {
  // NOTE: signing is deliberately unconditional for now. A sign-time gate (production EHRs batch their advisories
  // here) would give the write a way to fail — today 24 of 24 runs that placed orders signed 100% of
  // them, so the completion axis carries no signal — but the only available trigger was the advisory
  // text, which leaks graded content, and duplicate-order detection has no reliable key (case
  // orderHistory carries batch ids, not test identities, so name matching produced more false hits than
  // true ones). Revisit once visit-diagnosis association exists: that gate demands OUTPUT from the agent
  // rather than handing it input.
  let n = 0;
  set((s) => {
    const orders = s.orders.map((o) => {
      if (o.status === "pending") {
        n++;
        return { ...o, status: "signed" };
      }
      return o;
    });
    return { orders };
  });
  log(actor, "sign_orders", `${n} signed`);
}

export function addMed(m: Partial<Medication>, actor = "human") {
  set((s) => {
    if (!s.caseData) return {};
    const c = structuredClone(s.caseData);
    c.medications = [
      ...(c.medications ?? []),
      { id: "m_new" + ((c.medications?.length ?? 0) + 1), status: "active", intent: "order", name: "Medication", ...m } as Medication,
    ];
    return { caseData: c };
  });
  log(actor, "add_med", `${m.name ?? ""} ${m.dose ?? ""} ${m.freq ?? m.frequency ?? ""}`.trim());
}

export function modifyMed(id: string, patch: Partial<Medication>, actor = "human") {
  set((s) => {
    if (!s.caseData) return {};
    const c = structuredClone(s.caseData);
    c.medications = (c.medications ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    return { caseData: c };
  });
  log(actor, "modify_med", `${id} ${patch.dose ?? ""} ${patch.freq ?? patch.frequency ?? ""}`.trim());
}

export function discontinueMed(id: string, actor = "human") {
  set((s) => {
    if (!s.caseData) return {};
    const c = structuredClone(s.caseData);
    c.medications = (c.medications ?? []).map((m) => (m.id === id ? { ...m, status: "discontinued" } : m));
    return { caseData: c };
  });
  log(actor, "discontinue_med", id);
}

export function addProblem(p: Partial<Problem>, actor = "human") {
  set((s) => {
    if (!s.caseData) return {};
    const c = structuredClone(s.caseData);
    c.problems = [
      ...(c.problems ?? []),
      { code: "", system: "ICD-10", name: "New problem", clazz: "Chronic", status: "Active", ...p } as Problem,
    ];
    return { caseData: c };
  });
  log(actor, "add_problem", `${p.name ?? ""} ${p.code ?? ""}`.trim());
}

export function setProblemStatus(code: string, status: string, actor = "human") {
  set((s) => {
    if (!s.caseData) return {};
    const c = structuredClone(s.caseData);
    c.problems = (c.problems ?? []).map((p) => (p.code === code ? { ...p, status } : p));
    return { caseData: c };
  });
  log(actor, status === "Resolved" ? "resolve_problem" : "reactivate_problem", code);
}

export function saveDeliverable(text: string, actor = "human") {
  set({ deliverable: text ?? "", noteDraft: text ?? "" });
  log(actor, "save_deliverable", `${(text ?? "").length} chars`);
}

/** The Clinical Notes free-text box. It lives in the store so a study checkpoint can carry an unsaved draft;
 *  it is not audited and not part of the graded snapshot. saveDeliverable() is what commits it. */
export function setNoteDraft(text: string) {
  set({ noteDraft: text ?? "" });
}

// ---- checkpoint and resume (study layer) ----
// Everything a participant can change, plus the audit log and the order counter, so a reload or a new
// browser lands back in the same episode. The case itself is refetched; only its editable parts
// (medications, problems) are carried.
export interface Checkpoint {
  runId: string;
  savedAt: string;
  activity: string;
  crSubtab: string;
  orders: Order[];
  orderSeq: number;
  deliverable: string;
  noteDraft: string;
  patientReply?: string;
  noteExam: Record<string, string[]>;
  advisoryResponses: { kind: string | null; action: string }[];
  alertsAcked?: number[];
  visitSigned: boolean;
  phoneCalls?: PhoneCall[];
  letters?: LetterRecord[];
  addenda?: Addendum[];
  roiRequests?: RoiRequest[];
  referrals?: Referral[];
  duplicateReviews?: DuplicateReview[];
  disclosures?: Disclosure[];
  audit: AuditEntry[];
  case: { id: string; medications?: Medication[]; problems?: Problem[] } | null;
}

export function checkpoint(): Checkpoint {
  const s = state;
  return JSON.parse(
    JSON.stringify({
      runId: s.runId,
      savedAt: now(),
      activity: s.activity,
      crSubtab: s.crSubtab,
      orders: s.orders,
      orderSeq: _orderSeq,
      deliverable: s.deliverable,
      noteDraft: s.noteDraft,
      patientReply: s.patientReply,
      noteExam: s.noteExam,
      advisoryResponses: s.advisoryResponses,
      alertsAcked: s.alertsAcked,
      visitSigned: s.visitSigned,
      phoneCalls: s.phoneCalls,
      letters: s.letters,
      addenda: s.addenda,
      roiRequests: s.roiRequests,
      referrals: s.referrals,
      duplicateReviews: s.duplicateReviews,
      disclosures: s.disclosures,
      audit: s.audit,
      case: s.caseData ? { id: s.caseData.id, medications: s.caseData.medications, problems: s.caseData.problems } : null,
    }),
  );
}

/** Restore a checkpoint over a freshly fetched case and log one `resume` entry. */
export function hydrate(c: Case, cp: Checkpoint, actor = "system") {
  const fresh = structuredClone(c);
  if (cp.case?.medications) fresh.medications = cp.case.medications;
  if (cp.case?.problems) fresh.problems = cp.case.problems;
  _orderSeq = Math.max(cp.orderSeq ?? 0, ...cp.orders.map((o) => Number(/^ord(\d+)$/.exec(o.id)?.[1] ?? 0)));
  set({
    caseData: fresh,
    activity: cp.activity,
    crSubtab: cp.crSubtab,
    orders: cp.orders,
    deliverable: cp.deliverable ?? "",
    noteDraft: cp.noteDraft ?? cp.deliverable ?? "",
    patientReply: cp.patientReply ?? "",
    patientReplyDraft: cp.patientReply ?? "",
    noteExam: cp.noteExam ?? {},
    advisoryResponses: cp.advisoryResponses ?? [],
    alertsAcked: cp.alertsAcked ?? [],
    visitSigned: !!cp.visitSigned,
    phoneCalls: cp.phoneCalls ?? [],
    letters: cp.letters ?? [],
    addenda: cp.addenda ?? [],
    roiRequests: cp.roiRequests ?? [],
    referrals: cp.referrals ?? [],
    duplicateReviews: cp.duplicateReviews ?? [],
    disclosures: cp.disclosures ?? [],
    audit: cp.audit ?? [],
    runId: cp.runId,
    modal: null,
    menuOpen: false,
    searchOpen: false,
  });
  log(actor, "resume", cp.savedAt);
}

// ---- React binding. Select narrow, stable slices (caseData/activity/orders are stable refs
// between renders; do projection work in the component, not in the selector). ----
export function useSim<T>(selector: (s: SimState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}
