// SECI CfD-I: the RfS's bid formats (Section 7, RfS printed pp. 63-99, PDF pp. 64-100) filled from
// the bid: which formats this bid needs, where each blank's value comes from, how much is filled
// and whether the bidder has reviewed it since the last change. Plain JavaScript, checked in Node
// by tools/check_cfd_forms.mjs. Pages below are PDF pages of web/public/tenders/seci-cfd-i/RfS.pdf
// (the printed page + 1: the PDF has a cover first).
//
// A blank's value comes from one of three places:
//   model:  the bid itself (contracted MW, the plant, EMD and PBG, the RfS's number and title);
//   shared: a particular asked once and used in every format (bidder, address, signatory...);
//   own:    a blank only this format has (state.forms["<format>.<key>"]).
import { RFS, TENDER } from "./terms.js";
import { rfsAmounts } from "./model.js";
import { FORM_FIELDS } from "./forms.js";

export const RFS_FILE = "/tenders/seci-cfd-i/RfS.pdf";

const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso || "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const rs = (v) => (isNum(v) ? `INR ${Math.round(v).toLocaleString("en-IN")}` : "");
const mw = (v) => (isNum(v) ? String(Math.round(v)) : "");

const ctx = (page, quote) => ({ doc: "rfs", page, quote });
const F = (key, label, kind, maps, page, quote, extra = {}) => ({ key, label, kind, maps, context: ctx(page, quote), ...extra });

// the particulars every letter head shares: name and address, the RfS reference, the date and signatory
const HEAD = (page) => [
  F("refNo", "Reference number", "text", null, page, "Ref. No. _________"),
  F("date", "Letter date", "date", "date", page, "Date: ___________"),
  F("bidder", "Bidding Company / Lead Member name", "text", "bidder", page, "(Insert name and address of Bidding Company/ Lead Member of"),
  F("address", "Bidder address", "textarea", "address", page, "(Insert name and address of Bidding Company/ Lead Member of"),
  F("phone", "Telephone", "text", "phone", page, "Tel.#:"),
  F("email", "E-mail", "text", "email", page, "E-mail address#"),
  F("rfsNo", "RfS number", "text", "rfsNo", page, "Sub: Response to RfS No."),
  F("rfsDate", "RfS date", "date", "rfsDate", page, "Sub: Response to RfS No."),
  F("title", "RfS title", "text", "title", page, "Sub: Response to RfS No."),
];
const SIGN = (page) => [
  F("signatory", "Authorised signatory (name, designation)", "text", "signatory", page, "Name, Designation, Seal and Signature of Authorized Person in whose name Power of"),
];

