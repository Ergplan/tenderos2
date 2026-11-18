// Workspace tabs an administrator can grant. Shared by server and client. Each tab may call
// only its own engine routes (see app/api/[...path]/route.js).
export const TAB_CATALOG = [
  { id: "tenderBid", label: "Tender to Bid", engine: ["bid", "rtc"] },
  { id: "rtc", label: "Round the Clock", engine: ["rtc"] },
  { id: "seciRtc", label: "SECI RTC tender", engine: ["rtc", "bid"] },
  { id: "bessTender", label: "BESS Tender", engine: ["bess"] },
  { id: "cfd", label: "CfD Bid", engine: [] },
  { id: "cfdOwnSolar", label: "CfD Own Solar", engine: [] },
  { id: "fdrex", label: "FDRE-X Bid", engine: ["rtc", "bid"] }, // HiGHS sizing (rtc/lp) as the SECI RTC tab
  { id: "whatIf", label: "What-if analysis", engine: [] },
  { id: "newTenders", label: "New tenders", engine: [] },
  { id: "recentTenders", label: "Recent tenders", engine: [] },
];

export const ALL_TAB_IDS = TAB_CATALOG.map((t) => t.id);

export function cleanTabList(list) {
  if (!Array.isArray(list)) return null;
  const set = new Set(list.map(String));
  return ALL_TAB_IDS.filter((id) => set.has(id));
}

/** Administrators see everything; others get their own list, else the deployment default, else all. */
export function resolveTabs(user, defaultTabs) {
  if (!user) return [];
  if (user.role === "admin") return [...ALL_TAB_IDS];
  return cleanTabList(user.tab_access) ?? cleanTabList(defaultTabs) ?? [...ALL_TAB_IDS];
}

/** Whether a user with these tabs may call the engine route family (first path segment). */
export function mayCallEngine(tabIds, family) {
  if (family === "health") return tabIds.length > 0;
  return TAB_CATALOG.some((t) => tabIds.includes(t.id) && t.engine.includes(family));
}

/** The CfD bid's routes serve both of its tabs: the CfD Bid and CfD Own Solar. */
export const mayUseCfd = (user) => user?.role === "admin" || ["cfd", "cfdOwnSolar"].some((t) => user?.allowedTabs?.includes(t));

