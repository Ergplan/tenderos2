// Wind farm studio: turbines by make and size, each turbine's power curve and its capacity factor
// at the site's wind, the number of turbines and land for the farm, and the farm's cost built up
// line by line. Plain JavaScript, used in Node by tools/check_plant.mjs.
//
// The catalogue gives each model's rated power and rotor from public product announcements; hub
// heights are the common offer for India. The power curves are generic (a rotor-limited curve at
// the rated power), not the makers' certified curves: use the certified curve for a bid.

export const WIND_NOTE = "Indicative: generic power curves from rated power and rotor, 2025–26 market cost figures. Use the maker's certified power curve and quotes for a bid.";

export const TURBINES = [
  { id: "vestas-v155-3.3", make: "Vestas", model: "V155-3.3 MW", mw: 3.3, rotorM: 155, hubM: 140, iec: "S", cutIn: 3, cutOut: 22.5 },
  { id: "vestas-v150-4.2", make: "Vestas", model: "V150-4.2 MW", mw: 4.2, rotorM: 150, hubM: 125, iec: "IIIB", cutIn: 3, cutOut: 22.5 },
  { id: "ge-2.7-132", make: "GE Vernova", model: "2.7-132", mw: 2.7, rotorM: 132, hubM: 120, iec: "IIIS", cutIn: 3, cutOut: 22 },
  { id: "ge-3.6-154", make: "GE Vernova", model: "3.6-154", mw: 3.6, rotorM: 154, hubM: 130, iec: "S", cutIn: 3, cutOut: 22 },
  { id: "suzlon-s144", make: "Suzlon", model: "S144 (3.15 MW)", mw: 3.15, rotorM: 144, hubM: 140, iec: "S", cutIn: 3, cutOut: 22 },
  { id: "suzlon-s133", make: "Suzlon", model: "S133 (2.6 MW)", mw: 2.6, rotorM: 133, hubM: 120, iec: "IIIA", cutIn: 3, cutOut: 22 },
  { id: "sg-3.4-145", make: "Siemens Gamesa", model: "SG 3.4-145", mw: 3.4, rotorM: 145, hubM: 127, iec: "IIIA", cutIn: 3, cutOut: 22 },
  { id: "envision-en156", make: "Envision", model: "EN-156/3.3", mw: 3.3, rotorM: 156, hubM: 140, iec: "S", cutIn: 2.5, cutOut: 20 },
  { id: "inox-3.3", make: "Inox Wind", model: "IWL 3.3 MW (145 m rotor)", mw: 3.3, rotorM: 145, hubM: 120, iec: "S", cutIn: 3, cutOut: 22 },
  { id: "adani-5.2-160", make: "Adani Wind", model: "AW 5.2-160", mw: 5.2, rotorM: 160, hubM: 120, iec: "S", cutIn: 3, cutOut: 22 },
];

export function defaultWindStudio() {
  return {
    farmMw: 300,
    turbine: "suzlon-s144",
    hubM: null, // null: the turbine's usual hub height
    meanWindMs: 6.2, // at the measurement height
    measuredAtM: 120,
    weibullK: 2.1,
    shear: 0.2,
    airDensity: 1.15, // kg/m³, Indian sites inland
    losses: { availability: 0.97, wake: 0.07, electrical: 0.025, other: 0.02 },
    spacingRotors: { across: 4, along: 7 },
    landAcresPerTurbine: 3, // land bought for the foundation, crane pad and access; the farm area is shared
    price: {
      wtgCrPerMw: 4.3, // turbine, tower and transport to site
      foundationCrPerMw: 0.45,
      erectionCrPerMw: 0.3,
      roadsCrPerMw: 0.12,
      mvLinesCrPerMw: 0.38, // 33 kV lines to the pooling station
      substationCrPerMw: 0.28,
      engineeringCrPerMw: 0.08,
      landLakhPerAcre: 8,
    },
    contingencyPct: 0.03,
    equipmentShare: 0.75,
    gstEquipmentPct: 0.05,
    gstServicesPct: 0.18,
  };
}

const byId = (id) => TURBINES.find((t) => t.id === id) || TURBINES[0];

/**
 * A generic power curve: rotor-limited below rated (Cp falling from 0.47 near cut-in to 0.36 near
 * rated, a smooth knee), rated power up to cut-out. Returns kW at each 0.5 m/s from 0 to 25 m/s.
 */
export function powerCurve(t, rho = 1.15) {
  const area = (Math.PI * t.rotorM ** 2) / 4;
  const out = [];
  for (let v = 0; v <= 25.0001; v += 0.5) {
    let kw = 0;
    if (v >= t.cutIn && v <= t.cutOut) {
      const cp = 0.47 - 0.011 * Math.max(0, v - 6);
      const aero = (0.5 * rho * area * v ** 3 * cp * 0.94) / 1000;
      // soft knee: no power curve reaches rated with a corner
      const r = t.mw * 1000;
      kw = Math.min(r, (aero * r) / (aero ** 6 + r ** 6) ** (1 / 6) * (1 + 1e-9));
    }
    out.push([Number(v.toFixed(1)), kw]);
  }
  return out;
}