/** The RfS's formats in the order they are worked through. */
export const FORMATS = [
  {
    id: "7.1", title: "Covering Letter", pages: [64, 67], applies: "always",
    submittedBy: "Bidding Company / Lead Member of Consortium (authorised signatory)", paper: "Letterhead of the Bidding Company/ Lead Member of Consortium", envelope: "techno-commercial", when: "with the bid",
    purpose: "The bid itself: the project, its contracted and installed capacity, location, interconnection point, EMD particulars, the bidder's declarations and the contact person",
    heading: { doc: "rfs", page: 64, quote: "Format 7.1 COVERING LETTER" },
    fields: [
      ...HEAD(64),
      F("groupDisclosure", "Group bidding declaration (strike out the other)", "choice", null, 64, "(as mentioned in Format 7.8 under Disclosure) (strike out if not applicable)", { options: ["No group company has bid (Format 7.8)", "Common shareholder >10% <26% in other bidders (Format 7.8A)"] }),
      F("contractedMw", "Contracted capacity offered (MW)", "number", "contractedMw", 65, "Contracted Capacity offered (MW)"),
      F("solarMw", "Solar PV component (MW)", "number", "solarMw", 65, "Solar PV component: ___ MW"),
      F("windMw", "Wind power component (MW)", "number", "windMw", 65, "Wind power component: ___ MW"),
      F("otherReMw", "Other RE power generating component (MW)", "number", "otherReMw", 65, "Other RE power generating component: ___ MW"),
      F("bessMw", "ESS component (MW)", "number", "bessMw", 65, "ESS component: __ MW/ ___ MWh"),
      F("bessMwh", "ESS component (MWh)", "number", "bessMwh", 65, "ESS component: __ MW/ ___ MWh"),
      F("location", "Location of the project (village, tehsil, district, state)", "text", "site", 65, "Location of Project (Village, Tehsil, Dist., State)"),
      F("substation", "Interconnection point details (ISTS substation)", "text", "substation", 65, "Interconnection Point Details"),
      F("preference", "Project preference", "text", null, 65, "Project Preference*"),
      F("emdAmount", "EMD amount (INR)", "text", "emdAmount", 65, "We have enclosed EMD of INR …………. (Insert Amount)"),
      F("emdForm", "EMD instrument", "choice", "emdForm", 65, "in the form of Bank Guarantee/ Surety Bond no", { options: ["Bank Guarantee", "Surety Bond"] }),
      F("emdNumber", "Bank guarantee / surety bond number", "text", null, 65, "[Insert bank guarantee/Surety Bond number]"),
      F("emdDate", "Bank guarantee / surety bond date", "date", null, 65, "[Insert date of bank guarantee/Surety Bond]"),
      F("emdIssuer", "Issuing bank / surety issuer", "text", null, 65, "[Insert name of bank providing bank guarantee/Surety Bond issuing"),
      F("emdValidUpTo", "EMD valid up to", "date", null, 65, "and valid up to………….in terms of Clause No. 17 of this RfS"),
      F("alreadyCommissioned", "Project already commissioned (para 4)", "choice", null, 66, "(applicable only in case of already commissioned Projects. Strike-off if not applicable.)", { options: ["Not applicable", "Applicable"] }),
      F("contactName", "Contact person: name", "text", "contact", 67, "Details of the representative to be contacted by SECI are furnished as under:"),
      F("contactDesignation", "Contact person: designation", "text", null, 67, "Designation"),
      F("contactCompany", "Contact person: company", "text", "bidder", 67, "Company"),
      F("contactAddress", "Contact person: address", "text", "address", 67, "Address"),
      F("contactPhone", "Contact person: phone", "text", "phone", 67, "Phone Nos."),
      F("contactMobile", "Contact person: mobile", "text", null, 67, "Mobile Nos."),
      F("contactEmail", "Contact person: e-mail", "text", "email", 67, "E-mail address"),
      ...SIGN(67),
    ],
  },
  {
    id: "7.2", title: "Power of Attorney (consortium)", pages: [68, 69], applies: "consortium",
    submittedBy: "Each other member of the Consortium, in favour of the Lead Member; accepted by the Lead Member; notarised", paper: "Non-judicial stamp paper of appropriate value", envelope: "techno-commercial", when: "with the bid",
    purpose: "Each member of a consortium appoints the Lead Member as its attorney for the bid",
    heading: { doc: "rfs", page: 68, quote: "Format 7.2 FORMAT FOR POWER OF ATTORNEY" },
    fields: [
      F("members", "Members of the Consortium and their registered offices", "textarea", null, 68, "(Insert names and registered offices of all Members of the Consortium)"),
      F("consortiumName", "Name of the Consortium", "text", null, 68, "(insert name of the Consortium if finalized)"),
      F("agreementDate", "Consortium Agreement date", "date", null, 68, "Consortium Agreement dated"),
      F("leadMember", "Lead Member", "text", "leadMember", 68, "as the Lead Member of the said Consortium"),
      F("leadLaw", "Lead Member: incorporated under the laws of", "text", null, 68, "a company incorporated under the laws of"),
      F("leadOffice", "Lead Member: registered / head office", "text", null, 68, "having its Registered/ Head Office at"),
      F("rfsNo", "RfS number", "text", "rfsNo", 68, "submission of the response to RfS No"),
      F("member", "Executing member (this power of attorney)", "text", null, 68, "IN WITNESS WHEREOF M/s"),
      F("executedOn", "Executed on (date)", "date", null, 68, "have executed these presents on this"),
      F("memberSignatory", "Member's authorised signatory (name, designation)", "text", null, 68, "(Signature of person authorized by the board)"),
      F("place", "Place", "text", "place", 69, "Place:"),
      F("date", "Date", "date", "date", 69, "Date:"),
    ],
  },
  {
    id: "7.3A", title: "Bank Guarantee towards EMD", pages: [70, 71], applies: "emd-bg",
    submittedBy: "An Indian branch of a Scheduled Commercial Bank, on the bidder's behalf", paper: "Non-judicial stamp paper of appropriate value", envelope: "techno-commercial", when: "with the bid (through SFMS to IDFC First Bank)",
    purpose: "The EMD as an unconditional bank guarantee: the amount of clause 17, valid 12 months from the bid deadline, claimable 30 days more",
    heading: { doc: "rfs", page: 70, quote: "Format 7.3A FORMAT FOR BANK GUARANTEE TOWARDS EARNEST MONEY DEPOSIT" },
    fields: [
      F("reference", "Reference", "text", null, 70, "Reference: ……………………………."),
      F("bgNo", "Bank Guarantee number", "text", null, 70, "Bank Guarantee No.:"),
      F("bgDate", "Bank Guarantee date", "date", null, 70, "Date: ...................……..."),
      F("bidder", "Bidder's name", "text", "bidder", 70, "[Insert name of the Bidder]"),
      F("contractedMw", "Cumulative Contracted Capacity (MW)", "number", "contractedMw", 70, "[Insert cumulative Contracted Capacity proposed]"),
      F("rfsNo", "RfS number", "text", "rfsNo", 70, "in response to the RfS No."),
      F("rfsDate", "RfS date", "date", "rfsDate", 70, "in response to the RfS No."),
      F("bank", "Name and address of the bank", "text", null, 70, "[Insert name & address of bank]"),
      F("place", "SECI's place (New Delhi)", "text", null, 70, "[Insert Name of the Place from the address of SECI]"),
      F("emdAmount", "Guaranteed amount (INR)", "text", "emdAmount", 70, "[Insert amount not less than that derived in line with Clause 16 of the RfS]"),
      F("validUpTo", "Valid up to", "date", null, 70, "[insert date of validity in accordance with Clause No. 17 of this RfS]"),
      F("claimUpTo", "Claim period up to (at least 30 days after validity)", "date", null, 71, "[Insert a date which is at least 30 days beyond the expiry of the validity period"),
      F("bankSignatory", "Bank's signatory (name)", "text", null, 71, "Name:"),
      F("bankPoa", "Bank's power of attorney number", "text", null, 71, "Power of Attorney No.:"),
      F("bankContact", "Contact details of the bank", "text", null, 71, "Contact Details of the Bank:"),
      F("bankEmail", "E-mail of the bank", "text", null, 71, "E-mail ID of the Bank:"),
      F("dated", "Dated (day, month, year)", "text", null, 71, "Dated this ____ day of ____, 20__"),
    ],
  },
  {
    id: "7.3B", title: "Insurance Surety Bond towards EMD", pages: [72, 73], applies: "emd-surety",
    submittedBy: "An insurer under IRDAI guidelines, on the bidder's behalf", paper: "Non-judicial stamp paper / e-stamp paper of appropriate value", envelope: "techno-commercial", when: "with the bid",
    purpose: "The EMD as an insurance surety bond instead of a bank guarantee (clause 17.3)",
    heading: { doc: "rfs", page: 72, quote: "Format 7.3 B FORMAT OF INSURANCE SURETY BOND TOWARDS EMD" },
    fields: [
      F("bondNo", "Insurance Surety Bond number", "text", null, 72, "Insurance Surety Bond No.:"),
      F("bondDate", "Bond date", "date", null, 72, "Date:"),
      F("rfsNo", "RfS number", "text", "rfsNo", 72, "In accordance with your RfS No."),
      F("rfsDate", "RfS date", "date", "rfsDate", 72, "In accordance with your RfS No."),
      F("bidder", "Bidder's name", "text", "bidder", 72, "[Insert name of the Bidder] having its Registered/Head Office"),
      F("address", "Bidder's registered / head office", "textarea", "address", 72, "[Insert address of the bidder]"),
      F("title", "Name of the RfS", "text", "title", 72, "[Insert name of the RfS]"),
      F("emdAmount", "Bond amount (INR)", "text", "emdAmount", 72, "[Insert amount not less than that derived in line"),
      F("validUpTo", "Valid up to", "date", null, 72, "[insert date of validity in accordance with Clause No. 17 of this RfS]"),
      F("insurer", "Name of the insurer", "text", null, 72, "[Insert name of the ‘Insurer’] having our Head Office at"),
      F("insurerOffice", "Insurer's head office", "text", null, 72, "[Insert address of the Insurer]"),
      F("claimUpTo", "Claim period up to (at least 30 days after validity)", "date", null, 73, "SECI shall be entitled to invoke this Bond till"),
      F("executedOn", "Executed on (day, month, year, place)", "text", null, 73, "has set its hand and stamp on"),
      F("insurerSignatory", "Insurer's signatory (name, designation)", "text", null, 73, "(Designation with Insurer Stamp)"),
      F("insurerPoa", "Insurer's power of attorney number and date", "text", null, 73, "Authorized vide Power of Attorney No."),
      F("insurerEmail", "E-mail of the branch", "text", null, 73, "Email id of the Branch for confirmation of this Bond:"),
    ],
  },
  {
    id: "7.3C", title: "Performance Bank Guarantee (PBG)", pages: [74, 76], applies: "pbg-bg",
    submittedBy: "An Indian branch of a Scheduled Commercial Bank, on the selected RPD's behalf; separately for each project", paper: "Non-judicial stamp paper of appropriate value", envelope: "after the award", when: "within 20 days of the LoA, before the CfDA",
    purpose: "The performance guarantee of clause 18: the amount on the installed capacity, valid until 6 months after the SCD",
    heading: { doc: "rfs", page: 74, quote: "Format 7.3 C FORMAT FOR PERFORMANCE BANK GUARANTEE (PBG)" },
    fields: [
      F("reference", "Reference", "text", null, 74, "Reference: ……………………………."),
      F("bgNo", "Bank Guarantee number", "text", null, 74, "Bank Guarantee No.:"),
      F("bgDate", "Bank Guarantee date", "date", null, 74, "Date: ...................……..."),
      F("bidder", "Selected RE Power Developer", "text", "bidder", 74, "[Insert name of the Bidder] (hereinafter"),
      F("title", "Title of the RfS", "text", "title", 74, "[Insert title of the RfS]"),
      F("contractedMw", "Contracted Capacity (MW)", "number", "contractedMw", 74, "of the Contracted Capacity of"),
      F("projectPlace", "Place of the project", "text", "site", 74, "[Insert name of the place]"),
      F("rfsDate", "RfS date", "date", "rfsDate", 74, "in response to the RfS dated"),
      F("loaNo", "Letter of Award number", "text", null, 74, "issuing Letter of Award No."),
      F("spv", "Project company (SPV), if any", "text", null, 74, "{a Special Purpose Vehicle (SPV) formed for this purpose}, if"),
      F("bank", "Name and address of the bank", "text", null, 74, "[Insert name & address of Bank]"),
      F("place", "SECI's place (New Delhi)", "text", null, 74, "[Insert Name of the"),
      F("pbgAmount", "Guaranteed amount (INR)", "text", "pbgAmount", 74, "[Total"),
      F("validUpTo", "Valid up to", "date", null, 74, "[Insert date"),
      F("claimUpTo", "Claim period up to (at least 30 days after validity)", "date", null, 75, "[Insert a date which is at least 30 days beyond the expiry of the validity period on the"),
      F("bankSignatory", "Bank's signatory (name)", "text", null, 76, "Name:"),
      F("bankPoa", "Bank's power of attorney number", "text", null, 76, "Power of Attorney No.:"),
      F("bankContact", "Contact details of the bank", "text", null, 76, "Contact Details of the Bank:"),
      F("bankEmail", "E-mail of the bank", "text", null, 76, "E-mail ID of the Bank:"),
      F("dated", "Dated (day, month, year)", "text", null, 76, "Dated this ____ day of ____, 20__"),
      F("witness1", "Witness 1 (signature, name, address)", "text", null, 76, "Witness:"),
      F("witness2", "Witness 2 (signature, name, address)", "text", null, 76, "Witness:"),
    ],
  },
  {
    id: "7.3D", title: "Insurance Surety Bond towards Performance Security", pages: [77, 79], applies: "pbg-surety",
    submittedBy: "An insurer under IRDAI guidelines, on the RPD's behalf", paper: "Non-judicial stamp paper / e-stamp paper of appropriate value", envelope: "after the award", when: "within 20 days of the LoA, before the CfDA",
    purpose: "The performance security as an insurance surety bond instead of a bank guarantee (clause 18.11)",
    heading: { doc: "rfs", page: 77, quote: "Format 7.3 D FORMAT OF INSURANCE SURETY BOND TOWARDS PERFORMANCE" },
    fields: [
      F("bondNo", "Insurance Surety Bond number", "text", null, 77, "Insurance Surety Bond No.:"),
      F("bondDate", "Bond date", "date", null, 77, "Date:"),
      F("bidder", "RE Power Developer", "text", "bidder", 77, "[Insert name of"),
      F("address", "RPD's registered / head office", "textarea", "address", 77, "with its Registered/Head Office at"),
      F("contractedMw", "Project capacity (MW)", "number", "contractedMw", 77, "the Project of capacity of"),
      F("rfsNo", "RfS number", "text", "rfsNo", 77, "in response to the RfS No."),
      F("rfsDate", "RfS date", "date", "rfsDate", 77, "in response to the RfS No."),
      F("loaNo", "Letter of Award number", "text", null, 77, "issued by SECI by issuing Letter of Award No."),
      F("loaDate", "Letter of Award date", "date", null, 77, "issued by SECI by issuing Letter of Award No."),
      F("spv", "Project company (SPV), if any", "text", null, 77, "{a Special Purpose Vehicle (SPV)"),
      F("pbgAmount", "Guaranteed amount (INR)", "text", "pbgAmount", 77, "[Total Value] only."),
      F("insurer", "Name and address of the insurer", "text", null, 77, "[Name"),
      F("insurerOffice", "Insurer's head office", "text", null, 77, "its Head Office at"),
      F("validUpTo", "Valid up to", "date", null, 79, "[Insert date of validity"),
      F("claimUpTo", "Claim period up to (at least 30 days after validity)", "date", null, 79, "SECI shall be entitled to invoke this Bond till"),
      F("executedOn", "Executed on (day, month, year, place)", "text", null, 79, "Dated this ............................. day of"),
      F("insurerSignatory", "Insurer's signatory (name, designation)", "text", null, 79, "(Designation with Insurer stamp)"),
      F("insurerEmail", "E-mail of the branch", "text", null, 79, "Email id of the Branch for confirmation of this Bond:"),
      F("insurerPoa", "Insurer's power of attorney number and date", "text", null, 79, "Authorized Vide Power of Attorney No."),
      F("witness1", "Witness 1 (signature, name, official address)", "text", null, 79, "WITNESS :"),
      F("witness2", "Witness 2 (signature, name, official address)", "text", null, 79, "WITNESS :"),
    ],
  },
  {
    id: "7.4", title: "Board Resolutions", pages: [80, 81], applies: "always",
    submittedBy: "The Company Secretary / a Director, as a certified true copy", paper: "Letterhead of the Company", envelope: "techno-commercial", when: "with the bid",
    purpose: "Authorises the signatory to bid and commits the equity (each member of a consortium passes its own)",
    heading: { doc: "rfs", page: 80, quote: "Format 7.4 FORMAT FOR BOARD RESOLUTIONS" },
    fields: [
      F("meetingDate", "Date of the board meeting", "date", null, 80, "at the duly convened Meeting on"),
      F("signatory", "Person authorised (name)", "text", "signatory", 80, "RESOLVED THAT  Mr/ Ms"),
      F("rfsNo", "RfS number", "text", "rfsNo", 80, "response to RfS vide RfS No."),
      F("title", "RfS title", "text", "title", 80, "(insert title of the RfS)"),
      F("equityPct", "Equity commitment of this member (%)", "text", null, 80, "[Insert the % equity commitment as specified in Consortium Agreement]", { when: "consortium" }),
      F("otherMembers", "Other members of the Consortium", "text", null, 80, "[Insert the name of other Members in the", { when: "consortium" }),
      F("agreementDate", "Consortium Agreement date", "date", null, 80, "Consortium  Agreement  dated", { when: "consortium" }),
      F("certifier", "Certified by (Company Secretary / Director, ACS No. / DIN)", "text", null, 81, "(Signature, Name and Stamp of Company Secretary/ Director)"),
    ],
  },
  {
    id: "7.5", title: "Consortium Agreement", pages: [82, 85], applies: "consortium",
    submittedBy: "Every member of the Consortium; notarised", paper: "Non-judicial stamp paper of appropriate value", envelope: "techno-commercial", when: "with the bid",
    purpose: "The members' equity shares, the Lead Member's liability and the 51% lock-in until a year after the SCD",
    heading: { doc: "rfs", page: 82, quote: "Format 7.5 FORMAT FOR CONSORTIUM AGREEMENT" },
    fields: [
      F("executedOn", "Executed on (day, month, year)", "text", null, 82, "executed on this ___ Day of"),
      F("leadMember", "Lead Member (Member-1)", "text", "leadMember", 82, "[Insert  name  of  Lead"),
      F("leadLaw", "Member-1: incorporated under the laws of", "text", null, 82, "a Company incorporated under the laws of"),
      F("leadOffice", "Member-1: registered office", "text", null, 82, "having its Registered Office"),
      F("members", "Other members (name, law of incorporation, registered office; one per line)", "textarea", null, 82, "[The  Bidding"),
      F("rfsNo", "RfS number", "text", "rfsNo", 82, "against RfS No."),
      F("rfsDate", "RfS date", "date", "rfsDate", 82, "against RfS No."),
      F("title", "RfS title", "text", "title", 82, "(insert title of the RfS)"),
      F("shares", "Equity shares (member and percentage, one per line, total 100%)", "textarea", null, 83, "in the following proportion:"),
      F("signatories", "Signatories of each member with their board resolution dates", "textarea", null, 84, "(Signature, Name & Designation of the person authorized vide Board Resolution Dated"),
      F("witnesses", "Witnesses (name, address)", "textarea", null, 84, "Witnesses:"),
    ],
  },
  {
    id: "7.6", title: "Financial Requirement", pages: [86, 89], applies: "always",
    submittedBy: "The authorised signatory and a Chartered Accountant (membership number, firm registration, UDIN)", paper: "Letterhead of the Bidding Company/ Lead Member of Consortium", envelope: "techno-commercial", when: "with the bid",
    purpose: "The net worth of clause 37.1 and one liquidity route of clause 37.2 (turnover, PBDIT or a line of credit), certified",
    heading: { doc: "rfs", page: 86, quote: "Format 7.6 FORMAT FOR FINANCIAL REQUIREMENT" },
    fields: [
      ...HEAD(86),
      F("netWorthCr", "Net worth demonstrated (₹ crore)", "number", "netWorthCr", 86, "by demonstrating a Net Worth of Rs.………….. Cr."),
      F("netWorthWords", "Net worth in words", "text", null, 86, "(………………… in words) as on the last date of Financial Year"),
      F("netWorthYear", "Financial year of the net worth", "text", "netWorthYear", 86, "as on the last date of Financial Year 2024-25/2025-26"),
      F("netWorthTable", "Net worth table: company, affiliate, relationship, net worth (one row per line)", "table", null, 86, "For the above calculations, we have considered the Net Worth by Bidding Company and/ or its"),
      F("liquidityRoute", "Liquidity criterion met through", "choice", "liquidityRoute", 87, "is fulfilling the minimum Annual Turnover", { options: ["Annual turnover", "PBDIT", "Line of credit (sanction letter)"] }),
      F("turnoverCr", "Annual turnover demonstrated (₹ crore)", "number", "turnoverCr", 87, "by demonstrating an Annual Turnover of INR _________"),
      F("turnoverTable", "Turnover table: company, affiliate, relationship, turnover (one row per line)", "table", null, 87, "we have considered the Annual Turnover by Bidding Company"),
      F("pbditCr", "PBDIT demonstrated (₹ crore)", "number", "pbditCr", 88, "by demonstrating a"),
      F("pbditTable", "PBDIT table: company, affiliate, relationship, PBDIT (one row per line)", "table", null, 88, "we have considered the PBDIT by Bidding Company"),
      F("signatory", "Authorised signatory (name, designation)", "text", "signatory", 89, "(Signature & Name of the Authorized Signatory)"),
      F("ca", "Chartered Accountant (name, membership no., firm registration no., UDIN, date)", "text", null, 89, "(Signature and Stamp of CA)"),
    ],
  },
  {
    id: "7.7", title: "Undertaking (not a wilful defaulter, not blacklisted)", pages: [90, 90], applies: "always",
    submittedBy: "The Bidding Company / each member of a Consortium (authorised signatory)", paper: "Letterhead of the Bidding Company/ Each Member of Consortium", envelope: "techno-commercial", when: "with the bid",
    purpose: "That the bidder and its affiliates are not wilful defaulters and have not been barred or blacklisted",
    heading: { doc: "rfs", page: 90, quote: "Format 7.7 UNDERTAKING" },
    fields: [
      F("rfsNo", "RfS number", "text", "rfsNo", 90, "response to RfS vide RfS No."),
      F("rfsDate", "RfS date", "date", "rfsDate", 90, "response to RfS vide RfS No."),
      F("bidDeadline", "Last date of bid submission", "date", "bidDeadline", 90, "[Insert last date of bid submission]"),
      F("bidder", "Bidder's name", "text", "bidder", 90, "(insert name of the Bidder)"),
      ...SIGN(90),
    ],
  },
  {
    id: "7.8", title: "Disclosure (no group company bidding separately)", pages: [91, 92], applies: "always",
    submittedBy: "The Bidding Company / each member of a Consortium (authorised signatory)", paper: "Letterhead of the Bidding Company/ Each Member of Consortium", envelope: "techno-commercial", when: "with the bid",
    purpose: "That only this bidder of its group is bidding, who its promoters are, the land-border OM and the ALMM undertakings",
    heading: { doc: "rfs", page: 91, quote: "Format 7.8 FORMAT FOR DISCLOSURE" },
    fields: [
      ...HEAD(91),
      F("promoters", "Promoter(s) with direct or indirect control", "text", null, 91, "(enter name of the Promoter/Promoters) is/are our Promoter(s)"),
      ...SIGN(92),
    ],
  },
  {
    id: "7.8A", title: "Disclosure (a common shareholder of 10–26% in other bidders)", pages: [93, 94], applies: "common-shareholding",
    submittedBy: "The Bidding Company / each member of a Consortium (authorised signatory)", paper: "Letterhead of the Bidding Company/ Each Member of Consortium", envelope: "techno-commercial", when: "with the bid",
    purpose: "Where one company holds more than 10% but less than 26% in this and another bidder: who it is and that it takes no part in the bid",
    heading: { doc: "rfs", page: 93, quote: "Format 7.8A FORMAT FOR DISCLOSURE" },
    fields: [
      ...HEAD(93),
      F("commonShareholder", "The common shareholder", "text", null, 93, "(enter name of the common shareholder) is our Group Company"),
      F("promoters", "Promoter(s) with direct or indirect control", "text", null, 93, "(enter name of the Promoter/Promoters) is/are our Promoter(s)"),
      ...SIGN(94),
    ],
  },
  {
    id: "7.8-annex", title: "Declaration: restriction on procurement from certain countries (annexure to 7.8 / 7.8A)", pages: [95, 95], applies: "always",
    submittedBy: "The Bidding Company / each member of a Consortium (authorised signatory)", paper: "Letterhead of the Bidding Company/ Each Member of Consortium", envelope: "techno-commercial", when: "with the bid",
    purpose: "The declaration under the Ministry of Finance OM of 23.02.2023 on bidders from countries sharing a land border with India",
    heading: { doc: "rfs", page: 95, quote: "Annexure to Format 7.8/7.8A DECLARATION" },
    fields: [...HEAD(95), ...SIGN(95)],
    attachments: [{ label: "OM No. F.7/10/2021-PPD(1) dated 23.02.2023 (and the registration by the Competent Authority, where applicable)", context: ctx(95, "Encl: OM dated 23.02.2023, as referred above.") }],
  },
  {
    id: "7.9", title: "Declaration for the proposed technology tie-up", pages: [96, 96], applies: "always",
    submittedBy: "The Bidding Company / Lead Member (authorised signatory)", paper: "Letterhead of the Bidder", envelope: "techno-commercial", when: "with the bid",
    purpose: "The project's locations and the installed capacity of each component, with a write-up on the storage",
    heading: { doc: "rfs", page: 96, quote: "Format 7.9 DECLARATION BY THE BIDDER FOR THE PROPOSED TECHNOLOGY TIE-UP" },
    fields: [
      F("bidder", "Bidding Company / Lead Member", "text", "bidder", 96, "Name of Bidding Company/ Lead Member of Bidding"),
      F("locations", "Locations of the project components", "text", "site", 96, "Locations of the Project components"),
      F("contractedMw", "Contracted Capacity proposed (MW)", "number", "contractedMw", 96, "Contracted Capacity proposed"),
      F("solarMw", "Solar component (MW)", "number", "solarMw", 96, "Rated Installed Capacity of Solar component"),
      F("windMw", "Wind and other RE components (MW)", "number", "windMw", 96, "Rated Installed Capacity of Wind component and"),
      F("bessMw", "ESS component (MW)", "number", "bessMw", 96, "Rated cumulative Installed Capacity of the ESS"),
      F("bessMwh", "ESS component (MWh)", "number", "bessMwh", 96, "Rated cumulative Installed Capacity of the ESS"),
      F("date", "Dated", "date", "date", 96, "Dated the_____________day of________, 20…."),
      ...SIGN(96),
    ],
    attachments: [{ label: "A brief write-up about the ESS", context: ctx(96, "(Brief write-up about the") }],
  },
  {
    id: "7.10", title: "Integrity Pact", pages: [97, 97], applies: "always",
    submittedBy: "The Bidding Company (every member of a Consortium), signed and stamped", paper: "SECI's signed copy from the ETS portal", envelope: "techno-commercial", when: "with the bid",
    purpose: "The Integrity Pact signed by SECI, returned signed and stamped",
    heading: { doc: "rfs", page: 97, quote: "Format 7.10 INTEGRITY PACT" },
    fields: [],
    attachments: [{ label: "The scanned Integrity Pact from the ETS portal, signed and stamped (by every member of a consortium)", context: ctx(97, "Bidders are required to submit duly") }],
  },
  {
    id: "7.11", title: "Submission of the financial bid", pages: [98, 99], applies: "always",
    submittedBy: "The Bidding Company / Lead Member (authorised signatory)", paper: "Letterhead of the Bidding Company/ Lead Member of Consortium", envelope: "financial", when: "with the bid (the tariff itself is entered on the ETS portal)",
    purpose: "The covering letter of the financial bid: one strike price for the contracted capacity, valid 12 months and until the CfDA",
    heading: { doc: "rfs", page: 98, quote: "Format 7.11 FORMAT FOR SUBMISSION OF FINANCIAL BID" },
    fields: [
      ...HEAD(98),
      F("contractedMw", "Contracted Capacity (MW)", "number", "contractedMw", 98, "for a Contracted Capacity of ____ MW"),
      ...SIGN(98),
    ],
  },
  {
    id: "7.12", title: "Preliminary estimate of the cost of the RE power project", pages: [100, 100], applies: "always",
    submittedBy: "The Bidding Company / Lead Member (authorised signatory)", paper: "Letterhead of the Bidder", envelope: "techno-commercial", when: "with the bid",
    purpose: "The project cost break-up, for SECI's records only",
    heading: { doc: "rfs", page: 100, quote: "Format 7.12 PRELIMINARY ESTIMATE OF COST OF RE POWER PROJECT" },
    fields: [
      F("contractedMw", "Contracted Capacity (MW)", "number", "contractedMw", 100, "Contracted Capacity: ……….MW"),
      F("location", "Location", "text", "site", 100, "Location:"),
      F("costBreakup", "Cost break-up (any format; one line per item)", "table", null, 100, "Bidder may use any format to provide the break-up."),
      F("date", "Dated", "date", "date", 100, "Dated the_____________day of________, 20…."),
      ...SIGN(100),
    ],
  },
];

