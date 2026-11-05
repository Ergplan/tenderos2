import React from "react";
import { ArrowLeft, BatteryCharging, Info, Scale } from "lucide-react";
import { TYPE_LABEL } from "./StartScreen";

/** In place of the sizing steps when they do not apply to the tender (see sizingScope). */
export default function ScopeNotice({ scope, goto, openBess, openCfd, fileInMemory }) {
  const label = TYPE_LABEL[scope.type] || scope.type;
  return (
    <section className="bid-scope" data-testid="bid-scope">
      {scope.kind === "bess" ? (
        <>
          <span className="bid-start-tag">{label}</span>
          <h2><BatteryCharging size={22} /> A standalone battery storage tender</h2>
          <p>Tender to Bid sizes a generation plant against the tender's supply floors. A standalone BESS tender is sized and priced in the BESS tender tab: power, duration, cycles, efficiency, availability and the capacity charge.</p>
          <div className="bid-scope-actions">
            {openBess && <button type="button" className="primary" onClick={openBess} data-testid="bid-open-bess"><BatteryCharging size={15} /> Open in the BESS tender tab</button>}
            <button type="button" className="secondary" onClick={() => goto("tender")}><ArrowLeft size={14} /> Back to the tender</button>
          </div>
          {openBess && !fileInMemory && <p className="rtc-note">Upload the same tender file on that tab.</p>}
        </>
      ) : scope.kind === "cfd" ? (
        <>
          <span className="bid-start-tag">{label}</span>
          <h2><Scale size={22} /> A Contract for Difference tender</h2>
          <p>Tender to Bid sizes a plant against supply floors under a power purchase agreement. A CfD tender sells the power on the exchange and settles the difference to the strike price with the procurer's Pool: the CfD Bid tab models it in full, from the daily peak supply and the mandatory storage to the strike price for your target return, the bid forms and the reference bids.</p>
          <div className="bid-scope-actions">
            {openCfd && <button type="button" className="primary" onClick={openCfd} data-testid="bid-open-cfd"><Scale size={15} /> Open the CfD Bid tab</button>}
            <button type="button" className="secondary" onClick={() => goto("tender")}><ArrowLeft size={14} /> Back to the tender</button>
          </div>
          <p className="rtc-note">The Tender and Key dates steps here hold what was read from the documents: the summary, the dates, the guarantees and the amended terms, each with its page.</p>
        </>
      ) : (
        <>
          <span className="bid-start-tag">{label}</span>
          <h2><Info size={22} /> No plant to size in this tender</h2>
          <p>Plant sizing and the supply financial model apply to power supply tenders (solar, wind, hybrid, FDRE, RE-RTC). For this {label.toLowerCase()} tender, the Tender and Key dates steps hold what was read: the summary, the dates, the guarantees and the risks, each with its page.</p>
          <div className="bid-scope-actions">
            <button type="button" className="primary" onClick={() => goto("tender")}><ArrowLeft size={14} /> Back to the tender</button>
          </div>
        </>
      )}
    </section>
  );
}
