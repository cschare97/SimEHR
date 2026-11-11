"use client";

import { useState } from "react";
import { useSim, closeMainMenu, menuSelect, switchActivity, openModal } from "@/lib/store";
import { MAIN_MENU, emSlug, type MenuItem } from "@/lib/mainMenu";

export default function MainMenu() {
  const open = useSim((s) => s.menuOpen);
  const [cat, setCat] = useState("Patient Care");
  const [q, setQ] = useState("");
  if (!open) return null;

  const activeCat = MAIN_MENU.find((c) => c.cat === cat);
  const searching = q.trim().length > 0;
  const results = searching
    ? MAIN_MENU.flatMap((c) =>
        c.items.filter((it) => it.label && it.label.toLowerCase().includes(q.toLowerCase())).map((it) => ({ cat: c.cat, it })),
      )
    : [];

  function pick(catName: string, it: MenuItem) {
    if (!it.label || it.disabled) return;
    menuSelect(catName, it.label, "human");
    if (it.activity) switchActivity(it.activity, "human");
    else if (it.action === "sign") openModal("signvisit");
    else if (it.action === "phonecall" || it.action === "letter" || it.action === "addendum" || it.action === "roi" || it.action === "referrals" || it.action === "duplicates" || it.action === "disclosures") openModal(it.action);
  }

  return (
    <>
      <div id="main-menu-backdrop" className="open" onClick={closeMainMenu} />
      <div id="main-menu" className={"open" + (searching ? " searching" : "")}>
        <div className="em-col em-left">
          <div className="em-search">
            <span>🔍</span>
            <input
              data-testid="em-search"
              placeholder="Search activities"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="em-section">
            <div className="em-section-h">Recent</div>
            <div className="em-empty">No recent items</div>
          </div>
          <div className="em-foot">
            <div className="em-foot-btn" data-testid="em-logout" onClick={closeMainMenu}>Log Out</div>
            <div className="em-foot-btn" onClick={closeMainMenu}>Secure</div>
          </div>
        </div>

        {!searching && (
          <>
            <div className="em-cats">
              {MAIN_MENU.map((c) => (
                <div
                  key={c.cat}
                  className={"em-cat" + (c.cat === cat ? " active" : "")}
                  data-testid={`em-cat-${emSlug(c.cat)}`}
                  onMouseEnter={() => setCat(c.cat)}
                  onClick={() => setCat(c.cat)}
                >
                  <span className="em-cat-ic">{c.icon ?? ""}</span>
                  <span>{c.cat}</span>
                  <span className="em-chev">›</span>
                </div>
              ))}
            </div>
            <div className="em-fly">
              {activeCat?.items.map((it, i) =>
                it.sep ? (
                  <div key={i} className="em-sep" />
                ) : (
                  <div
                    key={i}
                    className={"em-item" + (it.disabled ? " disabled" : "")}
                    data-testid={`em-item-${emSlug(it.label ?? "")}`}
                    onClick={() => pick(cat, it)}
                  >
                    <span className="em-item-ic">{it.icon ?? ""}</span>
                    <span className="em-item-l">{it.label}</span>
                    {it.sub && <span className="em-chev">›</span>}
                  </div>
                ),
              )}
            </div>
          </>
        )}

        {searching && (
          <div className="em-results" style={{ display: "block" }}>
            {results.length ? (
              results.map(({ cat: rc, it }, i) => (
                <div key={i} className="em-result" data-testid={`em-result-${emSlug(it.label ?? "")}`} onClick={() => pick(rc, it)}>
                  <span className="em-item-ic">{it.icon ?? "▦"}</span>
                  <span className="em-item-l">
                    {it.label}
                    <span className="em-bc">{rc}</span>
                  </span>
                </div>
              ))
            ) : (
              <div className="em-result" style={{ color: "#9aa7b1", fontStyle: "italic" }}>No activities found.</div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
