"use client";
// The TenderOS workspace: the sidebar (jouleWise design) and its four products. Each tab owns its
// state, progress and errors; this shell only routes between them, applies tab access and
// signs out. The legacy FDRE tabs (yield assessment, EYA report, custom dispatch and the
// rest) are not part of this application.
import React, { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeftRight, BatteryCharging, Clock3, FileStack, FlaskConical, FolderOpen, Gavel, Newspaper, Lock, LogOut, Scale, UserRound, Users } from "lucide-react";
import { flushActivity, startActivityTracker, trackEvent } from "./activity";
import "./styles.css";
import "./chartTheme";
import RtcTab from "./rtc/RtcTab";
import BessTab from "./bess/BessTab";
import BidTab from "./bid/BidTab";
import SeciTab from "./seci/SeciTab";
import CfdTab from "./cfd/CfdTab.jsx";
import WhatIfTab from "./whatif/WhatIfTab";
import RecentTendersTab from "./market/RecentTendersTab";
import Brand from "./Brand";
import ThemeToggle from "./ThemeToggle";
import { ALL_TAB_IDS } from "../lib/tabs";
import { authApi } from "./scenarios/client";

const TABS = [
  ["tenderBid", Gavel, "Tender to Bid"],
  ["rtc", Clock3, "Round the Clock"],
  ["seciRtc", FileStack, "SECI RTC tender"],
  ["bessTender", BatteryCharging, "BESS Tender"],
  ["cfd", Scale, "CfD Bid"],
  ["whatIf", FlaskConical, "What-if analysis"],
  ["recentTenders", Newspaper, "Recent tenders"],
];

function Sidebar({ activeTab, setActiveTab, user, allowed }) {
  return (
    <aside className="sidebar">
      <a href="/" className="brand sidebar-brand" aria-label="TenderOS home"><Brand /></a>
      <div className="side-section">
        <h3>Workspace</h3>
        <nav className="side-nav">
          {TABS.map(([id, Icon, label]) => {
            const ok = allowed.has(id);
            return (
              <button key={id} type="button" className={`${activeTab === id ? "active" : ""} ${ok ? "" : "nav-locked"}`} onClick={() => setActiveTab(id)}
                title={ok ? undefined : "Contact Administrator for access"} aria-disabled={!ok}>
                {ok ? <Icon size={15} /> : <Lock size={15} />}
                <span className="nav-label">{label}{!ok && <small>Contact Administrator</small>}</span>
              </button>
            );
          })}
        </nav>
      </div>
      <div className="side-section">
        <h3>Library</h3>
        <nav className="side-nav">
          <a href="/scenarios"><FolderOpen size={15} /> Saved scenarios</a>
          {user?.role === "admin" && <a href="/admin/users"><Users size={15} /> Users</a>}
          {user?.role === "admin" && <a href="/admin/activity"><Activity size={15} /> Activity</a>}
        </nav>
      </div>
      <div className="side-section side-theme"><ThemeToggle /></div>
      {user?.switchUrl && (
        <div className="side-section">
          <nav className="side-nav"><a href={user.switchUrl}><ArrowLeftRight size={15} /> Switch app</a></nav>
        </div>
      )}
      {user && !user.demo && (
        <div className="side-section side-user">
          <a href="/account" className="side-user-link"><UserRound size={15} /><span><strong>{user.name || user.email}</strong><small>{user.role}</small></span></a>
          <button type="button" className="rtc-icon-btn" title="Sign out" onClick={async () => { await flushActivity(); await authApi.logout().catch(() => {}); window.location.href = "/login"; }}><LogOut size={15} /></button>
        </div>
      )}
    </aside>
  );
}

function Restricted({ label, contacts = [] }) {
  return (
    <section className="restricted">
      <Lock size={28} />
      <span className="rtc-index">RESTRICTED</span>
      <h2>{label}</h2>
      <p>Your account does not have access to this tab. <strong>Contact Administrator</strong> to have it enabled.</p>
      {contacts.length > 0 && (
        <ul>
          {contacts.map((c) => (
            <li key={c.email}><a href={`mailto:${c.email}?subject=${encodeURIComponent(`TenderOS access: ${label}`)}`}>{c.name || c.email}</a>{c.name && <small>{c.email}</small>}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const MODULE_TAB = { rtc: "rtc", bess: "bessTender", seci: "seciRtc" };

export default function App({ user = null, initialScenario = null }) {
  const allowed = useMemo(() => new Set(user?.allowedTabs ?? ALL_TAB_IDS), [user]);
  const firstAllowed = TABS.map((t) => t[0]).find((id) => allowed.has(id)) || "tenderBid";
  const [activeTab, setActiveTab] = useState(() => MODULE_TAB[initialScenario?.scenario?.module] || firstAllowed);
  useEffect(() => { startActivityTracker(); }, []);
  useEffect(() => { if (allowed.has(activeTab)) trackEvent("tab", { tab: activeTab }); }, [activeTab, allowed]);
  const canView = allowed.has(activeTab);
  const opened = (module) => (initialScenario?.scenario?.module === module ? initialScenario : null);
  return (
    <div className="app-shell">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} allowed={allowed} />
      <main>
        {!canView && <Restricted label={TABS.find((t) => t[0] === activeTab)?.[2] || "This tab"} contacts={user?.adminContacts} />}
        {canView && activeTab === "tenderBid" && <BidTab user={user} openTab={(id) => { if (allowed.has(id)) setActiveTab(id); }} />}
        {canView && activeTab === "rtc" && <RtcTab user={user} initialScenario={opened("rtc")} />}
        {canView && activeTab === "seciRtc" && <SeciTab initialScenario={opened("seci")} />}
        {canView && activeTab === "bessTender" && <BessTab initialScenario={opened("bess")} />}
        {canView && activeTab === "cfd" && <CfdTab />}
        {canView && activeTab === "whatIf" && <WhatIfTab />}
        {canView && activeTab === "recentTenders" && <RecentTendersTab />}
      </main>
    </div>
  );
}
