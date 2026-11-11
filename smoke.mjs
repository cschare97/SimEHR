// Headless smoke test for any case — two layers:
//   A. STATIC (no server needed): the manifest and the case file are consistent and well-formed, and no
//      other registered patient's identity appears inside the file.
//   B. BROWSER (needs the app on :8766): drives the app like an agent (DOM clicks on data-testid plus
//      window.SimEHR) through the main surfaces and the write actions, checks the audit log, and
//      switches to another case and back without the previous patient leaking into the chart.
// Run: node smoke.mjs            SMOKE_CASE=<id> picks a case (default: the manifest's default case)
//                                SMOKE_STATIC=1 runs layer A only
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:8766";
const here = dirname(fileURLToPath(import.meta.url));
const log = (ok, msg) => console.log(`${ok ? "✓" : "✗"} ${msg}`);
let failures = 0;
const assert = (cond, msg) => { if (!cond) failures++; log(cond, msg); };
const readCase = (id) => JSON.parse(readFileSync(join(here, `public/cases/${id}.json`), "utf8"));

// ---------------------------------------------------------------------------
// A. Static checks
// ---------------------------------------------------------------------------
const idx = JSON.parse(readFileSync(join(here, "public/cases/index.json"), "utf8"));
const CASE_ID = process.env.SMOKE_CASE || idx.default;
assert(idx.cases.some((c) => c.id === CASE_ID), `${CASE_ID} is registered in index.json`);
const dangling = idx.cases.filter((c) => !existsSync(join(here, "public/cases", c.file ?? `${c.id}.json`)));
assert(dangling.length === 0, `every registered case file exists${dangling.length ? " — MISSING: " + dangling.map((c) => c.id).join(", ") : ""}`);
const CASE = readCase(CASE_ID);
assert(CASE.id === CASE_ID, "case.id matches the file name");
assert(!!(CASE.patient?.name && CASE.patient?.mrn), "the patient has a name and an MRN");
for (const k of ["encounters", "problems", "medications", "observations", "notes"]) {
  assert(Array.isArray(CASE[k]), `case.${k} is an array`);
}
const encIds = new Set((CASE.encounters ?? []).map((e) => e.id));
assert(encIds.size === (CASE.encounters ?? []).length, "encounter ids are unique");
const linked = [...(CASE.observations ?? []), ...(CASE.medications ?? []), ...(CASE.notes ?? []), ...(CASE.orderHistory ?? [])];
const orphans = linked.filter((x) => x.encounterId && !encIds.has(x.encounterId));
assert(orphans.length === 0, `every encounterId points at an encounter (${orphans.length} orphans)`);
const raw = JSON.stringify(CASE);
for (const other of idx.cases) {
  if (other.id === CASE_ID) continue;
  const mrn = readCase(other.id).patient?.mrn;
  if (mrn && mrn !== CASE.patient.mrn) assert(!raw.includes(mrn), `no leak: ${other.id}'s MRN absent from ${CASE_ID}`);
}
console.log(`\n[static] ${CASE_ID}: ${failures ? failures + " FAILURE(S)" : "OK"} — ${(CASE.encounters ?? []).length} encounters, ${(CASE.observations ?? []).length} observations, ${(CASE.notes ?? []).length} notes\n`);
if (process.env.SMOKE_STATIC === "1") {
  console.log(failures ? `${failures} CHECK(S) FAILED` : "ALL STATIC CHECKS PASSED ✓");
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------------
// B. Browser flow (agent-style DOM interaction)
// ---------------------------------------------------------------------------
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${BASE}/?case=${CASE_ID}`, { waitUntil: "networkidle" });
const lastName = (CASE.patient.name ?? "").split(",")[0].trim();

// 1. The chart renders and the agent API reflects it
await page.waitForSelector('[data-testid="pt-name"]', { timeout: 8000 });
assert((await page.textContent('[data-testid="pt-name"]'))?.includes(lastName), `the chart renders: patient sidebar shows ${lastName}`);
const st = await page.evaluate(() => window.SimEHR.getState());
assert(st.case?.id === CASE_ID, `window.SimEHR.getState() → case ${st.case?.id}`);
assert((st.case?.observations?.length ?? 0) === (CASE.observations ?? []).length, `state carries all ${(CASE.observations ?? []).length} observations`);
for (const k of ["activity", "crSubtab", "orders", "deliverable", "patientReply", "noteExam", "advisoryResponses", "visitSigned", "runId"]) {
  assert(k in st, `state has '${k}'`);
}

// 2. Chart Review: the encounter grid, the report viewer, the filter chips
await page.click('[data-testid="tab-chart-review"]');
await page.click('[data-testid="cr-subtab-Encounters"]');
await page.waitForSelector('[data-testid="cr-encounters"]');
const rows = await page.$$('[data-testid="cr-encounters"] tr.row');
assert(rows.length > 0, `Encounters tab lists ${rows.length} encounters`);
await rows[0].dblclick();
assert((await page.$('[data-testid="report-modal"]')) !== null, "double-click on an encounter opens the report viewer");
await page.click('[data-testid="report-modal-close"]');
await page.click('[data-testid="cr-filter-Encounters-Admissions"]');
await page.locator(".filter-row .clear-filters").first().click();
assert((await page.$$eval(".filter-row .f-chip.on", (els) => els.length)) === 0, "Clear Filters unchecks every chip");

// 3. Labs and Results Review (when the chart has laboratory results)
if ((CASE.observations ?? []).some((o) => o.category === "laboratory")) {
  await page.click('[data-testid="cr-subtab-Labs"]');
  await page.waitForSelector('[data-testid="cr-labs"]');
  assert((await page.$('[data-testid^="cr-lab-"]')) !== null, "Labs tab lists lab orders");
  await page.click('[data-testid="tab-results"]');
  await page.waitForSelector('[data-testid="flowsheet"]');
  assert((await page.$$eval('[data-testid^="flow-row-"]', (els) => els.length)) > 0, "Results Review flowsheet has rows");
} else {
  log(true, "chart has no laboratory results; Labs and Results Review not exercised");
}

// 4. The alerts bell lists the chart's recent activity
await page.click('[data-testid="topbar-alerts"]');
const notifN = await page.$$eval('[data-testid="notifications"] .ni:not(.dim)', (els) => els.length);
assert(notifN === (CASE.recentActivity ?? []).length, `the bell lists ${notifN} recent-activity items`);
if (notifN > 0) {
  await page.click('[data-testid="alert-ack-0"]');
  assert(await page.evaluate(() => window.SimEHR.getAuditLog().some((a) => a.action === "alert_ack")), "acknowledging an alert is audited");
}
await page.click('[data-testid="notifications-backdrop"]');

// 5. Problem List: diagnosis search fills the code
await page.click('[data-testid="tab-problem-list"]');
await page.click('[data-testid="pl-add-problem"]');
await page.locator('[data-testid="pl-add-name"]').pressSequentially("hypertension");
await (await page.waitForSelector('[data-testid^="pl-dx-result-"]')).click();
assert(/^[A-Z]\d/.test(await page.inputValue('[data-testid="pl-add-code"]')), "diagnosis search fills the ICD-10 code");
await page.click('[data-testid="pl-add-cancel"]');

// 6. Orders: search-as-you-type, sig fields, signing
await page.click('[data-testid="tab-orders"]');
await page.locator('[data-testid="order-search"]').pressSequentially("empagliflozin");
await (await page.waitForSelector('[data-testid^="order-result-"]')).click();
const sigRow = await page.$('[data-testid^="order-sig-"]');
assert(sigRow !== null, "a medication order gets dose / route / frequency / duration fields");
if (sigRow) {
  const sigId = (await sigRow.getAttribute("data-testid")).replace("order-sig-", "");
  await page.fill(`[data-testid="order-dose-${sigId}"]`, "10 mg");
  await page.selectOption(`[data-testid="order-sig-${sigId}"] select >> nth=0`, "PO");
  const sig = await page.evaluate((id) => window.SimEHR.getState().orders.find((o) => o.id === id)?.sig, sigId);
  assert(sig === "10 mg PO", `the sig is stored on the order (${sig})`);
}
await page.evaluate(() => window.SimEHR.signOrders());
const signed = await page.evaluate(() => window.SimEHR.getState().orders.filter((o) => o.status === "signed").length);
assert(signed === 1, `signOrders() signs the pending order (${signed} signed)`);

// 7. Clinical Notes: the exam picker toggle and the saved assessment
await page.click('[data-testid="tab-notewriter"]');
await page.click('[data-testid="nw-toggle-exam"]');
assert((await page.$(".nw-picker")) === null, "Hide Exam hides the pill picker");
await page.click('[data-testid="nw-toggle-exam"]');
await page.evaluate(() => window.SimEHR.saveDeliverable("Assessment and plan written by the smoke test."));
assert((await page.evaluate(() => window.SimEHR.getDeliverable())).includes("smoke test"), "saveDeliverable() stores the note text");

// 8. Medications: a write through the DOM is audited
await page.click('[data-testid="tab-medications"]');
await page.waitForSelector('[data-testid="medications"]');
const dcBtn = await page.$('[data-testid^="med-dc-"]');
if (dcBtn) {
  await dcBtn.click();
  assert(await page.evaluate(() => window.SimEHR.getAuditLog().some((a) => a.action === "discontinue_med")), "discontinuing a medication is audited");
} else {
  log(true, "no active medication to discontinue; skipped");
}

// 9. Patient Summary is reached through the API (it is not on the tab strip)
await page.evaluate(() => window.SimEHR.switchActivity("snapshot"));
await page.waitForFunction(() => window.SimEHR.getState().activity === "snapshot");
assert((await page.$('[data-testid="snap-view-snapshot"]')) !== null, "Patient Summary renders its report toolbar");
const audit = await page.evaluate(() => window.SimEHR.getAuditLog().map((a) => a.action));
for (const a of ["switch_activity", "chart_review_subtab", "add_order", "sign_orders", "save_deliverable"]) {
  assert(audit.includes(a), `audit log records ${a}`);
}

// 10. Switching to another case and back leaves nothing of the previous patient behind
const other = idx.cases.find((c) => c.id !== CASE_ID);
if (other) {
  const OTHER = readCase(other.id);
  const otherLast = (OTHER.patient?.name ?? "").split(",")[0].trim();
  await page.evaluate((id) => window.SimEHR.loadCase(id), other.id);
  await page.waitForFunction((n) => document.querySelector('[data-testid="pt-name"]')?.textContent?.includes(n), otherLast, { timeout: 8000 });
  let body = await page.evaluate(() => document.body.innerText);
  assert(!body.includes(`${lastName},`) && !body.includes(CASE.patient.mrn), `no leak: ${CASE_ID}'s patient absent after switching to ${other.id}`);
  await page.evaluate((id) => window.SimEHR.loadCase(id), CASE_ID);
  await page.waitForFunction((n) => document.querySelector('[data-testid="pt-name"]')?.textContent?.includes(n), lastName, { timeout: 8000 });
  body = await page.evaluate(() => document.body.innerText);
  assert(!body.includes(OTHER.patient.mrn), `no leak: ${other.id}'s patient absent after switching back`);
} else {
  log(true, "only one case is registered; the cross-case leak check was skipped");
}

