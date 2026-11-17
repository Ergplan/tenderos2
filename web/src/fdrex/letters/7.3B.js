// Format 7.3B: Payment on Order Instrument of REC/PFC in lieu of the bank guarantee towards EMD
// (RfS PDF pp. 74-76). Syntax: web/src/seci/letters/index.js.
export default {
  omit: [],
  text: `# Format 7.3 B
# FORMAT OF PAYMENT ON ORDER INSTRUMENT TO BE ISSUED BY REC/PFC
# (IN LIEU OF BG TOWARDS EMD)

No. {{poiNo}}
Date {{poiDate}}

SECI,
Registered
__________,
__________

Reg: M/s {{bidder}} (insert name of the Bidder) – Issuance of Payment on Order Instrument for an amount of Rs. {{emdAmount:num}}

Dear Sir,

1. It is to be noted that M/s. {{agency}} (insert name of the POI issuing Agency) (‘REC/PFC’) has sanctioned a non-fund based limit loan of Rs. {{loanLimit}} to M/s {{borrower}} under the Loan Agreement executed on {{loanDate}} to execute Renewable Energy Projects.

2. At the request of M/s {{borrower}}, on behalf of {{bidder}} (insert name of the Bidder), this Payment on Order Instrument (POI) for an amount of Rs. {{emdAmount:num}} (Rupees {{emdAmount:words}} (in words)). This Payment on Order Instrument comes into force immediately.

3. In consideration of the {{bidder}} [Insert name of the Bidder] (hereinafter referred to as 'Bidder') submitting the response to RfS inter alia for assured Peak Supply of 4800 MWh (1200 MW x 4 Hrs.) from ISTS-Connected RE Projects in India (SECI-FDRE-X) of the cumulative Contracted Capacity of {{contractedMw}} MW [Insert cumulative Contracted Capacity proposed] for supply of power there from on long term basis, in response to the RfS No. {{rfsNo}} dated {{rfsDate}} issued by Solar Energy Corporation of India Limited (hereinafter referred to as SECI) and SECI considering such response to the RfS of {{bidder}} [Insert the name of the Bidder] as per the terms of the RfS, the {{agencyAddress}} [Insert name & address of PFC/REC] hereby agrees unequivocally, irrevocably and unconditionally to pay to SECI at {{place}} [Insert Name of the Place from the address of SECI] forthwith without demur on demand in writing from SECI or any Officer authorized by it in this behalf, any amount up to and not exceeding Rupees {{emdAmount:num}} [Insert amount not less than that derived in line with Clause 16 of the RfS], only, on behalf of M/s {{bidder}} [Insert name of the Bidder].

4. In consideration of the above facts, REC/PFC, having its registered office at {{agencyOffice}}, agrees to make payment for the sum of Rs. {{amountLakhs}} lakhs (in words) to SECI on the following conditions: -

(a) REC/PFC agrees to make payment of the said amount unconditionally, without demur and without protest upon receipt of request from SECI within the validity period of this letter as specified herein;

(b) The commitment of REC/PFC, under this Payment of Order Instrument will have the same effect as that of the commitment under the Bank Guarantee issued by any Public Sector Bank and shall be enforceable in the same manner as in the case of a Bank Guarantee issued by a Bank and the same shall be irrevocable and shall be honored irrespective of any agreement or its breach between REC/PFC or its constituents notwithstanding any dispute that may be raised by them against SECI;

(c) The liability of REC/PFC continues to be valid and binding on REC/PFC and shall not be terminated, impaired and discharged, by virtue of change in its constitution and specific liability under letter of undertaking shall be binding on its successors or assignors;

(d) The liability of REC/PFC shall continue to be valid and binding on REC/PFC and shall not be terminated/ impaired/ discharged by any extension of time or variation and alternation made given or agreed with or without knowledge or consent of the parties (SECI and Bidding Party), subject to however to the maximum extent of amount stated herein and REC/PFC is not liable to any interest or costs etc.;

(e) This Payment of Order Instrument can be invoked either partially or fully, till the date of validity;

(f) REC/PFC agrees that it shall not require any proof in addition to the written demand by SECI made in any format within the validity period. REC/PFC shall not require SECI to justify the invocation of the POI against the SPV/RPD, to make any claim against or any demand against the SPV/RPD or to give any notice to the SPV/RPD;

(g) The POI shall be the primary obligation of REC/PFC and SECI shall not be obliged before enforcing the POI to take any action in any court or arbitral proceedings against the SPV/RPD;

(h) Neither SECI is required to justify the invocation of this POI nor shall REC/PFC have any recourse against SECI in respect of the payment made under letter of undertaking;

5. Notwithstanding anything contrary contained anywhere in this POI or in any other documents, this POI is and shall remain valid up to {{validUpTo}} [Insert date of validity in accordance with Clause No. 16 of this RfS] and REC/PFC shall make payment thereunder only if a written demand or request is raised within the said date and to the maximum extent of Rs. {{emdAmount:num}} and REC/PFC shall in no case, be liable for any interest, costs, charges and expenses and REC’s/PFC’s liability in no case will exceed more than the above amount stipulated. SECI shall be entitled to invoke this POI till {{claimUpTo}} [Insert a date which is at least 30 days beyond the expiry of the validity period on the basis of Clause No. 16 of this RfS].

6. In pursuance of the above, REC/PFC and SECI have signed an Umbrella Agreement dated {{umbrellaDate}} setting out the terms and conditions for issue of letter of undertaking by REC/PFC to SECI and the said terms and conditions shall be read as a part of this letter of undertaking issued for the project of the project of PP mentioned above.

Thanking you,
Yours faithfully
For and on behalf of
M/s. {{agency}}
(Name of the POI issuing agency).

{{agencySignatory}}
General Manager (TS)

Copy to:-
M/s. {{copyTo}}
As per their request

General Manager (TS)
`,
};
