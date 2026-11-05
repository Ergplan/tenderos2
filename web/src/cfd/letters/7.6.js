// Format 7.6: Financial Requirement (RfS PDF pp. 86-89). Syntax: web/src/seci/letters/index.js.
export default {
  omit: ["netWorthTable", "turnoverTable", "pbditTable"],
  text: `# Format 7.6
# FORMAT FOR FINANCIAL REQUIREMENT

> (This should be submitted on the Letter Head of the Bidding Company/ Lead Member of Consortium)

Ref. No. {{refNo}}
Date: {{date}}

From: {{bidder}}
{{address}}
Tel.#: {{phone}}
E-mail address#: {{email}}

To
Solar Energy Corporation of India Limited
6th Floor, Plate-B, NBCC Office Block Tower-2,
East Kidwai Nagar, New Delhi - 110 023

Sub: Response to RfS No. {{rfsNo}} dated {{rfsDate}} for {{title}}.

Dear Sir/ Madam,

We certify that the Bidding Company/Member in a Bidding Consortium is meeting the financial eligibility requirements as per the provisions of the RfS. Accordingly, the Bidder, with the support of its Affiliates, (strike out if not applicable) is fulfilling the minimum Net Worth criteria, by demonstrating a Net Worth of Rs. {{netWorthCr}} Cr. ({{netWorthWords}} in words) as on the last date of Financial Year {{netWorthYear}} or as on the date at least 7 days prior to the bid submission deadline (Strike out whichever is not applicable).
This Net Worth has been calculated in accordance with instructions provided in Clause 37.1 of the RfS.

## Exhibit (i): Applicable in case of Bidding Company

For the above calculations, we have considered the Net Worth by Bidding Company and/ or its Affiliate(s) as per following details:

| Name of Bidding Company | Name of Affiliate(s) whose net worth is to be considered | Relationship with Bidding Company* | Net Worth (Rs. Crore) |
| {{netWorthTable}} | | | |
| Total | | | |

> *The column for "Relationship with Bidding Company" is to be filled only in case the financial capability of Affiliate has been used for meeting Qualification Requirements. Further, documentary evidence to establish the relationship, duly certified by a practicing company secretary/ chartered accountant is required to be attached with the format.

[only consortium] ## Exhibit (ii): Applicable in case of Bidding Consortium

[only consortium] (To be filled by each Member in a Bidding Consortium separately)
Name of Member: [Insert name of the Member]
Net Worth Requirement to be met by Member: INR ------------- Crore
For the above calculations, we have considered Net Worth by Member in Bidding Consortium and/ or its Affiliate(s) per following details:

[if liquidityRoute=Annual turnover] Further, we certify that the Bidding Company/ Member in the Bidding Consortium, with the support of its Affiliates, (strike out if not applicable) is fulfilling the minimum Annual Turnover Criteria, by demonstrating an Annual Turnover of INR {{turnoverCr}} Crore as on the end of Financial Year {{netWorthYear}} or as on the day at least 7 days prior to the bid submission deadline (choose one). (Strike out if not applicable)

[if liquidityRoute=Annual turnover] For the above calculations, we have considered the Annual Turnover by Bidding Company and/ or its Affiliate(s) as per following details:

| Name of Bidding Company | Name of Affiliate(s) whose Annual Turnover is to be considered | Relationship with Bidding Company* | Annual Turnover (Rs. Crore) |
| {{turnoverTable}} | | | |
| Total | | | |

[if liquidityRoute=PBDIT] Further, we certify that the Bidding Company/ Member in the Bidding Consortium, with the support of its Affiliates, (strike out if not applicable) is fulfilling the minimum Profit Before Depreciation Interest and Taxes (PBDIT) criteria as mentioned in the RfS, by demonstrating a PBDIT of INR {{pbditCr}} Crore as on the end of Financial Year {{netWorthYear}} or as on the day at least 7 days prior to the bid submission deadline. (Strike out if not applicable)

[if liquidityRoute=PBDIT] For the above calculations, we have considered the PBDIT by Bidding Company and/ or its Affiliate(s) as per following details:

| Name of Bidding Company | Name of Affiliate(s) whose PBDIT is to be considered | Relationship with Bidding Company* | PBDIT (Rs. Crore) |
| {{pbditTable}} | | | |
| Total | | | |

[if liquidityRoute=Line of credit (sanction letter)] The Liquidity criteria is met through an In-principle sanction letter from our lending institution/ bank committing a Line of Credit as per Clause 37.2 (iii) of the RfS, submitted separately as part of this response to RfS.

{{signatory}}
(Signature & Name of the Authorized Signatory)

{{ca}}
(Signature and Stamp of CA)
Membership No.
Regn. No. of the CA's Firm:
UDIN:
Date:

> Note: (i) Along with the above format, in a separate sheet on the letterhead of the Chartered Accountant's Firm, provide details of computation of Net Worth and Annual Turnover/ PBDIT (as applicable) duly certified by the Chartered Accountant.
> (ii) Certified copies of Balance sheet, Profit & Loss Account, Schedules and Cash Flow Statements are to be enclosed in complete form along with all the Notes to Accounts.
> (iii) In case of the Bidder choosing to meet the Liquidity criteria through an In-principle sanction letter, such document shall be separately submitted by the bidder as part of the bidder's Response to RfS.
`,
};