const gammaLn = (z) => {
  // Lanczos approximation
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - gammaLn(1 - z);
  let x = c[0];
  const zz = z - 1;
  for (let i = 1; i < g + 2; i += 1) x += c[i] / (zz + i);
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
};

/** Mean wind at hub height (power-law shear) and the turbine's capacity factor there. */
export function turbineYield(input, turbineId) {
  const s = { ...defaultWindStudio(), ...input, losses: { ...defaultWindStudio().losses, ...(input?.losses || {}) } };
  const t = byId(turbineId || s.turbine);
  const hub = turbineId ? t.hubM : s.hubM || t.hubM;
  const vHub = s.meanWindMs * (hub / s.measuredAtM) ** s.shear;
  const k = s.weibullK;
  const c = vHub / Math.exp(gammaLn(1 + 1 / k));
  const curve = powerCurve(t, s.airDensity);
  // expected power: the curve integrated over the Weibull distribution (0.5 m/s bins)
  let kw = 0;
  for (const [v, p] of curve) {
    const lo = Math.max(0, v - 0.25);
    const hi = v + 0.25;
    const prob = Math.exp(-((lo / c) ** k)) - Math.exp(-((hi / c) ** k));
    kw += p * prob;
  }
  const grossCf = kw / (t.mw * 1000);
  const L = s.losses;
  const netFactor = L.availability * (1 - L.wake) * (1 - L.electrical) * (1 - L.other);
  const area = (Math.PI * t.rotorM ** 2) / 4;
  return {
    turbine: t, hub, vHub, weibullC: c, curve, grossCf, netCf: grossCf * netFactor, netFactor,
    specificPower: (t.mw * 1e6) / area, aepMwh: grossCf * netFactor * t.mw * 8760,
  };
}

/** The farm: turbines, land, layout spacing, energy. */
export function windFarm(input) {
  const s = { ...defaultWindStudio(), ...input };
  const y = turbineYield(s);
  const t = y.turbine;
  const count = Math.ceil(s.farmMw / t.mw - 1e-9);
  const mw = count * t.mw;
  const D = t.rotorM;
  const spacingM2 = s.spacingRotors.across * D * s.spacingRotors.along * D;
  const footprintKm2 = (count * spacingM2) / 1e6;
  return { ...y, count, mw, footprintKm2, landAcres: count * s.landAcresPerTurbine, energyMu: (y.netCf * mw * 8760) / 1000 };
}

/** The farm's cost built up line by line, ₹ crore and ₹ cr/MW. */
export function windCost(input, farm = windFarm(input)) {
  const s = { ...defaultWindStudio(), ...input, price: { ...defaultWindStudio().price, ...(input?.price || {}) } };
  const p = s.price;
  const mw = farm.mw;
  const ln = (group, key, label, perMw, note) => ({ group, key, label, price: perMw, unit: "₹ cr/MW", cr: perMw * mw, perMw, note });
  const lines = [
    ln("Equipment", "wtg", `Turbines: ${farm.count} × ${farm.turbine.make} ${farm.turbine.model}, with towers`, p.wtgCrPerMw, `${farm.hub} m hub`),
    ln("Equipment", "mvLines", "33 kV lines to the pooling station", p.mvLinesCrPerMw),
    ln("Equipment", "substation", "Pooling substation (33/220 kV) share", p.substationCrPerMw),
    ln("Services", "foundation", "Foundations and crane pads", p.foundationCrPerMw, `${farm.count} foundations`),
    ln("Services", "erection", "Erection, transport and commissioning", p.erectionCrPerMw),
    ln("Services", "roads", "Access roads and site works", p.roadsCrPerMw),
    ln("Services", "engineering", "Micro-siting, wind study, engineering", p.engineeringCrPerMw),
  ];
  const base = lines.reduce((a, l) => a + l.cr, 0);
  const contingency = base * s.contingencyPct;
  const gstRate = s.equipmentShare * s.gstEquipmentPct + (1 - s.equipmentShare) * s.gstServicesPct;
  const gst = (base + contingency) * gstRate;
  const land = (farm.landAcres * p.landLakhPerAcre) / 100;
  const extras = [
    { group: "Margins and taxes", key: "contingency", label: `Contingency (${(s.contingencyPct * 100).toFixed(1)}%)`, cr: contingency, perMw: contingency / mw },
    { group: "Margins and taxes", key: "gst", label: `GST (effective ${(gstRate * 100).toFixed(1)}%)`, cr: gst, perMw: gst / mw, note: `${(s.equipmentShare * 100).toFixed(0)}% equipment at ${(s.gstEquipmentPct * 100).toFixed(0)}%, the rest at ${(s.gstServicesPct * 100).toFixed(0)}%` },
    { group: "Land", key: "land", label: `Land (${farm.landAcres} acres at ₹${p.landLakhPerAcre} lakh/acre)`, cr: land, perMw: land / mw },
  ];
  const total = base + contingency + gst + land;
  return { lines: [...lines, ...extras], base, contingency, gst, gstRate, land, total, crPerMw: total / mw, farm };
}

/** Every turbine at the same site, for the comparison table. */
export function turbineComparison(input) {
  return TURBINES.map((t) => ({ ...turbineYield(input, t.id), count: Math.ceil(((input?.farmMw) || defaultWindStudio().farmMw) / t.mw - 1e-9) }));
}