// 10b. Patient Care workflows (phone call, letter, addendum, ROI, referral tracking, duplicate review)
const S = () => page.evaluate(() => window.SimEHR.getState());
const openMenu = async (label, testid) => {
  await page.evaluate((l) => window.SimEHR.menuSelect(l), label);
  await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 5000 });
};
await openMenu("Telephone Call", "modal-phonecall");
await page.fill('[data-testid="call-reason"]', "smoke test callback");
await page.click('[data-testid="call-save"]');
assert((await S()).phoneCalls.length === 1, "Telephone Call: a call is recorded");
await openMenu("Send Letter", "modal-letter");
await page.fill('[data-testid="letter-body"]', "Smoke test letter.");
await page.click('[data-testid="letter-send"]');
assert((await S()).letters.length === 1, "Send Letter: a letter is recorded");
await openMenu("Addendum", "modal-addendum");
await page.fill('[data-testid="addendum-text"]', "Smoke test addendum.");
await page.click('[data-testid="addendum-save"]');
assert((await S()).addenda.length === 1, "Addendum: an addendum is recorded");

await openMenu("Release of Information", "modal-roi");
await page.selectOption('[data-testid="roi-kind"]', "authorization");
await page.fill('[data-testid="roi-recipient"]', "Outside clinic");
await page.fill('[data-testid="roi-info"]', "Last 2 years of notes");
await page.fill('[data-testid="roi-received"]', "2026-01-01");
await page.click('[data-testid="roi-submit"]');
let roi = (await S()).roiRequests;
assert(roi.length === 1 && roi[0].status.startsWith("Deficient") && roi[0].missing.length === 9, "ROI: an authorization with no elements is Deficient (9 missing)");
assert(roi[0].due === "2026-01-31", "ROI: due date is 30 calendar days after receipt");
await openMenu("Release of Information", "modal-roi");
await page.fill('[data-testid="roi-recipient"]', "Self");
await page.fill('[data-testid="roi-info"]', "Full chart");
await page.click('[data-testid="roi-submit"]');
roi = (await S()).roiRequests;
assert(roi.length === 2 && roi[1].kind === "access" && roi[1].status === "Ready to release", "ROI: a patient access request is Ready to release");

