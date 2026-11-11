// window.SimEHR — the programmatic agent surface, bridged onto the same store actions the UI
// uses. Kept contract-compatible with the vanilla mock so the Playwright harness
// transfer unchanged. getState()/getAuditLog() are the grading source
// of truth (a deep-copied snapshot of canonical state), NOT the rendered DOM.

import * as store from "./store";
import { fetchCase, listCaseIds } from "./cases";
import { findMenuItemByLabel } from "./mainMenu";
import type { Case, AuditEntry } from "./types";

export interface SimEHRApi {
  loadCase: (idOrObj: string | Case) => Promise<boolean>;
  listCases: () => Promise<string[]>;
  getState: () => unknown;
  getAuditLog: () => AuditEntry[];
  resetState: () => void;
  switchActivity: (name: string) => void;
  saveDeliverable: (text: string) => string;
  getDeliverable: () => string;
  addOrder: (name: string, type?: string, indication?: string) => void;
  signOrders: () => void;
  addMed: (name: string, dose?: string, freq?: string) => void;
  modifyMed: (id: string, dose?: string, freq?: string) => void;
  discontinueMed: (id: string) => void;
  selectPill: (section: string, pill: string) => void;
  applyNormalExam: () => void;
  writeAP: (text: string) => void;
  signNote: () => void;
  openAdvisory: (kind: string) => void;
  respondAdvisory: (kind: string | null, action: string) => void;
  signVisit: () => void;
  signVisitForce: () => void;
  openMainMenu: () => void;
  closeMainMenu: () => void;
  menuSelect: (label: string) => void;
  switchChartTab: (tab: string) => void;
  toggleFilter: (label: string) => void;
}

declare global {
  interface Window {
    SimEHR?: SimEHRApi;
  }
}

export const snapshot = () => {
  const s = store.getState();
  return JSON.parse(
    JSON.stringify({
      case: s.caseData,
      activity: s.activity,
      crSubtab: s.crSubtab,
      orders: s.orders,
      deliverable: s.deliverable,
      patientReply: s.patientReply,
      noteExam: s.noteExam,
      advisoryResponses: s.advisoryResponses,
      visitSigned: s.visitSigned,
      phoneCalls: s.phoneCalls,
      letters: s.letters,
      addenda: s.addenda,
      roiRequests: s.roiRequests,
      referrals: s.referrals,
      duplicateReviews: s.duplicateReviews,
      runId: s.runId,
    }),
  );
};

export function installAgentApi() {
  if (typeof window === "undefined") return;
  window.SimEHR = {
    loadCase: async (idOrObj) => {
      const c = typeof idOrObj === "string" ? await fetchCase(idOrObj) : idOrObj;
      if (!c) return false;
      store.loadCase(c, "agent");
      return true;
    },
    listCases: () => listCaseIds(),
    getState: () => snapshot(),
    getAuditLog: () => JSON.parse(JSON.stringify(store.getState().audit)),
    resetState: () => store.reset("agent"),
    switchActivity: (name) => store.switchActivity(name, "agent"),
    saveDeliverable: (text) => {
      store.saveDeliverable(text, "agent");
      return store.getState().deliverable;
    },
    getDeliverable: () => store.getState().deliverable,
    addOrder: (name, type, indication) => store.addOrder({ name, type, indication }, "agent"),
    signOrders: () => store.signOrders("agent"),
    addMed: (name, dose, freq) => store.addMed({ name, dose, freq }, "agent"),
    modifyMed: (id, dose, freq) => store.modifyMed(id, { dose, freq }, "agent"),
    discontinueMed: (id) => store.discontinueMed(id, "agent"),
    selectPill: (section, pill) => store.togglePill(section, pill, "agent"),
    applyNormalExam: () => store.applyNormalExam("agent"),
    writeAP: (text) => store.saveDeliverable(text, "agent"),
    signNote: () => store.signNote("agent"),
    openAdvisory: (kind) => {
      const advisories = store.getState().caseData?.advisories ?? [];
      const idx = advisories.findIndex((b) => b.kind === kind);
      store.openModal("advisory", String(idx >= 0 ? idx : 0), "agent");
    },
    respondAdvisory: (kind, action) => store.respondAdvisory(kind, action, "agent"),
    signVisit: () => store.openModal("signvisit", null, "agent"),
    signVisitForce: () => store.signVisit("agent"),
    switchChartTab: (tab) => {
      store.switchActivity("chart-review", "agent");
      store.setCrSubtab(tab, "agent");
    },
    toggleFilter: (label) => store.log("agent", "toggle_filter", label),
    openMainMenu: () => store.openMainMenu("agent"),
    closeMainMenu: () => store.closeMainMenu(),
    menuSelect: (label) => {
      const found = findMenuItemByLabel(label);
      if (!found || !found.item.label) return;
      store.menuSelect(found.cat, found.item.label, "agent");
      if (found.item.activity) store.switchActivity(found.item.activity, "agent");
      else if (found.item.action === "sign") store.openModal("signvisit", null, "agent");
      else if (found.item.action === "phonecall" || found.item.action === "letter" || found.item.action === "addendum" || found.item.action === "roi" || found.item.action === "referrals" || found.item.action === "duplicates") store.openModal(found.item.action, null, "agent");
    },
  };
}
