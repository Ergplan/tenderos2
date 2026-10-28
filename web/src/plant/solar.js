// Solar plant studio: a grid-scale plant laid out from its AC capacity, DC:AC, module, structure and
// inverter type, and its cost built up component by component in ₹/Wp. Plain JavaScript, used in
// Node by tools/check_plant.mjs.
//
// Every default here is an indicative 2025–26 Indian market figure for a utility-scale ISTS plant,
// for the bidder to replace with quotes; none comes from a tender. Units: ₹/Wp per watt of DC
// (module) capacity, ₹/Wac per watt of AC (inverter) capacity, ₹ crore = 10^7 ₹, 1 ₹/W = ₹10 cr/MW.

export const PLANT_NOTE = "Indicative 2025–26 market figure, not from the tender: replace it with your quotes.";

/** Modules: typical datasheet values for each class (check the chosen make's datasheet). */
export const MODULES = [
  { id: "topcon580", name: "TOPCon bifacial 580 Wp (144 half-cells, 182 mm)", wp: 580, voc: 51.9, vmp: 43.4, isc: 14.1, tcVoc: -0.0025, lengthM: 2.278, widthM: 1.134, bifaciality: 0.8 },
  { id: "topcon620", name: "TOPCon bifacial 620 Wp (132 half-cells, 210R)", wp: 620, voc: 48.6, vmp: 40.6, isc: 16.1, tcVoc: -0.0025, lengthM: 2.382, widthM: 1.134, bifaciality: 0.8 },
  { id: "topcon700", name: "TOPCon bifacial 700 Wp (132 half-cells, 210 mm)", wp: 700, voc: 47.5, vmp: 39.9, isc: 18.6, tcVoc: -0.0025, lengthM: 2.384, widthM: 1.303, bifaciality: 0.8 },
  { id: "perc545", name: "Mono PERC bifacial 545 Wp (144 half-cells, 182 mm)", wp: 545, voc: 49.7, vmp: 41.8, isc: 13.9, tcVoc: -0.0028, lengthM: 2.279, widthM: 1.134, bifaciality: 0.7 },
];

/** Structures: how modules are mounted, with their land, energy gain and cost. */
export const STRUCTURES = [
  { id: "fixed", name: "Fixed tilt, 2 modules in portrait (2P)", portrait: 2, stringsPerTable: 2, gcr: 0.42, tiltDeg: 18, yieldGain: 0, costPerWp: 2.1, civilPerWp: 1.3 },
  { id: "sat", name: "Single-axis tracker, 1 module in portrait (1P)", portrait: 1, stringsPerTable: 3, gcr: 0.35, tiltDeg: 0, yieldGain: 0.15, costPerWp: 3.4, civilPerWp: 1.5 },
];

/**
 * Inverter types. String: many ~320 kW inverters near the arrays, LV AC cables to an inverter-duty
 * transformer (IDT) per block. Central: an inverter station (inverter + MV transformer + RMU on one
 * skid) per block, fed by DC combiner boxes.
 */
export const INVERTERS = [
  {
    id: "string", name: "String inverters (≈320 kWac, 1500 V)", unitMw: 0.32, blockMw: 6.4,
    priceWac: 2.4, idtWac: 1.1, lvAcWac: 0.55, dcCablePerWp: 0.75, euroEff: 0.985, availability: 0.995, omLakhPerMw: 0.5,
    notes: "Many small units: a failure costs little energy and a spare is easy to keep; more AC cabling and an IDT per block.",
  },
  {
    id: "central", name: "Central inverter station (≈4.4 MWac skid with MV transformer)", unitMw: 4.4, blockMw: 4.4,
    priceWac: 3.2, idtWac: 0, lvAcWac: 0, dcCablePerWp: 1.0, euroEff: 0.984, availability: 0.99, omLakhPerMw: 0.4,
    notes: "Few large units with the MV transformer on the skid: lower price per MW of station equipment, more DC cabling and combiner boxes; a failure takes a whole block out.",
  },
];

/** The default studio inputs. */
export function defaultSolarStudio() {
  return {
    acMw: 300,
    dcAc: 1.4,
    module: "topcon620",
    structure: "fixed",
    inverter: "string",
    minTempC: 5,
    systemV: 1500,
    landAcresPerMwp: null, // null: worked out from the layout
    landLakhPerAcre: 6,
    cleaningRobots: false,
    price: {
      modulePerWp: 14.5, // TOPCon, ALMM-listed, non-DCR
      structurePerWp: null, // null: the structure's own figure
      dcCablePerWp: null,
      inverterPerWac: null,
      lvAcPerWac: null,
      idtPerWac: null,
      mvCablePerWac: 0.45,
      switchgearPerWac: 0.6,
      scadaPerWp: 0.25,
      earthingPerWp: 0.2,
      cleaningPerWp: 0.35,
      civilPerWp: null,
      buildingsPerWp: 0.15,
      installPerWp: 0.9,
      transportPerWp: 0.3,
      engineeringPerWp: 0.3,
    },
    epcMarginPct: 0.06,
    contingencyPct: 0.03,
    equipmentShare: 0.7, // of the EPC price, for GST
    gstEquipmentPct: 0.05,
    gstServicesPct: 0.18,
  };
}

