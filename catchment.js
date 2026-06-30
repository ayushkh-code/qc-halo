/**
 * catchment.js
 *
 * Gravity-based catchment + cannibalization engine for the quick commerce
 * store siting simulator. Framework-agnostic (no React/DOM) so it drops into
 * a Cursor/Vercel app, a Node script, or a web worker unchanged.
 *
 * Core idea
 * ---------
 * Each demand hex splits its expected orders across nearby stores by a gravity
 * weight  w = 1 / distance^beta  (capped at maxReachKm). A hex reachable by
 * several stores hands each a share proportional to its weight. Summing across
 * all hexes gives each store its captured demand.
 *
 * Cannibalization
 * ---------------
 * "mode: per-operator"  -> a store only competes with stores of the SAME
 *   operator. Its cannibalized share is the demand it shares with its own
 *   sibling stores. This answers "if I (Blinkit) add a store, how much do I
 *   steal from my other Blinkit stores."
 *
 * "mode: total-market"  -> every store competes with every other store
 *   regardless of operator. Adding a store cannibalizes the whole pooled
 *   network. Useful for a market-wide saturation view.
 *
 * Distance
 * --------
 * Haversine, km. Fast enough for ~tens of thousands of hexes against a few
 * hundred stores in plain JS; for very large grids, see the spatial-binning
 * note at buildStoreIndex().
 */

const EARTH_R_KM = 6371;

function toRad(d) { return (d * Math.PI) / 180; }

function haversineKm(aLat, aLng, bLat, bLng) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(h));
}

/**
 * Default parameters. All are overridable per call.
 *   beta          gravity decay exponent (higher = sharper local pull)
 *   maxReachKm    a store beyond this distance gets zero share of a hex
 *   ordersPerK    expected daily orders per 1,000 people (demand intensity)
 *   minWeightDist floor on distance to avoid divide-by-zero for ~coincident pts
 */
const DEFAULTS = {
  beta: 2.0,
  maxReachKm: 4.0,
  ordersPerK: 12,
  minWeightDist: 0.1, // km
};

/**
 * Convert a hex population to expected daily orders.
 */
function hexDemand(pop, ordersPerK) {
  return (pop / 1000) * ordersPerK;
}

/**
 * Assign every hex's demand across stores and compute per-store capture plus
 * cannibalization.
 *
 * @param {Array} hexes   [{ id, lat, lng, pop }]
 * @param {Array} stores  [{ id, operator, lat, lng, source }]
 * @param {Object} opts   { mode: 'per-operator'|'total-market', beta,
 *                          maxReachKm, ordersPerK }
 * @returns {Object} {
 *     perStore:   Map storeId -> { captured, ownShare, contestedShare,
 *                                  cannibalized, cannibalizationRate },
 *     totals:     { demand, captured, uncovered },
 *     hexAssign:  Map hexId -> [{ storeId, share }]   // for map shading
 *   }
 */
