/**
 * test-catchment.js
 *
 * Exercises catchment.js against the real stores_bangalore.json using a
 * synthetic population hex grid (stand-in for Kontur until you wire that in).
 * Prints per-operator capture, cannibalization under both modes, and a
 * sample marginal-impact for a candidate store.
 */

const fs = require("fs");
const path = require("path");
const {
  computeCatchment,
  marginalImpact,
} = require("./catchment");

const { stores } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "stores_bangalore.json"), "utf8")
);

// ---- Synthetic hex grid over Bangalore (replace with Kontur hexes) ----------
// ~0.5km spacing across the city bbox, population biased toward the center.
function buildSyntheticHexes() {
  const bbox = { s: 12.8, w: 77.45, n: 13.15, e: 77.78 };
  const step = 0.0075; // ~0.8km
  const cLat = 12.96, cLng = 77.62;
  const hexes = [];
  let id = 0;
  for (let lat = bbox.s; lat <= bbox.n; lat += step) {
    for (let lng = bbox.w; lng <= bbox.e; lng += step) {
      // population falls off from center, floor of a few hundred
      const d = Math.hypot(lat - cLat, lng - cLng);
      const pop = Math.max(200, Math.round(9000 * Math.exp(-((d * 18) ** 2))));
      hexes.push({ id: `h${id++}`, lat, lng, pop });
    }
  }
  return hexes;
}

const hexes = buildSyntheticHexes();
console.log(`Grid: ${hexes.length} hexes | Stores: ${stores.length}\n`);

function operatorRollup(perStore) {
  const roll = {};
  for (const rec of perStore.values()) {
    const r = (roll[rec.operator] ||= {
      captured: 0,
      cannibalized: 0,
      stores: 0,
    });
    r.captured += rec.captured;
    r.cannibalized += rec.cannibalized;
    r.stores += 1;
  }
  for (const op of Object.keys(roll)) {
    const r = roll[op];
    r.capturedPerDay = Math.round(r.captured);
    r.cannibalizedPerDay = Math.round(r.cannibalized);
    r.cannibalizationRate = (r.cannibalized / r.captured) || 0;
    r.ratePct = (r.cannibalizationRate * 100).toFixed(1) + "%";
    delete r.captured;
    delete r.cannibalized;
  }
  return roll;
}

// ---- Mode 1: per-operator -------------------------------------------------
console.log("=== MODE: per-operator (you only cannibalize your own stores) ===");
const perOp = computeCatchment(hexes, stores, { mode: "per-operator" });
console.table(operatorRollup(perOp.perStore));
console.log(
  `Total market demand: ${Math.round(perOp.totals.demand).toLocaleString()} orders/day | ` +
  `uncovered: ${Math.round(perOp.totals.uncovered).toLocaleString()}\n`
);

// ---- Mode 2: total-market -------------------------------------------------
console.log("=== MODE: total-market (all operators compete in one pool) ===");
const totMkt = computeCatchment(hexes, stores, { mode: "total-market" });
console.table(operatorRollup(totMkt.perStore));
console.log(
  "Note: cannibalization is higher here because every store contests every " +
  "other store, not just same-operator siblings.\n"
);

// ---- Marginal impact: add one Blinkit store in an underserved spot --------
console.log("=== MARGINAL IMPACT: add one Blinkit candidate ===");
const blinkit = stores.filter((s) => s.operator === "Blinkit");
const candidate = {
  id: "candidate-1",
  operator: "Blinkit",
  lat: 13.10, // up near Yelahanka, lower density / fringe
  lng: 77.60,
  source: "candidate",
};
const impact = marginalImpact(hexes, blinkit, candidate, { mode: "per-operator" });
console.log(`Candidate at (${candidate.lat}, ${candidate.lng}) — Blinkit network:`);
console.log(`  Captures:              ${Math.round(impact.capturedByNew)} orders/day`);
console.log(`  Cannibalized from own: ${Math.round(impact.cannibalizedFromOwn)} orders/day`);
console.log(`  Net new:               ${Math.round(impact.netNew)} orders/day`);
console.log(`  New population covered: ${impact.newPopulationCovered.toLocaleString()} (${impact.newHexesCovered} hexes)`);

// ---- Contrast: same candidate dropped into a dense, saturated area --------
console.log("\n=== CONTRAST: same store dropped into dense Koramangala ===");
const candidate2 = { ...candidate, id: "candidate-2", lat: 12.9352, lng: 77.6245 };
const impact2 = marginalImpact(hexes, blinkit, candidate2, { mode: "per-operator" });
console.log(`  Captures:              ${Math.round(impact2.capturedByNew)} orders/day`);
console.log(`  Cannibalized from own: ${Math.round(impact2.cannibalizedFromOwn)} orders/day`);
console.log(`  Net new:               ${Math.round(impact2.netNew)} orders/day`);
console.log(`  New population covered: ${impact2.newPopulationCovered.toLocaleString()} (${impact2.newHexesCovered} hexes)`);
console.log("\n(Expect: fringe candidate = more net-new + new pop; dense candidate = more cannibalization.)");