export const formatById = (id) => FORMATS.find((f) => f.id === id) || null;

/** Values the bid already holds, by the `maps` names the formats use. */
export function modelValues(state) {
  const i = state.inputs || {};
  const X = isNum(i.contractedMw) ? i.contractedMw : null;
  const amounts = X ? rfsAmounts(i) : null;
  return {
    contractedMw: mw(X),
    solarMw: isNum(i.solarMw) ? mw(i.solarMw) : "",
    windMw: isNum(i.windMw) ? mw(i.windMw) : "0",
    otherReMw: "0",
    bessMw: X && isNum(i.essMwPerMw) ? mw(X * i.essMwPerMw) : "",
    bessMwh: X && isNum(i.essMwhPerMw) ? mw(X * i.essMwhPerMw) : "",
    emdAmount: amounts ? rs(amounts.emdCr * 1e7) : "",
    pbgAmount: amounts ? rs(amounts.pbgCr * 1e7) : "",
    cacAmount: amounts ? rs(amounts.cacCr * 1e7) : "",
    rfsNo: RFS.number,
    rfsDate: RFS.date,
    title: RFS.title,
  };
}
const MODEL = new Set(["contractedMw", "solarMw", "windMw", "otherReMw", "bessMw", "bessMwh", "emdAmount", "pbgAmount", "cacAmount", "rfsNo", "rfsDate", "title"]);
/** Shared particulars a format blank maps to (state.forms keys); `date` is the letters' date. */
const SHARED = { date: "letterDate", tariff: "tariff", netWorthCr: "netWorthCr", netWorthYear: "netWorthYear" };

