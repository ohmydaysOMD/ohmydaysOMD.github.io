// node tools/make-buses.js [path-to-unzipped-GTFS]
// Cuts the Bus Éireann timetable (Transport for Ireland GTFS, ~70 MB) down to the stops around Douglas,
// Maryborough, Rochestown and Moneygourney, and writes host/buses.json for the app.
// Each departure is marked "town" when that bus goes on to the city centre after the stop.
// Run UPDATE_BUSES.bat now and then (the timetable changes a few times a year).
const fs = require('fs'), path = require('path'), readline = require('readline');
const args = process.argv.slice(2), oi = args.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(args[oi + 1]) : path.join(__dirname, '..', 'host', 'buses.json');
if (oi >= 0) args.splice(oi, 2);
const dir = args[0] || path.join(process.env.TEMP || '.', 'gtfs', 'be');
const AREA = { s: 51.845, n: 51.888, w: -8.470, e: -8.385 };      // Douglas, Grange, Maryborough, Rochestown, Moneygourney
const TOWN = { s: 51.8925, n: 51.9030, w: -8.4800, e: -8.4580 };  // Patrick St, Grand Parade, South Mall, Parnell Place
const inBox = (b, lat, lon) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;

function csvSplit(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
function readSmall(f) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const head = csvSplit(lines[0]);
  return lines.slice(1).map(l => { const v = csvSplit(l), o = {}; head.forEach((h, i) => o[h] = v[i]); return o; });
}
async function eachRow(f, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, f), 'utf8'), crlfDelay: Infinity });
  let head = null;
  for await (let line of rl) {
    if (!head) { head = csvSplit(line.replace(/^﻿/, '')); continue; }
    if (!line) continue;
    const v = csvSplit(line), o = {}; head.forEach((h, i) => o[h] = v[i]); fn(o);
  }
}

(async () => {
  const stops = readSmall('stops.txt');
  const area = {}, town = {};
  stops.forEach(s => {
    const lat = +s.stop_lat, lon = +s.stop_lon;
    if (inBox(AREA, lat, lon)) area[s.stop_id] = { id: s.stop_id, code: s.stop_code, name: s.stop_name, lat: +lat.toFixed(5), lon: +lon.toFixed(5), deps: [] };
    if (inBox(TOWN, lat, lon)) town[s.stop_id] = 1;
  });
  console.log('area stops', Object.keys(area).length, 'town stops', Object.keys(town).length);

  // one pass over stop_times: our stops' departures, and how far into each trip it reaches town
  const hits = [], townSeq = {};
  await eachRow('stop_times.txt', r => {
    if (area[r.stop_id]) hits.push({ trip: r.trip_id, stop: r.stop_id, seq: +r.stop_sequence, t: (r.departure_time || r.arrival_time).slice(0, 5) });
    if (town[r.stop_id]) { const s = +r.stop_sequence; if (!(townSeq[r.trip_id] >= s)) townSeq[r.trip_id] = s; }
  });
  console.log('departures at area stops', hits.length);

  const trips = {};
  await eachRow('trips.txt', r => { trips[r.trip_id] = { route: r.route_id, svc: r.service_id, head: r.trip_headsign }; });
  const routes = {}; readSmall('routes.txt').forEach(r => { routes[r.route_id] = r.route_short_name || r.route_long_name; });

  const used = {};
  hits.forEach(h => {
    const tr = trips[h.trip]; if (!tr) return;
    used[tr.svc] = 1;
    const toTown = townSeq[h.trip] > h.seq;
    area[h.stop].deps.push([h.t, routes[tr.route] || '?', (tr.head || '').replace(/\s+/g, ' ').trim(), tr.svc, toTown ? 1 : 0]);
  });
  // services: which days each runs, with the one-off additions and removals
  const svc = {};
  readSmall('calendar.txt').forEach(c => {
    if (!used[c.service_id]) return;
    svc[c.service_id] = { days: [c.sunday, c.monday, c.tuesday, c.wednesday, c.thursday, c.friday, c.saturday].map(Number), from: c.start_date, to: c.end_date, add: [], off: [] };
  });
  readSmall('calendar_dates.txt').forEach(c => {
    if (!used[c.service_id]) return;
    svc[c.service_id] = svc[c.service_id] || { days: [0, 0, 0, 0, 0, 0, 0], from: c.date, to: c.date, add: [], off: [] };
    (c.exception_type === '1' ? svc[c.service_id].add : svc[c.service_id].off).push(c.date);
  });
  // compact: only buses going on into town; per stop, per service, 'HHMM routeIndex headIndex' packed in one string
  const R = [], H = [], idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { arr.push(v); i = arr.length - 1; } return i; };
  const list = Object.values(area).map(s => {
    const town = s.deps.filter(d => d[4]);
    if (!town.length) return null;
    const by = {};
    town.sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0).forEach(d => {
      (by[d[3]] = by[d[3]] || []).push(d[0].replace(':', '') + '.' + idx(R, d[1]) + '.' + idx(H, d[2]));
    });
    Object.keys(by).forEach(k => { by[k] = [...new Set(by[k])].join(' '); });
    return { id: s.id, code: s.code, name: s.name, lat: s.lat, lon: s.lon, routes: [...new Set(town.map(d => d[1]))].sort(), d: by };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const feed = readSmall('feed_info.txt')[0] || {};
  const out = { made: new Date().toISOString().slice(0, 10), feedFrom: feed.feed_start_date, feedTo: feed.feed_end_date, routes: R, heads: H, services: svc, stops: list };
  // never publish a broken cut: Moneygurney must be there, with plenty of stops around it
  if (list.length < 20 || !list.some(x => x.id === '8380B234611')) { console.error('Something is wrong with this timetable (only ' + list.length + ' stops). Not saved.'); process.exit(1); }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('stops with town buses', list.length, 'services', Object.keys(svc).length, 'size', Math.round(fs.statSync(OUT).size / 1024) + ' KB');
  console.log('headsigns', H.join(' | '));
  list.filter(s => /money|gurney/i.test(s.name)).forEach(s => console.log('  ', s.name, s.id, s.routes.join(','), Object.keys(s.d).map(k => k + ':' + s.d[k].split(' ').length).join(' ')));
})();
