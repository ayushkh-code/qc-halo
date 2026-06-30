# Cursor prompt: replace the synthetic grid with real Bangalore ward boundaries

The floating orange grid is wrong. Replace it with a real ward-boundary
choropleth so the map looks like Bangalore. The data is ready in one file:
`bbmp_wards_population.geojson` (add it to the project). Modify the existing app;
do not rebuild. Keep catchment.js math intact.

## The data file

`bbmp_wards_population.geojson` — 198 BBMP wards, real polygons, 2011 census.
Each feature's `properties`:
- `ward_no` (number)
- `ward_name` (string, e.g. "Chowdeswari Ward")
- `pop_total` (number, 2011 census population)
- `area_sq_km` (number)
- `pop_density` (number, people per sq km, precomputed)

Total population across wards is ~8.44M, which matches Bangalore 2011. This is
real administrative data, so the "synthetic population" badge should be REMOVED
and replaced with: "Population: 2011 Census, BBMP wards. Store positions: OSM
where confirmed, otherwise modeled."

## 1. Draw wards as the base layer

- Load `bbmp_wards_population.geojson` with `L.geoJSON`.
- Shade each ward by `pop_density` (NOT raw pop_total — density reads as a real
  city; raw totals don't account for ward size).
- Use a **quantile or log color scale**, not linear. One or two fringe wards have
  near-zero density and one core ward hits ~121,000/sq km, so a linear ramp
  washes everything into one shade. Bucket into ~6 quantile classes (or log
  bins) so the dense core, mid-density belt, and sparse fringe are all visible.
- Use a clean sequential ramp (e.g. light yellow to deep orange/red). Ward fill
  opacity moderate (~0.55) so the basemap streets show through.
- Hairline ward borders (thin, low-opacity white or gray). NOT the thick white
  borders from the current grid version. The borders should read as quiet ward
  divisions, like a state map's internal lines, not a heavy lattice.
- On ward hover: subtle highlight + a tooltip showing ward name, population, and
  density. This makes it explorable and recognizable ("that's Koramangala").

## 2. The demand model now uses wards, not grid hexes

The catchment engine expects demand points `[{ id, lat, lng, pop }]`. Replace
`getHexes()` so it returns one point per ward, using the ward centroid and
population:

```js
function getHexes() {
  return wardGeoJSON.features.map(f => {
    const c = turfCentroid(f); // or a simple polygon centroid
    return {
      id: 'w' + f.properties.ward_no,
      lat: c[1],
      lng: c[0],
      pop: f.properties.pop_total,
    };
  });
}
```

- Compute each ward's centroid. Use a small centroid helper or Turf
  (`@turf/centroid` via CDN). A simple average-of-vertices centroid is fine for
  this; wards are compact enough.
- 198 demand points is far lighter than the old ~2,000-hex grid, so recompute is
  faster. The catchment math is unchanged.
- Because demand is now per ward, the candidate-pin marginal impact reads as
  "which wards' demand does this new store capture, and which existing stores
  lose it." This is more intuitive than abstract hexes.

## 3. Keep the choropleth and the demand-capture view distinct

Two things are now on the map and they must not muddy each other:
- The **ward choropleth** = population density (the static backdrop).
- The **candidate pin + its capture** = the interactive layer on top.

Do not re-color the wards by captured demand (that double-encoding is what made
the old version unreadable). Wards stay colored by population density. The pin's
effect is shown in the rail readout (net-new etc.), and optionally by a light
highlight ring on the wards that fall within the candidate's reach radius, drawn
ABOVE the choropleth so it's clearly a different thing.

## 4. Center and zoom

Fit the map to the ward layer bounds on load so Bangalore fills the view (the
old version was zoomed out showing empty countryside). `map.fitBounds(wardLayer.getBounds())`.

## 5. Keep everything else from the prior revision

The pin-first framing, the readout hierarchy (net-new big), muted store markers,
active-operator default, sliders under "Model settings", legend fully visible.
Defaults stay: maxReachKm 2.5, beta 2.0, ordersPerK 12.

## Acceptance check

1. Map opens fitted to Bangalore, showing 198 recognizable wards shaded by
   density — dense core deep, fringe pale, like a real city choropleth.
2. Hovering a ward names it and shows its population.
3. The candidate pin still drags and the net-new readout still updates live.
4. No floating grid, no thick white lattice, no "synthetic" badge.
