// Recent SECI auction results, read from SECI's own result notices (www.seci.co.in, Tenders ›
// Results › View Bidder Detail), October 2026. Each record is one notice: the RfS, the dates of the
// e-reverse auction and the LoAs, every bidder awarded with the capacity it bid and the capacity
// awarded at its final tariff, and the bidders in the auction who were not awarded with their final
// tariff. tools/check_market.mjs checks the records add up; the PDFs are linked in sources.
export const SECI_RESULTS = [
  {
    "id": "seci-fdre-ix",
    "agency": "SECI",
    "product": "FDRE peak power",
    "tender": "Assured peak supply, 6000 MWh (1500 MW × 4 h) (SECI-FDRE-IX)",
    "rfsNo": "SECI/C&P/IPP/13/0006/26-27",
    "rfsDate": "2026-06-05",
    "auctionDate": "2026-08-21",
    "loaDate": "2026-08-27",
    "tenderedMw": 1500,
    "storageMwh": 6000,
    "awardedMw": 1500.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 700.0,
        "mw": 700.0,
        "tariff": 5.99
      },
      {
        "name": "NTPC Renewable Energy Limited",
        "bidMw": 500.0,
        "mw": 500.0,
        "tariff": 6.0
      },
      {
        "name": "ACME Solar Holdings Limited",
        "bidMw": 750.0,
        "mw": 300.0,
        "tariff": 6.0
      }
    ],
    "others": [
      {
        "name": "JGRJ Seven Renewable Private Limited",
        "bidMw": 150.0,
        "tariff": 6.02
      },
      {
        "name": "SAEL Industries Limited",
        "bidMw": 600.0,
        "tariff": 6.02
      },
      {
        "name": "EMIF II Holding V II Coöperatief W.A.",
        "bidMw": 300.0,
        "tariff": 6.08
      },
      {
        "name": "Avaada BESS Private Limited",
        "bidMw": 300.0,
        "tariff": 6.21
      },
      {
        "name": "Rama Reflection India Private Limited",
        "bidMw": 60.0,
        "tariff": 6.25
      },
      {
        "name": "MB Power (Madhya Pradesh) Limited",
        "bidMw": 150.0,
        "tariff": 6.35
      },
      {
        "name": "Engie Energy India Private Limited",
        "bidMw": 125.0,
        "tariff": 6.4
      },
      {
        "name": "ReNew Solar Power Private Limited",
        "bidMw": 400.0,
        "tariff": 6.5
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 300.0,
        "tariff": 6.72
      },
      {
        "name": "ABC Solar (India) Private Limited",
        "bidMw": 270.0,
        "tariff": 6.82
      },
      {
        "name": "Resolven One Energy Private Limited",
        "bidMw": 300.0,
        "tariff": 6.88
      },
      {
        "name": "Juniper Green Energy Limited",
        "bidMw": 150.0,
        "tariff": 6.9
      },
      {
        "name": "NLC India Renewables Limited",
        "bidMw": 300.0,
        "tariff": 6.98
      }
    ],
    "note": "A peak-power product: 4 hours of assured supply a day.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_FDRE-IX-_6000_MWh_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/Ymd_"
      }
    ]
  },
  {
    "id": "seci-fdre-rtc-v",
    "agency": "SECI",
    "product": "FDRE-RTC",
    "tender": "1000 MW firm and dispatchable RE, round the clock (SECI-FDRE-RTC-V)",
    "rfsNo": "SECI/C&P/IPP/13/0020/25-26",
    "rfsDate": "2026-03-10",
    "auctionDate": "2026-08-06",
    "loaDate": "2026-08-14",
    "tenderedMw": 1000,
    "storageMwh": null,
    "awardedMw": 1000.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "EMIF II Holding V II Coöperatief W.A.",
        "bidMw": 100.0,
        "mw": 100.0,
        "tariff": 5.25
      },
      {
        "name": "Hero Solar Energy Private Limited",
        "bidMw": 120.0,
        "mw": 120.0,
        "tariff": 5.25
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 70.0,
        "mw": 70.0,
        "tariff": 5.25
      },
      {
        "name": "Resolven Four Energy Private Limited",
        "bidMw": 150.0,
        "mw": 150.0,
        "tariff": 5.25
      },
      {
        "name": "Kengeri Prime Solar Power Private Limited",
        "bidMw": 180.0,
        "mw": 180.0,
        "tariff": 5.25
      },
      {
        "name": "Hexa Climate Solutions Private Limited",
        "bidMw": 150.0,
        "mw": 150.0,
        "tariff": 5.26
      },
      {
        "name": "Juniper Green Energy Limited",
        "bidMw": 300.0,
        "mw": 230.0,
        "tariff": 5.26
      }
    ],
    "others": [
      {
        "name": "ReNew Private Limited",
        "bidMw": 140.0,
        "tariff": 5.27
      },
      {
        "name": "Adyant Enersol Private Limited",
        "bidMw": 70.0,
        "tariff": 5.27
      },
      {
        "name": "ACME Solar Holdings Limited",
        "bidMw": 250.0,
        "tariff": 5.28
      },
      {
        "name": "Serentica Renewables India Private Limited",
        "bidMw": 100.0,
        "tariff": 5.29
      },
      {
        "name": "NTPC Renewable Energy Limited",
        "bidMw": 300.0,
        "tariff": 5.39
      },
      {
        "name": "Solarcraft Power India 4 Private Limited",
        "bidMw": 100.0,
        "tariff": 5.68
      },
      {
        "name": "Greenko Solar Energy Private Limited",
        "bidMw": 350.0,
        "tariff": 5.7
      },
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 100.0,
        "tariff": 6.08
      },
      {
        "name": "Adani Renewable Energy Holding Nine Limited",
        "bidMw": 500.0,
        "tariff": 6.74
      }
    ],
    "note": "Juniper Green Energy bid 300 MW and was awarded 230 MW, filling the tender to 1,000 MW.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_FDRE-RTC-V-_1000_MW_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/YmZ3"
      }
    ]
  },
  {
    "id": "seci-wind-xx",
    "agency": "SECI",
    "product": "Wind",
    "tender": "2000 MW ISTS-connected wind (SECI-Tranche-XX)",
    "rfsNo": "SECI/C&P/IPP/12/0003/26-27",
    "rfsDate": "2026-04-21",
    "auctionDate": "2026-07-15",
    "loaDate": "2026-08-05",
    "tenderedMw": 2000,
    "storageMwh": null,
    "awardedMw": 1495.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "Gentari Renewables India Castor One Private Limited",
        "bidMw": 200.0,
        "mw": 200.0,
        "tariff": 3.78
      },
      {
        "name": "Adyant Enersol Private Limited",
        "bidMw": 110.0,
        "mw": 110.0,
        "tariff": 3.85
      },
      {
        "name": "Torrent Green Energy Private Limited",
        "bidMw": 150.0,
        "mw": 150.0,
        "tariff": 3.85
      },
      {
        "name": "Opera Energy Private Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 3.85
      },
      {
        "name": "Halvad Renewables Private Limited",
        "bidMw": 130.0,
        "mw": 130.0,
        "tariff": 3.85
      },
      {
        "name": "Ayana Renewable Power Private Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 3.85
      },
      {
        "name": "Ganeko Four Energy Private Limited",
        "bidMw": 200.0,
        "mw": 200.0,
        "tariff": 3.85
      },
      {
        "name": "NLC India Renewables Limited",
        "bidMw": 200.0,
        "mw": 200.0,
        "tariff": 3.85
      },
      {
        "name": "Powerica Limited",
        "bidMw": 100.0,
        "mw": 100.0,
        "tariff": 3.85
      },
      {
        "name": "Refex Green Power Limited",
        "bidMw": 80.0,
        "mw": 80.0,
        "tariff": 3.85
      },
      {
        "name": "Atriwal Infrastructure Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 3.85
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 175.0,
        "mw": 175.0,
        "tariff": 3.85
      }
    ],
    "others": [
      {
        "name": "ABReL SPV 2 Limited",
        "bidMw": 201.3,
        "tariff": 3.9
      },
      {
        "name": "Bhojraj Developers Private Limited",
        "bidMw": 160.0,
        "tariff": 4.18
      },
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 500.0,
        "tariff": 4.32
      }
    ],
    "note": "1,885 MW was eligible for award; 1,495 MW was awarded, to the bidders who matched ₹3.85 or bid lower.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_Wind-_2000_MW_(Tranche-XX)_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/Ymd3"
      }
    ]
  },
  {
    "id": "seci-wind-xix",
    "agency": "SECI",
    "product": "Wind",
    "tender": "1200 MW ISTS-connected wind (SECI-Tranche-XIX)",
    "rfsNo": "SECI/C&P/IPP/12/0013/25-26",
    "rfsDate": "2025-10-15",
    "auctionDate": "2026-02-04",
    "loaDate": "2026-02-10",
    "tenderedMw": 1200,
    "storageMwh": null,
    "awardedMw": 1200.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "K.P. Energy Limited",
        "bidMw": 100.0,
        "mw": 100.0,
        "tariff": 3.67
      },
      {
        "name": "Ganeko Three Energy Private Limited",
        "bidMw": 180.0,
        "mw": 180.0,
        "tariff": 3.68
      },
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 300.0,
        "mw": 300.0,
        "tariff": 3.68
      },
      {
        "name": "Opera Energy Private Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 3.68
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 250.0,
        "mw": 250.0,
        "tariff": 3.69
      },
      {
        "name": "Vena Energy Aura Private Limited",
        "bidMw": 124.0,
        "mw": 124.0,
        "tariff": 3.69
      },
      {
        "name": "Refex Holding Private Limited",
        "bidMw": 600.0,
        "mw": 196.0,
        "tariff": 3.69
      }
    ],
    "others": [
      {
        "name": "Torrent Green Energy Private Limited",
        "bidMw": 300.0,
        "tariff": 3.7
      },
      {
        "name": "Wyn Renewables Project 6 Private Limited",
        "bidMw": 130.0,
        "tariff": 4.14
      },
      {
        "name": "Gentari Renewables India Castor One Private Limited",
        "bidMw": 200.0,
        "tariff": 4.15
      },
      {
        "name": "ABC Cleantech Private Limited",
        "bidMw": 250.0,
        "tariff": 4.16
      },
      {
        "name": "Ijya Four Renewables Private Limited",
        "bidMw": 120.0,
        "tariff": 4.19
      },
      {
        "name": "Jindal India Power Limited",
        "bidMw": 300.0,
        "tariff": 4.34
      },
      {
        "name": "Prozeal Green Energy Limited",
        "bidMw": 50.0,
        "tariff": 4.55
      },
      {
        "name": "Solarcraft Power India 7 Private Limited",
        "bidMw": 50.0,
        "tariff": 4.6
      }
    ],
    "note": "Refex Holding bid 600 MW and was awarded 196 MW.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_Wind-_1200_MW_(Tranche-XIX)_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/YmB1"
      }
    ]
  },
  {
    "id": "seci-fdre-vii",
    "agency": "SECI",
    "product": "FDRE peak power",
    "tender": "Assured peak supply, 4800 MWh (1200 MW × 4 h) (SECI-FDRE-VII)",
    "rfsNo": "SECI/C&P/IPP/13/0012/25-26",
    "rfsDate": "2025-09-30",
    "auctionDate": "2026-02-05",
    "loaDate": "2026-02-10",
    "tenderedMw": 1200,
    "storageMwh": 4800,
    "awardedMw": 1200.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "Adyant Enersol Private Limited",
        "bidMw": 100.0,
        "mw": 100.0,
        "tariff": 6.27
      },
      {
        "name": "Serentica Renewables India Private Limited",
        "bidMw": 600.0,
        "mw": 600.0,
        "tariff": 6.28
      },
      {
        "name": "AMPIN Energy Utility Nine Private Limited",
        "bidMw": 199.0,
        "mw": 199.0,
        "tariff": 6.28
      },
      {
        "name": "ACME Solar Holdings Limited",
        "bidMw": 600.0,
        "mw": 301.0,
        "tariff": 6.28
      }
    ],
    "others": [
      {
        "name": "Onward Solar Power Private Limited",
        "bidMw": 96.0,
        "tariff": 6.29
      },
      {
        "name": "Engie Energy India Private Limited",
        "bidMw": 150.0,
        "tariff": 6.31
      },
      {
        "name": "Shiva Corporation (India) Limited",
        "bidMw": 100.0,
        "tariff": 6.34
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 300.0,
        "tariff": 6.39
      },
      {
        "name": "Jakson Green Limited",
        "bidMw": 600.0,
        "tariff": 6.54
      },
      {
        "name": "Apraava Energy Private Limited",
        "bidMw": 200.0,
        "tariff": 6.56
      },
      {
        "name": "MB Power (Madhya Pradesh) Limited",
        "bidMw": 150.0,
        "tariff": 6.62
      },
      {
        "name": "NTPC Renewable Energy Limited",
        "bidMw": 300.0,
        "tariff": 6.66
      },
      {
        "name": "Twishi Renewable (Nine) Private Limited",
        "bidMw": 150.0,
        "tariff": 6.7
      },
      {
        "name": "Chinta Green Energy Private Limited",
        "bidMw": 200.0,
        "tariff": 6.71
      },
      {
        "name": "Hexa Climate Solutions Private Limited",
        "bidMw": 250.0,
        "tariff": 6.76
      },
      {
        "name": "Rays Power Infra Limited",
        "bidMw": 300.0,
        "tariff": 6.95
      },
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 600.0,
        "tariff": 7.47
      },
      {
        "name": "ReNew Solar Power Private Limited",
        "bidMw": 300.0,
        "tariff": 7.89
      },
      {
        "name": "Solarcraft Power India 8 Private Limited",
        "bidMw": 150.0,
        "tariff": 7.9
      },
      {
        "name": "Avaada Energy Private Limited",
        "bidMw": 200.0,
        "tariff": 7.97
      }
    ],
    "note": "A peak-power product: 4 hours of assured supply a day, not 24-hour supply.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_FDRE-VII-_4800_MWh_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/YmB2"
      }
    ]
  },
  {
    "id": "seci-ists-xxi",
    "agency": "SECI",
    "product": "Solar + ESS",
    "tender": "1200 MW ISTS solar with 600 MW / 3600 MWh ESS (SECI-ISTS-XXI)",
    "rfsNo": "SECI/C&P/IPP/11/0006/25-26",
    "rfsDate": "2025-06-19",
    "auctionDate": "2026-01-09",
    "loaDate": "2026-01-29",
    "tenderedMw": 1200,
    "storageMwh": 3600,
    "awardedMw": 1200.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "Engie Energy India Private Limited",
        "bidMw": 200.0,
        "mw": 200.0,
        "tariff": 3.12
      },
      {
        "name": "NLC India Renewables Limited",
        "bidMw": 600.0,
        "mw": 600.0,
        "tariff": 3.12
      },
      {
        "name": "RPIL Power Three Private Limited",
        "bidMw": 300.0,
        "mw": 300.0,
        "tariff": 3.13
      },
      {
        "name": "Oriana Power Limited",
        "bidMw": 300.0,
        "mw": 100.0,
        "tariff": 3.13
      }
    ],
    "others": [
      {
        "name": "Welspun Renewable Energy Private Limited",
        "bidMw": 200.0,
        "tariff": 3.16
      },
      {
        "name": "Apraava Energy Private Limited",
        "bidMw": 200.0,
        "tariff": 3.18
      },
      {
        "name": "Chinta Green Energy Private Limited",
        "bidMw": 600.0,
        "tariff": 3.29
      },
      {
        "name": "Ayana Renewable Power Private Limited",
        "bidMw": 200.0,
        "tariff": 3.3
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 300.0,
        "tariff": 3.43
      },
      {
        "name": "Solar91 Cleantech Limited",
        "bidMw": 50.0,
        "tariff": 3.44
      },
      {
        "name": "Solarcraft Power India 8 Private Limited",
        "bidMw": 150.0,
        "tariff": 3.75
      },
      {
        "name": "ReNew Private Limited",
        "bidMw": 300.0,
        "tariff": 3.8
      },
      {
        "name": "ACME Solar Holdings Limited",
        "bidMw": 600.0,
        "tariff": 3.9
      },
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 250.0,
        "tariff": 3.96
      },
      {
        "name": "Serentica Renewables India Private Limited",
        "bidMw": 300.0,
        "tariff": 3.98
      },
      {
        "name": "Sprng Energy Private Limited",
        "bidMw": 200.0,
        "tariff": 3.99
      },
      {
        "name": "MB Power (Madhya Pradesh) Limited",
        "bidMw": 150.0,
        "tariff": 3.99
      },
      {
        "name": "Hexa Climate Solutions Private Limited",
        "bidMw": 100.0,
        "tariff": 3.99
      },
      {
        "name": "Vishvaraj Renewables Private Limited",
        "bidMw": 300.0,
        "tariff": 4.01
      },
      {
        "name": "Hero Solar Energy Private Limited",
        "bidMw": 150.0,
        "tariff": 4.17
      },
      {
        "name": "Greenko Energies Private Limited",
        "bidMw": 500.0,
        "tariff": 4.35
      },
      {
        "name": "LC Infra Projects Private Limited",
        "bidMw": 50.0,
        "tariff": 4.95
      },
      {
        "name": "Sangamam Power Projects Private Limited",
        "bidMw": 60.0,
        "tariff": 5.0
      }
    ],
    "note": "Oriana Power bid 300 MW and was awarded 100 MW.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_Solar_1200_MW_with_ESS_(ISTS-XXI)_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/YmJz"
      }
    ]
  },
  {
    "id": "seci-ists-xx",
    "agency": "SECI",
    "product": "Solar + ESS",
    "tender": "2000 MW ISTS solar with 1000 MW / 4000 MWh ESS (SECI-ISTS-XX)",
    "rfsNo": "SECI/C&P/IPP/11/0004/25-26",
    "rfsDate": "2025-06-12",
    "auctionDate": "2025-10-15",
    "loaDate": "2025-10-27",
    "tenderedMw": 2000,
    "storageMwh": 4000,
    "awardedMw": 2000.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "Welspun Renewable Energy Private Limited",
        "bidMw": 200.0,
        "mw": 200.0,
        "tariff": 2.86
      },
      {
        "name": "MB Power (Madhya Pradesh) Limited",
        "bidMw": 150.0,
        "mw": 150.0,
        "tariff": 2.86
      },
      {
        "name": "Shivalaya Construction Limited",
        "bidMw": 600.0,
        "mw": 600.0,
        "tariff": 2.86
      },
      {
        "name": "Oswal Cables Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 2.86
      },
      {
        "name": "Purvah Green Power Private Limited",
        "bidMw": 300.0,
        "mw": 300.0,
        "tariff": 2.86
      },
      {
        "name": "Banyan Insolation Private Limited",
        "bidMw": 100.0,
        "mw": 100.0,
        "tariff": 2.86
      },
      {
        "name": "LC Infra Projects Private Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 2.86
      },
      {
        "name": "Stockwell Solar Services Private Limited",
        "bidMw": 80.0,
        "mw": 80.0,
        "tariff": 2.86
      },
      {
        "name": "SAEL Industries Limited",
        "bidMw": 300.0,
        "mw": 300.0,
        "tariff": 2.87
      },
      {
        "name": "GH2 Solar Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 2.87
      },
      {
        "name": "Navayuga Green Energy Private Limited",
        "bidMw": 300.0,
        "mw": 120.0,
        "tariff": 2.87
      }
    ],
    "others": [
      {
        "name": "Apraava Energy Private Limited",
        "bidMw": 400.0,
        "tariff": 2.87
      },
      {
        "name": "Solarcraft Power India 8 Private Limited",
        "bidMw": 150.0,
        "tariff": 2.89
      },
      {
        "name": "NTPC Renewable Energy Limited",
        "bidMw": 500.0,
        "tariff": 3.06
      },
      {
        "name": "Gentari Renewables India Pte. Ltd.",
        "bidMw": 200.0,
        "tariff": 3.12
      },
      {
        "name": "Waaree Forever Energies Private Limited",
        "bidMw": 700.0,
        "tariff": 3.15
      },
      {
        "name": "Bhalki Prime Solar Power Private Limited",
        "bidMw": 300.0,
        "tariff": 3.23
      },
      {
        "name": "Pace Digitek Limited",
        "bidMw": 100.0,
        "tariff": 3.25
      },
      {
        "name": "Sunsure Solar Park RJ One Private Limited",
        "bidMw": 120.0,
        "tariff": 3.31
      },
      {
        "name": "ReNew Solar Power Private Limited",
        "bidMw": 300.0,
        "tariff": 3.51
      },
      {
        "name": "ACME Solar Holdings Limited",
        "bidMw": 600.0,
        "tariff": 3.56
      },
      {
        "name": "Refex Holding Private Limited",
        "bidMw": 100.0,
        "tariff": 3.59
      },
      {
        "name": "PNC Infratech Limited",
        "bidMw": 300.0,
        "tariff": 3.9
      },
      {
        "name": "Adani Renewable Energy Holding Nine Limited",
        "bidMw": 1000.0,
        "tariff": 3.98
      },
      {
        "name": "Power Mech Projects Limited",
        "bidMw": 50.0,
        "tariff": 4.04
      }
    ],
    "note": "Navayuga Green Energy bid 300 MW and was awarded 120 MW.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_Solar_2000_MW_with_ESS_(ISTS-XX)_result_website_upload2.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/YmJ1"
      }
    ]
  },
  {
    "id": "seci-rtc-iv",
    "agency": "SECI",
    "product": "RTC (round-the-clock RE)",
    "tender": "1200 MW RTC power from ISTS-connected RE projects (SECI-RTC-IV)",
    "rfsNo": "SECI/C&P/IPP/13/0019/24-25",
    "rfsDate": "2024-10-28",
    "auctionDate": "2025-05-26",
    "loaDate": "2025-06-11",
    "tenderedMw": 1200,
    "storageMwh": null,
    "awardedMw": 420.0,
    "tariffUnit": "₹/kWh",
    "winners": [
      {
        "name": "Hero Solar Energy Private Limited",
        "bidMw": 120.0,
        "mw": 120.0,
        "tariff": 5.06
      },
      {
        "name": "Hexa Climate Solutions Private Limited",
        "bidMw": 100.0,
        "mw": 100.0,
        "tariff": 5.06
      },
      {
        "name": "Sembcorp Green Infra Private Limited",
        "bidMw": 50.0,
        "mw": 50.0,
        "tariff": 5.07
      },
      {
        "name": "Jindal India Power Limited",
        "bidMw": 150.0,
        "mw": 150.0,
        "tariff": 5.07
      }
    ],
    "others": [
      {
        "name": "ABC Cleantech Private Limited",
        "bidMw": 120.0,
        "tariff": 5.08
      }
    ],
    "note": "Capacity eligible for award was 432 MW; 420 MW awarded.",
    "official": true,
    "sources": [
      {
        "label": "SECI result notice (PDF)",
        "url": "https://www.seci.co.in/uploads/tenders/bidders/SECI_RTC-IV-_1200_MW_result_website_upload.pdf"
      },
      {
        "label": "SECI tender page",
        "url": "https://www.seci.co.in/tender-details/YWVx"
      }
    ]
  }
];

export const SECI_SITE = "https://www.seci.co.in/tenders/results";
export const TRADING_MARGIN_NOTE = "Discovered tariffs, as SECI's result notices give them. SECI sells on to the buying utilities at the tariff plus its trading margin.";

/** The lowest and highest tariff awarded in a result. */
export function tariffRange(r) {
  const t = r.winners.map((w) => w.tariff).filter((v) => typeof v === "number");
  return t.length ? [Math.min(...t), Math.max(...t)] : [null, null];
}

/** Capacity-weighted average tariff of the capacity awarded. */
export function weightedTariff(r) {
  const known = r.winners.filter((w) => typeof w.mw === "number" && w.mw > 0 && typeof w.tariff === "number");
  const mw = known.reduce((a, w) => a + w.mw, 0);
  return mw > 0 ? known.reduce((a, w) => a + w.mw * w.tariff, 0) / mw : null;
}

/** The latest result of a product. */
export function latest(product) {
  return SECI_RESULTS.filter((r) => r.product === product).sort((a, b) => String(b.auctionDate).localeCompare(String(a.auctionDate)))[0] || null;
}