await openMenu("Referral Tracking", "modal-referrals");
await page.fill('[data-testid="ref-specialty"]', "Cardiology");
await page.fill('[data-testid="ref-reason"]', "smoke test");
await page.fill('[data-testid="ref-orderedby"]', "Ordering, Doc");
await page.click('[data-testid="ref-add"]');
for (const step of ["Sent", "Scheduled", "Completed"]) {
  await page.click('[data-testid="ref-next-ref1"]');
  await page.click('[data-testid="ref-confirm"]');
  assert((await S()).referrals[0].status === step, `Referral: advanced to ${step}`);
}
await page.click('[data-testid="ref-next-ref1"]');
await page.fill('[data-testid="ref-from"]', "Ordering, Doc");
await page.click('[data-testid="ref-confirm"]');
assert((await S()).referrals[0].status === "Completed", "Referral: a report from the ordering provider is refused");
await page.fill('[data-testid="ref-from"]', "Specialist, Sam");
await page.click('[data-testid="ref-confirm"]');
assert((await S()).referrals[0].status === "Report Received", "Referral: a specialist report closes the loop");

await openMenu("Duplicate Chart Review", "modal-duplicates");
await page.fill('[data-testid="dup-mrn"]', "SMOKE-2");
await page.fill('[data-testid="dup-name"]', "Other, Joe");
await page.fill('[data-testid="dup-dob"]', CASE.patient.dob);
await page.selectOption('[data-testid="dup-decision"]', "merge");
await page.fill('[data-testid="dup-why"]', "smoke test");
await page.click('[data-testid="dup-save"]');
assert((await S()).duplicateReviews.length === 0, "Duplicate review: a DOB-only merge is refused");
await page.fill('[data-testid="dup-name"]', CASE.patient.name);
await page.click('[data-testid="dup-save"]');
assert((await S()).duplicateReviews.length === 0, "Duplicate review: a merge with no appointment history is refused");
await page.fill('[data-testid="dup-a-last"]', "2026-01-01");
await page.click('[data-testid="dup-save"]');
const dup = (await S()).duplicateReviews;
assert(dup.length === 1 && dup[0].decision === "merge" && dup[0].primary === CASE.patient.mrn, "Duplicate review: a 3-identifier merge is recorded with the chart that has visits as primary");
const audit2 = await page.evaluate(() => window.SimEHR.getAuditLog().map((a) => a.action));
for (const a of ["phone_call", "send_letter", "addendum", "roi_request", "referral_added", "referral_status", "duplicate_review"]) {
  assert(audit2.includes(a), `audit log records ${a}`);
}

// 11. resetState() returns to a clean episode
await page.evaluate(() => window.SimEHR.resetState());
assert((await page.evaluate(() => window.SimEHR.getState().orders.length)) === 0, "resetState() clears the episode state");
{
  const z = await page.evaluate(() => window.SimEHR.getState());
  assert(["phoneCalls", "letters", "addenda", "roiRequests", "referrals", "duplicateReviews"].every((k) => z[k].length === 0), "resetState() clears the Patient Care workflow records");
}

await browser.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED ✓");
process.exit(failures ? 1 : 0);
