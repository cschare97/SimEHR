"use client";

import { useState } from "react";
import { useSim, closeModal, respondAdvisory, signVisit, advisoryId, logPhoneCall, sendLetter, saveAddendum, submitRoi, addReferral, advanceReferral, reviewDuplicate, type DuplicateDecision, todayLocal, REFERRAL_FLOW, type ReferralStatus, addDays, ROI_CORE, ROI_STATEMENTS } from "@/lib/store";
import { noteWhen } from "@/lib/types";
import { matchEvidence } from "@/lib/duplicates";
import { cardOrders, imagingNotes, labOrders, otherOrders, procOrders, radOrders, referralOrders } from "@/lib/projections";
import CRLabReport from "@/components/activities/CRLabReport";
import { ECGReport, EncounterReport, ImagingReport, MedReport, NoteReport, OrderReport } from "@/components/activities/CRReports";

function AdvisoryModal({ idx }: { idx: number }) {
  const c = useSim((s) => s.caseData)!;
  const advisory = (c.advisories ?? [])[idx];
  if (!advisory) return null;
  const kind = advisoryId(advisory, idx); // never null, so two advisories cannot answer for each other
  return (
    <div className="modal advisory" id="modal-content">
      <div className="modal-header">
        <span>
          <span className="advisory-icon">⚠</span>Clinical Alert
        </span>
        <span className="x" onClick={closeModal}>✕</span>
      </div>
      <div className="modal-body">
        <div dangerouslySetInnerHTML={{ __html: advisory.text }} />
        <label>If overriding, document reason:</label>
        <select style={{ width: "100%" }} data-testid="advisory-reason" defaultValue="—">
          <option>—</option>
          <option>Patient refused</option>
          <option>Will reassess at next visit</option>
          <option>Already addressed</option>
          <option>Not medically appropriate</option>
        </select>
      </div>
      <div className="modal-footer">
        <button className="btn" data-testid="advisory-cancel" onClick={() => respondAdvisory(kind, "cancel", "human")}>
          Cancel
        </button>
        <button className="btn" data-testid="advisory-acknowledge" onClick={() => respondAdvisory(kind, "acknowledge", "human")}>
          Acknowledge
        </button>
        <button className="btn primary" data-testid="advisory-accept" onClick={() => respondAdvisory(kind, "accept", "human")}>
          Accept
        </button>
      </div>
    </div>
  );
}