function computeCatchment(hexes, stores, opts = {}) {
  const { beta, maxReachKm, ordersPerK, minWeightDist } = { ...DEFAULTS, ...opts };
  const mode = opts.mode === "total-market" ? "total-market" : "per-operator";

  const perStore = new Map();
  for (const s of stores) {
    perStore.set(s.id, {
      storeId: s.id,
      operator: s.operator,
      captured: 0,
      ownShare: 0,        // demand uniquely this store's (no rival-in-scope nearby)
      contestedShare: 0,  // demand shared with in-scope competitors
      cannibalized: 0,    // contested share attributable to same-scope siblings
    });
  }

  const hexAssign = new Map();
  let totalDemand = 0;
  let totalCaptured = 0;
  let uncovered = 0;

  for (const hex of hexes) {
    const demand = hexDemand(hex.pop, ordersPerK);
    totalDemand += demand;
    if (demand <= 0) continue;

    // Gather in-reach stores and their gravity weights.
    const reach = [];
    let weightSum = 0;
    for (const s of stores) {
      const dist = haversineKm(hex.lat, hex.lng, s.lat, s.lng);
      if (dist > maxReachKm) continue;
      const d = Math.max(dist, minWeightDist);
      const w = 1 / Math.pow(d, beta);
      reach.push({ store: s, dist, w });
      weightSum += w;
    }

    if (reach.length === 0) {
      uncovered += demand;
      continue;
    }

    // Split demand by weight share.
    const assigns = [];
    for (const r of reach) {
      const share = (r.w / weightSum) * demand;
      const rec = perStore.get(r.store.id);
      rec.captured += share;
      totalCaptured += share;
      assigns.push({ storeId: r.store.id, share });

      // Determine "scope" peers: same-operator (per-operator mode) or all
      // (total-market mode). A store's demand at this hex is contested if any
      // OTHER in-scope store is also in reach.
      const scopePeers = reach.filter((o) => {
        if (o.store.id === r.store.id) return false;
        return mode === "total-market" || o.store.operator === r.store.operator;
      });

      if (scopePeers.length === 0) {
        rec.ownShare += share;
      } else {
        rec.contestedShare += share;
        // Cannibalized portion = the share that, absent this store, would have
        // gone to in-scope peers. Approximate as the fraction of this hex's
        // demand that in-scope peers would have captured among themselves.
        const peerWeight = scopePeers.reduce((a, o) => a + o.w, 0);
        const scopeWeight = peerWeight + r.w;
        // Of this store's captured share, the part "taken from" peers scales
        // with how much weight the peers hold within the in-scope set.
        const cannibalizedShare = share * (peerWeight / scopeWeight);
        rec.cannibalized += cannibalizedShare;
      }
    }
    hexAssign.set(hex.id, assigns);
  }

  // Finalize rates.
  for (const rec of perStore.values()) {
    rec.cannibalizationRate =
      rec.captured > 0 ? rec.cannibalized / rec.captured : 0;
  }

  return {
    perStore,
    totals: { demand: totalDemand, captured: totalCaptured, uncovered },
    hexAssign,
  };
}

/**
 * Marginal impact of ADDING one candidate store to an existing footprint.
 * Runs the catchment twice (before / after) and diffs. This is what powers the
 * draggable-pin hero line.
 *
 * @returns {Object} {
 *   capturedByNew,        // orders/day the new store captures
 *   cannibalizedFromOwn,  // of that, how much came from same-scope existing stores
 *   netNew,               // capturedByNew - cannibalizedFromOwn
 *   newPopulationCovered, // population in hexes that had NO in-reach store before
 *   newHexesCovered,      // count of those hexes
 * }
 */
function marginalImpact(hexes, existingStores, candidate, opts = {}) {
  const { maxReachKm, ordersPerK } = { ...DEFAULTS, ...opts };

  const before = computeCatchment(hexes, existingStores, opts);
  const after = computeCatchment(hexes, [...existingStores, candidate], opts);

  const newRec = after.perStore.get(candidate.id);
  const capturedByNew = newRec ? newRec.captured : 0;

  // How much total captured demand the existing stores LOST after adding the
  // candidate, restricted to same-scope stores (the cannibalization the user
  // cares about). In total-market mode, scope is all stores.
  const mode = opts.mode === "total-market" ? "total-market" : "per-operator";
  let cannibalizedFromOwn = 0;
  for (const s of existingStores) {
    if (mode === "per-operator" && s.operator !== candidate.operator) continue;
    const b = before.perStore.get(s.id)?.captured || 0;
    const a = after.perStore.get(s.id)?.captured || 0;
    if (b > a) cannibalizedFromOwn += b - a;
  }

  // New population covered: hexes that had zero in-reach store before but are
  // within reach of the candidate now.
  let newPopulationCovered = 0;
  let newHexesCovered = 0;
  for (const hex of hexes) {
    const hadBefore = existingStores.some(
      (s) => haversineKm(hex.lat, hex.lng, s.lat, s.lng) <= maxReachKm
    );
    if (hadBefore) continue;
    const reachedNow =
      haversineKm(hex.lat, hex.lng, candidate.lat, candidate.lng) <= maxReachKm;
    if (reachedNow) {
      newPopulationCovered += hex.pop;
      newHexesCovered += 1;
    }
  }

  return {
    capturedByNew,
    cannibalizedFromOwn,
    netNew: capturedByNew - cannibalizedFromOwn,
    newPopulationCovered,
    newHexesCovered,
  };
}

module.exports = {
  haversineKm,
  hexDemand,
  computeCatchment,
  marginalImpact,
  DEFAULTS,
};