const byId = (list, id) => list.find((x) => x.id === id) || list[0];

/** The plant laid out: strings, tables or trackers, inverters, blocks, land. */
export function solarDesign(input) {
  const s = { ...defaultSolarStudio(), ...input };
  const mod = byId(MODULES, s.module);
  const st = byId(STRUCTURES, s.structure);
  const inv = byId(INVERTERS, s.inverter);
  // the string's open-circuit voltage on the coldest morning must stay under the system voltage
  const vocCold = mod.voc * (1 + mod.tcVoc * (s.minTempC - 25));
  const modulesPerString = Math.max(1, Math.floor(s.systemV / vocCold));
  const dcTargetMw = s.acMw * s.dcAc;
  const strings = Math.ceil((dcTargetMw * 1e6) / (mod.wp * modulesPerString));
  const modules = strings * modulesPerString;
  const dcMw = (modules * mod.wp) / 1e6;
  const tables = Math.ceil(strings / st.stringsPerTable);
  const inverters = Math.ceil(s.acMw / inv.unitMw - 1e-9);
  const blocks = Math.ceil(s.acMw / inv.blockMw - 1e-9);
  const idts = inv.idtWac > 0 ? blocks : 0;
  const stringsPerInverter = strings / inverters;
  // land: module area ÷ ground cover ratio, plus roads, blocks and setbacks (25%)
  const moduleArea = mod.lengthM * mod.widthM;
  const tilt = (st.tiltDeg * Math.PI) / 180;
  const arrayM2 = (modules * moduleArea * Math.cos(tilt)) / st.gcr;
  const totalM2 = arrayM2 * 1.25;
  const acres = s.landAcresPerMwp ? s.landAcresPerMwp * dcMw : totalM2 / 4046.86;
  // a table or tracker row: modules along the row
  const modulesPerTable = st.stringsPerTable * modulesPerString;
  const rowLengthM = (modulesPerTable / st.portrait) * (mod.widthM + 0.02);
  const rowDepthM = st.portrait * mod.lengthM * Math.cos(tilt);
  const pitchM = rowDepthM / st.gcr;
  return {
    module: mod, structure: st, inverter: inv,
    vocCold, modulesPerString, strings, modules, dcMw, dcAc: dcMw / s.acMw, tables, modulesPerTable, inverters, blocks, idts,
    stringsPerInverter, acres, acresPerMwp: acres / dcMw, arrayM2, totalM2, rowLengthM, rowDepthM, pitchM,
    stringVoc: vocCold * modulesPerString,
  };
}

/** One cost line: label, basis (Wp or Wac), price, quantity, ₹ crore and ₹/Wp. */
function line(group, key, label, basis, price, design, note) {
  const watts = basis === "Wac" ? design.dcMw / design.dcAc * 1e6 : design.dcMw * 1e6;
  const cr = (price * watts) / 1e7;
  return { group, key, label, basis, price, cr, perWp: (cr * 1e7) / (design.dcMw * 1e6), note };
}

/**
 * The cost built up line by line for one design. Returns the lines, the subtotals, ₹/Wp, ₹ cr/MWp
 * and ₹ cr/MWac (what the bid's solar capex field takes).
 */