/** Whether a blank applies to this bid: a blank marked `when: "consortium"` is left out of a single company's format. */
export function fieldApplies(state, field) {
  if (field.when === "consortium") return state.forms?.bidderType === "consortium";
  return true;
}

export const NOT_APPLICABLE = "Not applicable (single company)";

/** Where a blank's value comes from: { source: "model"|"shared"|"own"|"na", key, value }. */
export function blankValue(state, format, field) {
  const f = state.forms || {};
  if (!fieldApplies(state, field)) return { source: "na", key: `${format.id}.${field.key}`, value: NOT_APPLICABLE };
  if (field.maps && MODEL.has(field.maps)) return { source: "model", key: field.maps, value: modelValues(state)[field.maps] };
  if (field.maps) {
    const key = SHARED[field.maps] || field.maps;
    const v = f[key];
    const options = FORM_FIELDS.find((x) => x.key === key)?.options;
    const shown = v === undefined || v === null ? "" : options ? options.find(([k]) => k === v)?.[1] || String(v) : /date|Deadline/i.test(key) ? fmtDate(v) : String(v);
    return { source: "shared", key, value: shown };
  }
  const key = `${format.id}.${field.key}`;
  const v = f[key];
  return { source: "own", key, value: v === undefined || v === null ? "" : field.kind === "date" ? fmtDate(v) : String(v) };
}

