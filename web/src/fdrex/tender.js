// SECI-FDRE-X (RfS No. SECI/C&P/IPP/13/0012/26-27 dated 07.10.2026): the numbers the bid model
// applies. The figures are those of ./terms.js (each tied there to the clause that states it and
// quoted with its page); this file adds the few that are the model's own reading of the tender
// and gives the names the model inherited from the CfD-I bid model to this tender's terms.
//
// What the tender asks: for every MW contracted, 4 MWh a day in four hours the Buying Entity
// chooses from the non-solar hours (1 MWh per MW in an hour), for 25 years from the Scheduled
// Commencement of Supply Date (SCSD), at one fixed tariff, under a PPA with SECI. All of it RE; up
// to 5% of a year's energy may come from the green market or a bilateral agreement, supplied
// directly or through the storage. A month's shortfall beyond 10% is penalised at 1.5 × the tariff.

import { TENDER as DOC } from "./terms.js";

export const TENDER = {
  ...DOC,
  id: "seci-fdre-x",
  // The model's reading: the Buying Entity is taken to choose its four dearest evening hours
  // (18:00 to 24:00); a choice in the morning non-solar hours needs the same stored energy.
  peakStart: 18,
  peakEnd: 24,
  // The model's reading: the buyer names the hours each morning, so the storage must be able to
  // carry the whole 4 MWh per MW (the RfS sets no minimum storage size).
  essHoursMin: DOC.mwhPerMwDay,
  // one date for the whole Project: the storage's and the RE's are the SCSD (RfS 9.2)
  essScdMonths: DOC.scdMonths,
  reCodMonths: DOC.scdMonths,
  // SECI's invitation to sign the PPA stands where the CfD model has the Letter of Award: the
  // Effective Date is 15 days after it (RfS 20.4.ii)
  loaToEdDays: DOC.intimationToEdDays,
  // the Success Charges stand where the CfD model has the Contract Administration Charges (RfS 18.1)
  cacLakhPerMw: DOC.successChargeLakhPerMw,
  thirdPartyPenaltyMultiple: DOC.thirdPartySalePenaltyMultiple,
};