export function solarCost(input, design = solarDesign(input)) {
  const s = { ...defaultSolarStudio(), ...input, price: { ...defaultSolarStudio().price, ...(input?.price || {}) } };
  const p = s.price;
  const { structure: st, inverter: inv } = design;
  const or = (v, d) => (v === null || v === undefined || v === "" ? d : Number(v));
  const lines = [
    line("Equipment", "module", `PV modules (${design.module.wp} Wp)`, "Wp", p.modulePerWp, design, `${design.modules.toLocaleString("en-IN")} modules`),
    line("Equipment", "structure", `Mounting: ${st.id === "sat" ? "single-axis trackers" : "fixed-tilt tables"}`, "Wp", or(p.structurePerWp, st.costPerWp), design, `${design.tables.toLocaleString("en-IN")} ${st.id === "sat" ? "trackers" : "tables"}`),
    line("Equipment", "dcCable", inv.id === "central" ? "DC cables, connectors and string combiner boxes" : "DC cables and connectors", "Wp", or(p.dcCablePerWp, inv.dcCablePerWp), design, `${design.strings.toLocaleString("en-IN")} strings of ${design.modulesPerString}`),
    line("Equipment", "inverter", inv.id === "central" ? "Inverter stations (inverter, MV transformer, RMU)" : "String inverters", "Wac", or(p.inverterPerWac, inv.priceWac), design, `${design.inverters} × ${inv.unitMw} MW`),
    ...(inv.id === "string" ? [
      line("Equipment", "lvAc", "LV AC cables and AC combiner panels", "Wac", or(p.lvAcPerWac, inv.lvAcWac), design, `${design.inverters} inverters to ${design.blocks} IDTs`),
      line("Equipment", "idt", "Inverter-duty transformers and RMUs", "Wac", or(p.idtPerWac, inv.idtWac), design, `${design.idts} × ${inv.blockMw} MVA`),
    ] : []),
    line("Equipment", "mvCable", "33 kV collection cables", "Wac", p.mvCablePerWac, design, `${design.blocks} blocks`),
    line("Equipment", "switchgear", "33 kV switchgear and plant substation", "Wac", p.switchgearPerWac, design),
    line("Equipment", "scada", "SCADA, communication, weather stations, CCTV", "Wp", p.scadaPerWp, design),
    line("Equipment", "earthing", "Earthing and lightning protection", "Wp", p.earthingPerWp, design),
    ...(s.cleaningRobots ? [line("Equipment", "cleaning", "Robotic module cleaning", "Wp", p.cleaningPerWp, design)] : []),
    line("Services", "civil", st.id === "sat" ? "Civil: piling, foundations, roads, drainage, fencing (tracker)" : "Civil: piling, foundations, roads, drainage, fencing", "Wp", or(p.civilPerWp, st.civilPerWp), design),
    line("Services", "buildings", "Control room, stores and buildings", "Wp", p.buildingsPerWp, design),
    line("Services", "install", "Installation, testing and commissioning", "Wp", p.installPerWp, design),
    line("Services", "transport", "Transport and transit insurance", "Wp", p.transportPerWp, design),
    line("Services", "engineering", "Design, engineering and project management", "Wp", p.engineeringPerWp, design),
  ];
  const sum = (g) => lines.filter((l) => !g || l.group === g).reduce((a, l) => a + l.cr, 0);
  const equipment = sum("Equipment");
  const services = sum("Services");
  const base = equipment + services;
  const margin = base * s.epcMarginPct;
  const contingency = (base + margin) * s.contingencyPct;
  const epc = base + margin + contingency;
  const gstRate = s.equipmentShare * s.gstEquipmentPct + (1 - s.equipmentShare) * s.gstServicesPct;
  const gst = epc * gstRate;
  const landCr = (design.acres * s.landLakhPerAcre) / 100;
  const total = epc + gst + landCr;
  const watts = design.dcMw * 1e6;
  const perWp = (cr) => (cr * 1e7) / watts;
  const extras = [
    { group: "Margins and taxes", key: "margin", label: `EPC margin (${(s.epcMarginPct * 100).toFixed(1)}%)`, cr: margin, perWp: perWp(margin) },
    { group: "Margins and taxes", key: "contingency", label: `Contingency (${(s.contingencyPct * 100).toFixed(1)}%)`, cr: contingency, perWp: perWp(contingency) },
    { group: "Margins and taxes", key: "gst", label: `GST (effective ${(gstRate * 100).toFixed(1)}%)`, cr: gst, perWp: perWp(gst), note: `${(s.equipmentShare * 100).toFixed(0)}% equipment at ${(s.gstEquipmentPct * 100).toFixed(0)}%, the rest services at ${(s.gstServicesPct * 100).toFixed(0)}%` },
    { group: "Land", key: "land", label: `Land (${design.acres.toFixed(0)} acres at ₹${s.landLakhPerAcre} lakh/acre)`, cr: landCr, perWp: perWp(landCr), note: `${design.acresPerMwp.toFixed(2)} acres/MWp` },
  ];
  return {
    lines: [...lines, ...extras],
    equipment, services, margin, contingency, epc, gst, gstRate, land: landCr, total,
    perWp: perWp(total),
    crPerMwp: total / design.dcMw,
    crPerMwac: total / (design.dcMw / design.dcAc),
    design,
  };
}

/** Both inverter types side by side for the same plant: cost, efficiency, availability. */
export function inverterComparison(input) {
  return INVERTERS.map((inv) => {
    const st = { ...input, inverter: inv.id, price: { ...(input?.price || {}), inverterPerWac: null, lvAcPerWac: null, idtPerWac: null, dcCablePerWp: null } };
    const design = solarDesign(st);
    const cost = solarCost(st, design);
    return { inverter: inv, design, cost, energyFactor: inv.euroEff * inv.availability };
  });
}

/** The AC CUF the structure gives for a fixed-tilt CUF (a rule-of-thumb tracker gain). */
export function cufWithStructure(fixedCuf, structureId) {
  return fixedCuf * (1 + byId(STRUCTURES, structureId).yieldGain);
}