/** Whether this bid needs the format: "yes", "no", "later" (after award) or "choose" (an EMD form to pick). */
export function applies(state, format) {
  const f = state.forms || {};
  const a = format.applies;
  if (a === "always") return "yes";
  if (a === "consortium") return f.bidderType === "consortium" ? "yes" : "no";
  if (a.startsWith("emd-")) return !f.emdForm ? "choose" : a === `emd-${f.emdForm}` ? "yes" : "no";
  if (a.startsWith("pbg-")) return "later";
  if (a === "common-shareholding") return f.commonShareholding === "yes" ? "yes" : "no";
  return "yes";
}

/** A fingerprint of a format's filled values, so a review is known to be out of date after an edit. */
export function formatPrint(state, format) {
  const vals = format.fields.map((x) => blankValue(state, format, x).value);
  const att = (format.attachments || []).map((_, i) => (state.forms?.[`${format.id}.att.${i}`] ? 1 : 0));
  const edits = state.letters?.[format.id] || {};
  let h = 0;
  for (const ch of JSON.stringify([vals, att, edits])) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

/**
 * The state of one format: { applies, filled, total, missing (labels), attached, attachments,
 * reviewed: null | "current" | "changed" }. Table blanks are optional (a schedule may be attached).
 */
export function formatStatus(state, format) {
  const needed = format.fields.filter((x) => x.kind !== "table" && fieldApplies(state, x));
  const missing = needed.filter((x) => !blankValue(state, format, x).value).map((x) => x.label);
  const att = format.attachments || [];
  const review = state.formsReview?.[format.id] || null;
  return {
    applies: applies(state, format),
    filled: needed.length - missing.length,
    total: needed.length,
    missing,
    attached: att.filter((_, i) => state.forms?.[`${format.id}.att.${i}`]).length,
    attachments: att.length,
    reviewed: !review ? null : review.print === formatPrint(state, format) ? "current" : "changed",
    reviewedAt: review?.at || null,
  };
}

/** The formats in the order to work through them, grouped as they are submitted. */
export function formatGroups(state) {
  const groups = [
    { id: "envelope1", title: "Envelope I · techno-commercial", list: [] },
    { id: "envelope2", title: "Envelope II · financial", list: [] },
    { id: "later", title: "After the award", list: [] },
    { id: "na", title: "Not needed for this bid", list: [] },
  ];
  for (const f of FORMATS) {
    const a = applies(state, f);
    const g = a === "no" ? "na" : a === "later" ? "later" : /financial/i.test(f.envelope) ? "envelope2" : "envelope1";
    groups.find((x) => x.id === g).list.push(f);
  }
  return groups.filter((g) => g.list.length);
}

/** Totals for the step header and the checks: formats needed, complete, reviewed. */
export function formatsSummary(state) {
  const needed = FORMATS.filter((f) => ["yes", "choose"].includes(applies(state, f)));
  const st = needed.map((f) => formatStatus(state, f));
  return {
    needed: needed.length,
    complete: st.filter((s) => s.applies === "yes" && s.missing.length === 0).length,
    reviewed: st.filter((s) => s.reviewed === "current").length,
    blanksLeft: st.reduce((a, s) => a + s.missing.length, 0),
  };
}

/** The formats as the bid pack lays them out: the ones this bid needs, every blank and its value. */
export function formatsForPack(state) {
  return FORMATS.filter((f) => applies(state, f) !== "no").map((f) => {
    const s = formatStatus(state, f);
    return {
      id: f.id, title: f.title, pages: f.pages, submittedBy: f.submittedBy, paper: f.paper, envelope: f.envelope, when: f.when,
      applies: s.applies, reviewed: s.reviewed, reviewedAt: s.reviewedAt,
      fields: f.fields.filter((x) => fieldApplies(state, x)).map((x) => ({ label: x.label, value: blankValue(state, f, x).value, page: x.context.page })),
      attachments: (f.attachments || []).map((a, i) => ({ label: a.label, done: Boolean(state.forms?.[`${f.id}.att.${i}`]) })),
    };
  });
}

/** The tender's securities and thresholds this bid needs (₹ crore), for the checks. */
export const tenderAmounts = (state) => (isNum(state.inputs?.contractedMw) ? rfsAmounts(state.inputs) : null);

export { TENDER, fmtDate };
