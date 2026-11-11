// Main-menu model + activity titles.
export interface MenuItem {
  label?: string;
  icon?: string;
  activity?: string;
  action?: string;
  sub?: boolean;
  sep?: boolean;
  disabled?: boolean;
}
export interface MenuCat {
  cat: string;
  icon?: string;
  items: MenuItem[];
}

export const MAIN_MENU: MenuCat[] = [
  { cat: "Desktop", items: [
    { label: "Print", icon: "🖨" }, { label: "Print Preview", icon: "🖼" }, { sep: true },
    { label: "Change Context…", icon: "⤿" },
  ] },
  { cat: "Patient Care", items: [
    { label: "Chart", icon: "📁", activity: "snapshot" },
    { label: "Patient Lists", icon: "≣", activity: "patient-lists" }, { sep: true },
    { label: "Telephone Call", icon: "📞", action: "phonecall" }, { label: "Refill Medication", icon: "💊", activity: "medications" },
    { label: "Send Letter", icon: "✉", action: "letter" }, { label: "Release of Information", icon: "📤", action: "roi" }, { label: "Referral Tracking", icon: "↗", action: "referrals" }, { label: "Duplicate Chart Review", icon: "⧉", action: "duplicates" }, { label: "Place Orders", icon: "📋", activity: "orders" },
    { label: "Addendum", icon: "📝", action: "addendum" }, { label: "Sign Encounter", icon: "✔", action: "sign" }, { sep: true },
    { label: "Research Studies" },
  ] },
  { cat: "Reports", items: [{ label: "Report Library", icon: "🔍" }, { label: "Scheduled Reports" }] },
  { cat: "Tools", items: [{ label: "Spell Checker", sub: true }, { label: "Provider Finder" }, { label: "Phone Book" }] },
  { cat: "Settings", icon: "⚙", items: [{ label: "Preferences" }, { label: "Printer Settings" }, { label: "Toolbar…" }, { label: "Activities…" }] },
  { cat: "Help", items: [{ label: "About SimEHR" }, { label: "Help Topics" }] },
];

export const ACTIVITY_TITLES: Record<string, string> = {
  snapshot: "Patient Summary",
  "chart-review": "Chart Review",
  results: "Results Review",
  "problem-list": "Problem List",
  medications: "Medications",
  orders: "Orders",
  notewriter: "Clinical Notes",
  demographics: "Demographics",
  "patient-lists": "Patient Lists",
  schedule: "Schedule",
};

export const emSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function findMenuItemByLabel(label: string): { cat: string; item: MenuItem } | null {
  for (const c of MAIN_MENU) {
    const item = c.items.find((i) => i.label && i.label.toLowerCase() === label.toLowerCase());
    if (item) return { cat: c.cat, item };
  }
  return null;
}