function SignVisitModal() {
  const orders = useSim((s) => s.orders);
  const deliverable = useSim((s) => s.deliverable);
  const acked = useSim((s) => s.alertsAcked);
  const c = useSim((s) => s.caseData)!;
  const deficiencies: { level: "red" | "yellow"; text: string }[] = [];
  if (deliverable.trim().length < 20) deficiencies.push({ level: "red", text: "Assessment & Plan is missing or too short." });
  if (orders.length === 0) deficiencies.push({ level: "yellow", text: "No orders entered this visit." });
  // The alerts are the bell's recent-activity items (not the withheld advisories, see RightRail.tsx), so
  // this warning can be acted on from the bell.
  const openAlerts = (c.recentActivity ?? []).filter((_, i) => !acked.includes(i)).length;
  if (openAlerts > 0) deficiencies.push({ level: "yellow", text: `${openAlerts} alert${openAlerts === 1 ? "" : "s"} not yet acknowledged (bell icon).` });
  const hasRed = deficiencies.some((d) => d.level === "red");

  return (
    <div className="modal" id="modal-content">
      <div className="modal-header">
        <span>Sign Encounter — Pre-flight Check</span>
        <span className="x" onClick={closeModal}>✕</span>
      </div>
      <div className="modal-body">
        {deficiencies.length === 0 ? (
          <p style={{ color: "var(--ok-green)", fontWeight: 700 }}>✓ No deficiencies. Ready to sign.</p>
        ) : (
          <>
            <p>The following items need attention before signing:</p>
            {deficiencies.map((d, i) => (
              <div
                key={i}
                style={{
                  padding: "5px 8px",
                  margin: "3px 0",
                  borderLeft: `3px solid ${d.level === "red" ? "var(--alert-red)" : "var(--warn-amber)"}`,
                  background: d.level === "red" ? "var(--alert-red-bg)" : "var(--warn-amber-bg)",
                }}
              >
                <b style={{ color: d.level === "red" ? "var(--alert-red)" : "var(--warn-amber)" }}>●</b> {d.text}
              </div>
            ))}
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>Red = required · Yellow = warning (can sign anyway)</p>
          </>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Cancel</button>
        {!hasRed && (
          <button className="btn primary" data-testid="sign-final" onClick={() => signVisit("human")}>
            {deficiencies.length === 0 ? "Sign Encounter" : "Sign Anyway"}
          </button>
        )}
      </div>
    </div>
  );
}

// Neutral sign confirmation — NO in-app score/evaluation. Grading is external (benchmark/harness reads
// window.SimEHR.getState()/getAuditLog()); the app must never show the agent a score or checkpoint verdicts.
function SignResultModal() {
  return (
    <div className="modal" id="modal-content">
      <div className="modal-header">
        <span>Visit Signed</span>
        <span className="x" onClick={closeModal}>✕</span>
      </div>
      <div className="modal-body">
        <p style={{ color: "var(--ok-green)", fontWeight: 700, marginTop: 0 }}>✓ The visit has been signed.</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>The encounter is complete.</p>
      </div>
      <div className="modal-footer">
        <button className="btn primary" onClick={closeModal}>Close</button>
      </div>
    </div>
  );
}

// Full-size report viewer, opened by double-clicking a Chart Review row. `kind` is "<family>:<id>" with
// the same families as the sub-tabs, and the body is the sub-tab's own preview renderer.
function ReportModal({ kind }: { kind: string }) {
  const c = useSim((s) => s.caseData)!;
  const i = kind.indexOf(":");
  const what = i < 0 ? kind : kind.slice(0, i);
  const id = i < 0 ? "" : kind.slice(i + 1);
  let title = "Report";
  let body: React.ReactNode = null;
  if (what === "enc") {
    const enc = (c.encounters ?? []).find((e) => e.id === id);
    if (enc) { title = `${enc.type} · ${enc.date}`; body = <EncounterReport c={c} enc={enc} />; }
  } else if (what === "note") {
    const n = (c.notes ?? []).find((x) => x.id === id);
    if (n) { title = `${n.type} · ${n.author}`; body = <NoteReport c={c} note={n} />; }
  } else if (what === "med") {
    const m = (c.medications ?? []).find((x) => x.id === id);
    if (m) { title = `${m.name} ${m.dose ?? ""}`.trim(); body = <MedReport c={c} med={m} />; }
  } else if (what === "lab") {
    const o = labOrders(c).find((x) => x.key === id);
    if (o) {
      title = `${o.panel} · ${o.date}`;
      body = <CRLabReport order={o} patient={c.patient} enc={(c.encounters ?? []).find((e) => e.id === o.id)} />;
    }
  } else if (what === "card") {
    const o = cardOrders(c).find((x) => x.id === id);
    if (o) { title = `${o.name} · ${o.date}`; body = <ECGReport c={c} order={o} />; }
  } else if (what === "rad") {
    const o = radOrders(c).find((x) => x.id === id);
    if (o) {
      title = `${o.name} · ${o.date}`;
      body = <ImagingReport c={c} order={o} note={imagingNotes(c).find((n) => noteWhen(n).slice(0, 10) === o.date)} />;
    }
  } else {
    const o = [...referralOrders(c), ...procOrders(c), ...otherOrders(c)].find((x) => x.id === id);
    if (o) {
      title = o.name;
      const note = (c.notes ?? []).find((n) => n.type === "E-Consult Order" && noteWhen(n).slice(0, 10) === o.date && o.type === "E-Consult");
      body = <OrderReport c={c} order={o} note={note} />;
    }
  }
  return (
    <div className="modal report" id="modal-content" data-testid="report-modal">
      <div className="modal-header">
        <span>{title}</span>
        <span className="x" data-testid="report-modal-close" onClick={closeModal}>✕</span>
      </div>
      <div className="modal-body">{body ?? <span className="ep-dim">This record is not available.</span>}</div>
    </div>
  );
}

const OUTCOMES = ["Spoke with patient", "Left voicemail", "No answer", "Spoke with family/caregiver"];
const LETTER_KINDS = ["Appointment reminder", "Test results", "Referral notice", "Records release", "General"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>{label}</div>
      {children}
    </label>
  );
}

function PhoneCallModal() {
  const p = useSim((s) => s.caseData)!.patient;
  const [who, setWho] = useState(p.name);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState(OUTCOMES[0]);
  const [notes, setNotes] = useState("");
  return (
    <div className="modal" id="modal-content" data-testid="modal-phonecall">
      <div className="modal-header"><span>Telephone Call</span><span className="x" onClick={closeModal}>✕</span></div>
      <div className="modal-body">
        <Field label="Spoke with"><input data-testid="call-with" value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="Phone number"><input data-testid="call-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Reason"><input data-testid="call-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Outcome">
          <select data-testid="call-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {OUTCOMES.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea data-testid="call-notes" rows={4} style={{ width: "100%" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" data-testid="call-save" disabled={!reason.trim()} onClick={() => logPhoneCall({ with: who, phone, reason, outcome, notes })}>Save Call</button>
      </div>
    </div>
  );
}

function LetterModal() {
  const p = useSim((s) => s.caseData)!.patient;
  const [to, setTo] = useState(p.name);
  const [kind, setKind] = useState(LETTER_KINDS[0]);
  const [body, setBody] = useState("");
  return (
    <div className="modal" id="modal-content" data-testid="modal-letter">
      <div className="modal-header"><span>Send Letter</span><span className="x" onClick={closeModal}>✕</span></div>
      <div className="modal-body">
        <Field label="To"><input data-testid="letter-to" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Letter type">
          <select data-testid="letter-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {LETTER_KINDS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Body"><textarea data-testid="letter-body" rows={6} style={{ width: "100%" }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" data-testid="letter-send" disabled={!body.trim()} onClick={() => sendLetter({ to, kind, body })}>Send</button>
      </div>
    </div>
  );
}

function AddendumModal() {
  const [text, setText] = useState("");
  return (
    <div className="modal" id="modal-content" data-testid="modal-addendum">
      <div className="modal-header"><span>Addendum</span><span className="x" onClick={closeModal}>✕</span></div>
      <div className="modal-body">
        <Field label="Addendum text"><textarea data-testid="addendum-text" rows={6} style={{ width: "100%" }} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" data-testid="addendum-save" disabled={!text.trim()} onClick={() => saveAddendum(text)}>Save Addendum</button>
      </div>
    </div>
  );
}

function RoiModal() {
  const p = useSim((s) => s.caseData)!.patient;
  const [kind, setKind] = useState<"access" | "authorization">("access");
  const [requester, setRequester] = useState(p.name);
  const [recipient, setRecipient] = useState("");
  const [info, setInfo] = useState("");
  const [received, setReceived] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const [present, setPresent] = useState<string[]>([]);
  const toggle = (e: string) => setPresent((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e]));
  return (
    <div className="modal" id="modal-content" data-testid="modal-roi">
      <div className="modal-header"><span>Release of Information</span><span className="x" onClick={closeModal}>✕</span></div>
      <div className="modal-body">
        <Field label="Request type">
          <select data-testid="roi-kind" value={kind} onChange={(e) => setKind(e.target.value as "access" | "authorization")}>
            <option value="access">Patient access to own record (45 CFR 164.524)</option>
            <option value="authorization">Disclosure to third party by authorization (45 CFR 164.508)</option>
          </select>
        </Field>
        <Field label="Requester"><input data-testid="roi-requester" value={requester} onChange={(e) => setRequester(e.target.value)} /></Field>
        <Field label="Send records to"><input data-testid="roi-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
        <Field label="Information requested"><input data-testid="roi-info" value={info} onChange={(e) => setInfo(e.target.value)} /></Field>
        <Field label="Date received"><input data-testid="roi-received" type="date" value={received} onChange={(e) => setReceived(e.target.value)} /></Field>
        <p data-testid="roi-due" style={{ margin: "4px 0 10px" }}>Respond by: <b>{addDays(received, 30) || "—"}</b> (30 calendar days; one 30-day extension allowed with written notice)</p>
        {kind === "authorization" && (
          <div data-testid="roi-checklist">
            <div style={{ fontWeight: 700, marginBottom: 3 }}>Authorization on file contains (check each):</div>
            {[...ROI_CORE, ...ROI_STATEMENTS].map((e) => (
              <label key={e} style={{ display: "block" }}>
                <input type="checkbox" data-testid={`roi-el-${e.toLowerCase().replace(/[^a-z]+/g, "-")}`} checked={present.includes(e)} onChange={() => toggle(e)} /> {e}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" data-testid="roi-submit" disabled={!recipient.trim() || !info.trim() || !received} onClick={() => submitRoi({ kind, requester, recipient, info, received, present })}>Log Request</button>
      </div>
    </div>
  );
}

function ReferralModal() {
  const c = useSim((s) => s.caseData)!;
  const refs = useSim((s) => s.referrals);
  const [specialty, setSpecialty] = useState("");
  const [reason, setReason] = useState("");
  const [orderedBy, setOrderedBy] = useState(c.provider ?? "");
  const [ordered, setOrdered] = useState(todayLocal);
  const [openId, setOpenId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal);
  const [from, setFrom] = useState("");
  const [err, setErr] = useState("");
  const nextOf = (s: ReferralStatus) => REFERRAL_FLOW[REFERRAL_FLOW.indexOf(s as (typeof REFERRAL_FLOW)[number]) + 1];
  const closed = (s: ReferralStatus) => s === "Report Received" || s === "Cancelled";
  const go = (id: string, to: ReferralStatus) => {
    const e = advanceReferral(id, to, { date, reportFrom: from });
    setErr(e ?? "");
    if (!e) { setOpenId(null); setFrom(""); }
  };
  return (
    <div className="modal" id="modal-content" data-testid="modal-referrals" style={{ minWidth: 640 }}>
      <div className="modal-header"><span>Referral Tracking</span><span className="x" onClick={closeModal}>✕</span></div>
      <div className="modal-body">
        <table data-testid="ref-table" style={{ width: "100%", marginBottom: 12 }}>
          <thead><tr><th align="left">Specialty</th><th align="left">Reason</th><th align="left">Ordered</th><th align="left">Status</th><th /></tr></thead>
          <tbody>
            {refs.length === 0 && <tr><td colSpan={5}>No referrals tracked yet.</td></tr>}
            {refs.map((r) => (
              <tr key={r.id} data-testid={`ref-row-${r.id}`}>
                <td>{r.specialty}</td><td>{r.reason}</td><td>{r.ordered}</td>
                <td data-testid={`ref-status-${r.id}`}><b>{r.status}</b>{r.status === "Report Received" ? " ✓ loop closed" : ""}</td>
                <td>
                  {!closed(r.status) && (
                    <>
                      <button className="btn" data-testid={`ref-next-${r.id}`} onClick={() => { setOpenId(r.id); setErr(""); }}>Mark {nextOf(r.status)}</button>{" "}
                      {r.status !== "Completed" && <button className="btn" data-testid={`ref-cancel-${r.id}`} onClick={() => go(r.id, "Cancelled")}>Cancel</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {openId && (() => {
          const r = refs.find((x) => x.id === openId)!;
          const to = nextOf(r.status) as ReferralStatus;
          return (
            <div style={{ border: "1px solid #ccc", padding: 8, marginBottom: 12 }} data-testid="ref-advance">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{r.specialty}: mark {to}</div>
              <Field label="Date"><input data-testid="ref-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {to === "Report Received" && <Field label="Report received from (specialist)"><input data-testid="ref-from" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>}
              <button className="btn primary" data-testid="ref-confirm" onClick={() => go(r.id, to)}>Confirm</button>{" "}
              <button className="btn" onClick={() => setOpenId(null)}>Back</button>
            </div>
          );
        })()}
        {err && <p data-testid="ref-error" style={{ color: "#b00020", fontWeight: 700 }}>{err}</p>}
        <div style={{ fontWeight: 700, marginBottom: 3 }}>Add referral</div>
        <Field label="Specialty"><input data-testid="ref-specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} /></Field>
        <Field label="Reason"><input data-testid="ref-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Ordered by"><input data-testid="ref-orderedby" value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} /></Field>
        <Field label="Date ordered"><input data-testid="ref-ordered" type="date" value={ordered} onChange={(e) => setOrdered(e.target.value)} /></Field>
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Close</button>
        <button className="btn primary" data-testid="ref-add" disabled={!specialty.trim() || !reason.trim() || !orderedBy.trim() || !ordered} onClick={() => { addReferral({ specialty, reason, orderedBy, ordered }); setSpecialty(""); setReason(""); }}>Add Referral</button>
      </div>
    </div>
  );
}

function DuplicateModal() {
  const pt = useSim((s) => s.caseData)!.patient;
  const [oMrn, setOMrn] = useState("");
  const [oName, setOName] = useState("");
  const [oDob, setODob] = useState("");
  const [aLast, setALast] = useState("");
  const [aNext, setANext] = useState("");
  const [oLast, setOLast] = useState("");
  const [oNext, setONext] = useState("");
  const [decision, setDecision] = useState<DuplicateDecision>("escalate");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState("");
  const a = { mrn: pt.mrn, name: pt.name, dob: pt.dob, lastAppt: aLast || undefined, nextAppt: aNext || undefined };
  const b = { mrn: oMrn.trim(), name: oName, dob: oDob, lastAppt: oLast || undefined, nextAppt: oNext || undefined };
  const ev = matchEvidence(a, b);
  return (
    <div className="modal" id="modal-content" data-testid="modal-duplicates">
      <div className="modal-header"><span>Duplicate Chart Review</span><span className="x" onClick={closeModal}>✕</span></div>
      <div className="modal-body">
        <p style={{ marginBottom: 8 }}>This chart: <b>{pt.name}</b> · MRN {pt.mrn} · DOB {pt.dob}</p>
        <Field label="Suspected duplicate: MRN"><input data-testid="dup-mrn" value={oMrn} onChange={(e) => setOMrn(e.target.value)} /></Field>
        <Field label="Name (Last, First)"><input data-testid="dup-name" value={oName} onChange={(e) => setOName(e.target.value)} /></Field>
        <Field label="Date of birth"><input data-testid="dup-dob" type="date" value={oDob} onChange={(e) => setODob(e.target.value)} /></Field>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>Appointments (optional)</div>
        <Field label="This chart: last visit"><input data-testid="dup-a-last" type="date" value={aLast} onChange={(e) => setALast(e.target.value)} /></Field>
        <Field label="This chart: next visit"><input data-testid="dup-a-next" type="date" value={aNext} onChange={(e) => setANext(e.target.value)} /></Field>
        <Field label="Other chart: last visit"><input data-testid="dup-b-last" type="date" value={oLast} onChange={(e) => setOLast(e.target.value)} /></Field>
        <Field label="Other chart: next visit"><input data-testid="dup-b-next" type="date" value={oNext} onChange={(e) => setONext(e.target.value)} /></Field>
        <p data-testid="dup-evidence" style={{ margin: "4px 0 10px" }}>Matching identifiers: <b>{ev.length ? ev.join(", ") : "none"}</b> ({ev.length} of 3)</p>
        <Field label="Decision">
          <select data-testid="dup-decision" value={decision} onChange={(e) => setDecision(e.target.value as DuplicateDecision)}>
            <option value="escalate">Escalate to human review</option>
            <option value="not_duplicate">Not a duplicate</option>
            <option value="merge">Merge (same person)</option>
          </select>
        </Field>
        <Field label="Rationale"><textarea data-testid="dup-why" rows={3} style={{ width: "100%" }} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
        <p style={{ fontSize: 12 }}>Recording a decision does not change either chart. A merge is carried out separately by HIM.</p>
        {err && <p data-testid="dup-error" style={{ color: "#b00020", fontWeight: 700 }}>{err}</p>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={closeModal}>Cancel</button>
        <button className="btn primary" data-testid="dup-save" onClick={() => setErr(reviewDuplicate(a, b, decision, why) ?? "")}>Record Decision</button>
      </div>
    </div>
  );
}

export default function ModalHost() {
  const modal = useSim((s) => s.modal);
  if (!modal) return null;
  return (
    <div className="modal-backdrop open" id="modal" onClick={(e) => e.target === e.currentTarget && closeModal()}>
      {modal.type === "advisory" && <AdvisoryModal idx={Number(modal.kind ?? 0)} />}
      {modal.type === "report" && <ReportModal kind={modal.kind ?? ""} />}
      {modal.type === "signvisit" && <SignVisitModal />}
      {modal.type === "signresult" && <SignResultModal />}
      {modal.type === "phonecall" && <PhoneCallModal />}
      {modal.type === "letter" && <LetterModal />}
      {modal.type === "addendum" && <AddendumModal />}
      {modal.type === "roi" && <RoiModal />}
      {modal.type === "referrals" && <ReferralModal />}
      {modal.type === "duplicates" && <DuplicateModal />}
    </div>
  );
}
