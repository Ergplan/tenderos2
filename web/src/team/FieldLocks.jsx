"use client";
// The lock on every input box: the boxes whose header has no lock of its own (the model's locks of
// the RTC, SECI and CfD inputs are kept as they are) get one in their tools row
// (./fieldTools.js), before the send icon and the paperclip. A locked box is read-only until
// unlocked; the locks are kept per tab in this browser.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Unlock } from "lucide-react";
import { applyLock, hasOwnLock, readLocks, saveLocks, useFieldHosts } from "./fieldTools";

export default function FieldLocks({ tab, tabLabel }) {
  const boxes = useFieldHosts(tab, tabLabel);
  const [locks, setLocks] = useState(() => readLocks(tab));
  useEffect(() => { setLocks(readLocks(tab)); }, [tab]);
  const own = boxes.filter((b) => !hasOwnLock(b.host));
  // a box re-drawn by its step loses read-only: put it back on each read of the page
  useEffect(() => { for (const b of own) applyLock(b.el, Boolean(locks[b.key])); });
  if (typeof document === "undefined") return null;
  const toggle = (key) => setLocks((l) => {
    const next = { ...l };
    if (next[key]) delete next[key]; else next[key] = true;
    saveLocks(tab, next);
    return next;
  });
  return (
    <>
      {own.map((b) => {
        const on = Boolean(locks[b.key]);
        const title = on ? `${b.label} is locked: click to unlock` : `Lock ${b.label} so it is not changed by mistake`;
        return createPortal(
          <button key={b.key} type="button" className={`lock-btn fx-lock ${on ? "on" : ""}`} onClick={() => toggle(b.key)} title={title} aria-label={title}
            aria-pressed={on} data-testid="fx-lock" data-lock-key={b.key}>
            {on ? <Lock size={12} /> : <Unlock size={12} />}
          </button>,
          b.host,
          `lock-${b.key}`,
        );
      })}
    </>
  );
}
