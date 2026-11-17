// Format 7.1: Covering Letter (RfS PDF pp. 66-69), the RfS wording with its blanks as {{key}}
// placeholders. The syntax is described in web/src/seci/letters/index.js. Para 5 (the rebate for
// cover under the payment security mechanism) is kept or struck out by the bid's choice (Bid inputs).
export default {
  omit: [],
  text: `# Format 7.1
# COVERING LETTER

> (The Covering Letter should be submitted on the Letter Head of the Bidding Company/ Lead Member of Consortium)

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

Sub: Response to RfS No. {{rfsNo}} dated {{rfsDate}} for {{title}}

Dear Sir/ Madam,

We, the undersigned {{bidder}} having read, examined and understood in detail the RfS including Qualification Requirements in particular, terms and conditions of the standard PPA for supply of power for the Term of the PPA to SECI, hereby submit our response to RfS.

[if groupDisclosure=No group company has bid (Format 7.8)] We confirm that in response to the aforesaid RfS, neither we nor any of our Ultimate Parent Company/ Parent Company/ Affiliate/ Group Company has submitted response to RfS other than this response to RfS, directly or indirectly, in response to the aforesaid RfS (as mentioned in Format 7.8 under Disclosure) {strike out if not applicable}

OR

[if groupDisclosure=Common shareholder >10% <26% in other bidders (Format 7.8A)] We confirm that in the response to the aforesaid RfS, we have a Group Company who owns more than 10% but less than 26% in the bidding company as well as other companies who may participate in this RfS, and accordingly, we have submitted requisite undertaking as per Format 7.8A in this regard. {strike out if not applicable}

We also confirm that we including our Ultimate Parent Company/ Parent Company/ Affiliate/ Group Companies directly or indirectly have not submitted response to RfS for more than cumulative assured Peak Supply of 600 MW, including this response to RfS.

We are submitting application for the development of following Project(s)

| Project No. | Contracted Capacity offered (MW) | Installed Capacity to be committed under the PPA (Rated capacities of respective components) | Location of Project (Village, Tehsil, Dist., State) | Interconnection Point Details | Project Preference* |
| 1. | {{contractedMw}} | Solar PV component: {{solarMw}} MW\\nWind power component: {{windMw}} MW\\nOther RE power generating component: {{otherReMw}} MW\\nESS component: {{bessMw}} MW/ {{bessMwh}} MWh | {{location}} | {{substation}} | {{preference}} |

> *The preferences of the Projects shall be considered only for the last successful Bidder whose total quoted capacity is more than the balance capacity. In this case, allocation will be done as described in Clause 40.2 of the RfS.

1. We give our unconditional acceptance to the RfS, dated {{acceptedRfsDate}} [Insert date in dd/mm/yyyy], standard PPA and PSA documents attached thereto, issued by SECI. In token of our acceptance to the RfS, PPA and PSA documents along with the amendments and clarifications issued by SECI, the same have been digitally signed by us and enclosed with the response to RfS. We shall ensure that the PPA is executed as per the provisions of the RfS and provisions of PPA and shall be binding on us. Further, we confirm that we will commence power supply from the full Project capacity within the deadline as per Clause 9 of the RfS.

2. Earnest Money Deposit (EMD):- (Please read Clause 16 carefully before filling)
We have enclosed EMD of {{emdAmount}}, in the form of [[emdForm=Bank Guarantee (Format 7.3A)|Bank Guarantee]]/[[emdForm=Payment on Order Instrument (Format 7.3B)|Payment on Order Instrument]]/[[emdForm=Insurance Surety Bond (Format 7.3C)|Surety Bond]] no. {{emdNumber}} dated {{emdDate}} as per Format 7.3A/7.3B/7.3C from {{emdIssuer}} and valid up to {{emdValidUpTo}} in terms of Clause No. 16 of this RfS. The quoted Contracted Capacity of the RE Project offered by us is {{quotedMw}} MW [Insert cumulative Contracted Capacity proposed]. (Strike off whichever is not applicable)

3. We hereby declare that in the event our Project(s) get selected and we are not able to submit Bank Guarantee/POI/Surety Bond of the requisite value(s) towards PBG, Success charge for the selected Projects, within due time as mentioned in Clause Nos. 17 & 18 of this RfS on issue of LoA by SECI for the selected Projects and/ or we are not able to sign PPA with SECI within the timeline as stipulated in the RfS for the selected Projects, SECI shall have the right to encash the EMD submitted by us and return the balance amount (if any) for the value of EMD pertaining to unsuccessful capacity.

[if alreadyCommissioned=Applicable] 4. We hereby declare that the Project Capacity, for which the bid is being submitted by us has already been commissioned by us, and for the same, we have not suo-moto terminated any already signed PPAs with Renewable Energy Implementing Agencies as identified by the MNRE and/or State-owned Distribution Company (DISCOM) for participating in this RfS under Clause 1.6 of the RfS. (applicable only in case of already commissioned Projects. Strike-off if not applicable.)

[if psmRebate=Accepted: Rs. 0.02/kWh off every monthly bill for the whole term (RfS 18.4)] 5. We hereby undertake that we shall give a rebate of Rs. 0.02/kWh to SECI in the payment of monthly bills to be made by SECI, as part of payment security mechanism charges under the PPA, to avail the benefits under the payment security mechanism as per PPA. (Strike out if not accepted by the Bidder)

6. We have submitted our response to RfS strictly as per Section 7 (Sample Forms and Formats) of this RfS, without any deviations, conditions and without mentioning any assumptions or notes in the said Formats.

7. We hereby declare that during the selection process, in the event our bid happens to be the last bid in the list of successful bids and SECI offers a capacity which is greater than or equal to 50% of our quoted capacity due to overall bid capacity limit, we shall accept such offered capacity.

8. Acceptance:-
We hereby unconditionally and irrevocably agree and accept that the decision made by SECI in respect of any matter regarding or arising out of the RfS shall be binding on us. We hereby expressly waive and withdraw any deviations from the provisions of the RfS and all claims in respect of this process.
We also unconditionally and irrevocably agree and accept that the decision made by SECI in respect of award of Projects according to our preference order as above and in line with the provisions of the RfS, shall be binding on us.

9. Familiarity with Relevant Indian Laws & Regulations:-
We confirm that we have studied the provisions of the relevant Indian Laws and Regulations as required to enable us to submit this response to RfS and execute the PPA, in the event of our selection as Successful Bidder.

10. In case of our selection as the Successful Bidder under the scheme and the project being executed by a Special Purpose Vehicle (SPV) incorporated/ utilized by us which shall be our subsidiary, we shall infuse necessary equity to the requirements of RfS. Further we will submit a Board Resolution prior to signing of PPA with SECI, committing total equity infusion in the SPV as per the provisions of RfS.

11. We are submitting our response to the RfS with formats duly signed as desired by you in the RfS online for your consideration.

12. It is confirmed that our response to the RfS is consistent with all the requirements of submission as stated in the RfS, including all clarifications and amendments and subsequent communications from SECI.

13. The information submitted in our response to the RfS is correct to the best of our knowledge and understanding. We would be solely responsible for any errors or omissions in our response to the RfS.

14. We confirm that all the terms and conditions of our Bid are valid for a period up to the date as on 12 months from the last date of submission of response to RfS. We confirm that in the event of issuance of LoA under the RfS, the tariff indicated in the LoA shall be valid until the signing of PPA, pursuant to Clause 42.4 of the RfS.

15. Contact Person
Details of the representative to be contacted by SECI are furnished as under:

| Name | : {{contactName}} |
| Designation | : {{contactDesignation}} |
| Company | : {{contactCompany}} |
| Address | : {{contactAddress}} |
| Phone Nos. | : {{contactPhone}} |
| Mobile Nos. | : {{contactMobile}} |
| E-mail address | : {{contactEmail}} |

16. We have neither made any statement nor provided any information in this Bid, which to the best of our knowledge is materially inaccurate or misleading. Further, all the confirmations, declarations and representations made in our Bid are true and accurate. In case this is found to be incorrect after our selection as Successful Bidder, we agree that the same would be treated as a seller’s event of default under PPA and consequent provisions of PPA shall apply.

Enclosure: Copy of application of connectivity at the Delivery Point.

Dated the {{dated}}
Thanking you,
We remain,
Yours faithfully,

{{signatory}}
Name, Designation, Seal and Signature of Authorized Person in whose name Power of Attorney/ Board Resolution/ Declaration.
`,
};
