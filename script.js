/* ══════════════════════════════════════════════
   Digicamin — script.js
   Vanilla JS, no framework. Modular functions.
   ══════════════════════════════════════════════ */

'use strict';

// ── Global state ──────────────────────────────────────────────────────────────
/** @type {Object[]} Full dataset from data.json */
let ALL_DATA = [];

/** Active filter/sort/page state */
const S = {
  period:      'all',   // 'all' | 'this_month' | '3_months' | 'custom'
  dateFrom:    null,    // Date | null
  dateTo:      null,    // Date | null
  merek:       '',
  kategori:    '',
  tipe:        '',
  sumber:      '',
  search:      '',
  sortCol:     'tanggal_sewa',
  sortDir:     'desc',
  page:        1,
  granularity: 'monthly', // 'daily' | 'weekly' | 'monthly'
};

const PAGE_SIZE = 10;

/** Chart.js instances — always destroyed before re-render */
const CH = { trend: null, camera: null, tipe: null, sumber: null };

// ── Formatters ────────────────────────────────────────────────────────────────

/** Format integer as Rp50.000 */
function fmtRp(n) {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

/** Format YYYY-MM-DD as "5 Jan 2026" */
function fmtDate(str) {
  if (!str) return '-';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

/** Parse YYYY-MM-DD to local Date at midnight */
function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Escape HTML special chars to prevent XSS */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Period helpers ────────────────────────────────────────────────────────────

/** Return [startDate, endDate] for the active period, or [null,null] for all. */
function periodBounds() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (S.period === 'this_month') {
    return [
      new Date(today.getFullYear(), today.getMonth(), 1),
      new Date(today.getFullYear(), today.getMonth() + 1, 0),
    ];
  }
  if (S.period === '3_months') {
    return [new Date(today.getFullYear(), today.getMonth() - 2, 1), today];
  }
  if (S.period === 'custom') return [S.dateFrom, S.dateTo];
  return [null, null];
}

// ── Central filter ────────────────────────────────────────────────────────────

/**
 * Apply all active filters to ALL_DATA and return the filtered array.
 * This is the single source of truth called by every render function.
 */
function getFiltered() {
  const [start, end] = periodBounds();
  return ALL_DATA.filter(r => {
    if (start || end) {
      const d = parseDate(r.tanggal_sewa);
      if (start && d < start) return false;
      if (end   && d > end)   return false;
    }
    if (S.merek    && r.merek           !== S.merek)    return false;
    if (S.kategori && r.kategori_kamera !== S.kategori) return false;
    if (S.tipe     && r.tipe_penyewa    !== S.tipe)     return false;
    if (S.sumber   && r.sumber_booking  !== S.sumber)   return false;
    return true;
  });
}

/** Count occurrences of a field value across rows */
function countBy(rows, field) {
  return rows.reduce((acc, r) => {
    const v = r[field] || '–';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

/** Sum a numeric field grouped by another field */
function sumBy(rows, groupField, sumField) {
  return rows.reduce((acc, r) => {
    const v = r[groupField] || '–';
    acc[v] = (acc[v] || 0) + r[sumField];
    return acc;
  }, {});
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

/** Destroy a Chart.js instance if it exists, then null it */
function destroyChart(key) {
  if (CH[key]) { CH[key].destroy(); CH[key] = null; }
}

/** Return theme-aware label and grid colours */
function themeColors() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    text:  dark ? '#8aabcc' : '#475569',
    grid:  dark ? '#1a2e4a' : '#dce6f0',
  };
}

const PALETTE = [
  '#1e4a8a','#f97316','#16a34a','#7c3aed','#0ea5e9',
  '#db2777','#ca8a04','#0d9488','#dc2626','#8b5cf6',
];

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  show('state-loading');
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ALL_DATA = await res.json();
    if (!Array.isArray(ALL_DATA) || ALL_DATA.length === 0)
      throw new Error('Data kosong atau format tidak valid.');
    populateFilters();
    renderAll();
    show('dashboard');
  } catch (err) {
    console.error('[Digicamin]', err);
    document.getElementById('error-msg').textContent =
      `Gagal memuat data.json: ${err.message}. Jalankan lewat server lokal (lihat README).`;
    show('state-error');
  }
}

/** Switch between loading / error / dashboard */
function show(id) {
  ['state-loading', 'state-error', 'dashboard'].forEach(i => {
    document.getElementById(i).classList.toggle('hidden', i !== id);
  });
}

// ── Filter dropdowns ──────────────────────────────────────────────────────────

/** Fill each filter <select> with unique values from the full dataset */
function populateFilters() {
  const uniq = f => [...new Set(ALL_DATA.map(r => r[f]).filter(Boolean))].sort();
  fill('f-merek',    uniq('merek'));
  fill('f-kategori', uniq('kategori_kamera'));
  fill('f-tipe',     uniq('tipe_penyewa'));
  fill('f-sumber',   uniq('sumber_booking'));
}

function fill(id, values) {
  const sel = document.getElementById(id);
  const first = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(first);
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}

// ── Master render ─────────────────────────────────────────────────────────────

/**
 * Single entry point — compute filtered data once, pass to every component.
 * Call this on every filter/period change.
 */
function renderAll() {
  const data = getFiltered();
  renderKPIs(data);
  renderInsight(data);
  renderTop5(data);
  renderTrend(data);
  renderCameraChart(data);
  renderTipeChart(data);
  renderSumberChart(data);
  renderHeatmap(data);
  renderTable();        // uses S.search, S.sortCol, etc.
  renderChips();
}

// ── KPI ───────────────────────────────────────────────────────────────────────

function renderKPIs(data) {
  const n         = data.length;
  const revenue   = data.reduce((s, r) => s + r.total_bayar, 0);
  const denda     = data.reduce((s, r) => s + r.denda, 0);
  const durasi    = n ? data.reduce((s, r) => s + r.durasi_hari, 0) / n : 0;
  const lateCount = data.filter(r => r.hari_telat > 0).length;
  const latePct   = n ? (lateCount / n * 100) : 0;

  // Max values across full dataset (for bar proportion reference)
  const allRev    = ALL_DATA.reduce((s, r) => s + r.total_bayar, 0);
  const allDenda  = ALL_DATA.reduce((s, r) => s + r.denda, 0);
  const maxDur    = 30; // reasonable max duration ceiling

  animateValue('kv-pendapatan', revenue, v => fmtRp(v));
  animateValue('kv-jumlah',     n,       v => Math.round(v).toLocaleString('id-ID') + ' transaksi');
  animateValue('kv-durasi',     durasi,  v => v.toFixed(1) + ' hari');
  animateValue('kv-telat',      latePct, v => v.toFixed(1) + '%');
  animateValue('kv-denda',      denda,   v => fmtRp(v));

  // Progress bars (delayed so CSS transition fires)
  setTimeout(() => {
    setBar('kb-pendapatan', allRev   ? revenue / allRev * 100   : 0);
    setBar('kb-jumlah',     ALL_DATA.length ? n / ALL_DATA.length * 100 : 0);
    setBar('kb-durasi',     Math.min(100, durasi / maxDur * 100));
    setBar('kb-telat',      latePct);
    setBar('kb-denda',      allDenda ? denda / allDenda * 100   : 0);
  }, 80);
}

/** Animate a numeric value from its current display to target */
function animateValue(id, target, fmt) {
  const el = document.getElementById(id);
  const start     = parseFloat(el.dataset.val) || 0;
  const duration  = 600;
  const startTime = performance.now();

  function step(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current  = start + (target - start) * eased;
    el.textContent  = fmt(current);
    el.dataset.val  = target;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Set a KPI bar width */
function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
}

// ── Top 5 leaderboard ────────────────────────────────────────────────────────

/**
 * Render Top 5 Kamera Terpopuler leaderboard with animated bars.
 * @param {Object[]} data
 */
function renderTop5(data) {
  const ol = document.getElementById('top5-list');
  if (!data.length) {
    ol.innerHTML = '<li class="tbl-empty">Tidak ada data.</li>';
    return;
  }

  const counts = countBy(data, 'nama_kamera');
  const top5   = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxCnt = top5[0][1];
  const rankClass = ['gold', 'silver', 'bronze', '', ''];

  ol.innerHTML = top5.map(([name, cnt], i) => `
    <li class="top5-item">
      <span class="top5-rank ${rankClass[i]}">#${i + 1}</span>
      <div class="top5-bar-wrap">
        <span class="top5-name" title="${esc(name)}">${esc(name)}</span>
        <div class="top5-track">
          <div class="top5-fill" data-target="${(cnt / maxCnt * 100).toFixed(1)}" style="width:0%"></div>
        </div>
      </div>
      <span class="top5-count">${cnt} sewa</span>
    </li>`).join('');

  // Animate bars in after a short delay
  setTimeout(() => {
    ol.querySelectorAll('.top5-fill').forEach(bar => {
      bar.style.width = bar.dataset.target + '%';
    });
  }, 80);
}

// ── Insight ───────────────────────────────────────────────────────────────────

// SVG snippets for insight pills
const PIL_ICON = {
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  trend:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  clock:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

function renderInsight(data) {
  const el = document.getElementById('insight-body');
  if (!data.length) {
    el.innerHTML = '<p class="insight-empty">Tidak ada data untuk filter yang dipilih.</p>';
    return;
  }

  const pills = [];

  // Top camera
  const byCam  = countBy(data, 'nama_kamera');
  const topCam = Object.entries(byCam).sort((a, b) => b[1] - a[1])[0];
  if (topCam)
    pills.push({ icon: PIL_ICON.camera, cls: 'orange',
      text: `Kamera terlaris adalah <strong>${topCam[0]}</strong> dengan <strong>${topCam[1]}</strong> transaksi.` });

  // Peak month
  const byMonth = {};
  data.forEach(r => { const k = r.tanggal_sewa.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; });
  const peakM = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  if (peakM) {
    const [y, m] = peakM[0].split('-');
    const names  = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    pills.push({ icon: PIL_ICON.trend, cls: 'blue',
      text: `Bulan paling sibuk adalah <strong>${names[+m - 1]} ${y}</strong> dengan <strong>${peakM[1]}</strong> sewa.` });
  }

  // Highest late rate tipe
  const tipeCnt = {}; const tipeLate = {};
  data.forEach(r => {
    const t = r.tipe_penyewa;
    tipeCnt[t]  = (tipeCnt[t]  || 0) + 1;
    if (r.hari_telat > 0) tipeLate[t] = (tipeLate[t] || 0) + 1;
  });
  const lateRates = Object.keys(tipeCnt).map(t => ({
    tipe: t, pct: (tipeLate[t] || 0) / tipeCnt[t] * 100
  })).sort((a, b) => b.pct - a.pct);
  if (lateRates.length && lateRates[0].pct > 0)
    pills.push({ icon: PIL_ICON.clock, cls: 'red',
      text: `Tipe <strong>${lateRates[0].tipe}</strong> memiliki tingkat telat tertinggi: <strong>${lateRates[0].pct.toFixed(1)}%</strong>.` });

  el.innerHTML = pills.map(p => `
    <div class="insight-pill">
      <div class="insight-pill-icon insight-pill-icon--${p.cls}" aria-hidden="true">${p.icon}</div>
      <span>${p.text}</span>
    </div>`).join('');
}

// ── Revenue Trend ─────────────────────────────────────────────────────────────

function renderTrend(data) {
  destroyChart('trend');
  const canvas = document.getElementById('c-trend');

  if (!data.length) {
    canvas.closest('.chart-box').innerHTML = '<p class="tbl-empty">Tidak ada data.</p>';
    return;
  }

  const monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const gran = S.granularity;
  const grouped = {};

  data.forEach(r => {
    const d = parseDate(r.tanggal_sewa);
    let k;
    if (gran === 'daily') {
      k = r.tanggal_sewa.slice(0, 10);
    } else if (gran === 'weekly') {
      // ISO week: find Monday of the week
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dow = (day.getDay() + 6) % 7; // Mon=0
      day.setDate(day.getDate() - dow);
      k = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    } else {
      k = r.tanggal_sewa.slice(0, 7);
    }
    grouped[k] = (grouped[k] || 0) + r.total_bayar;
  });

  const sorted = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]));
  let labels;
  if (gran === 'daily') {
    labels = sorted.map(([k]) => { const [,m,d] = k.split('-'); return `${d}/${m}`; });
  } else if (gran === 'weekly') {
    labels = sorted.map(([k]) => { const [,m,d] = k.split('-'); return `${d}/${m}`; });
  } else {
    labels = sorted.map(([k]) => { const [y,m] = k.split('-'); return `${monthNames[+m-1]} ${y}`; });
  }
  const values = sorted.map(([,v]) => v);

  // Screen-reader summary
  const granLabel = gran === 'daily' ? 'harian' : gran === 'weekly' ? 'mingguan' : 'bulanan';
  document.getElementById('s-trend').textContent =
    values.length ? `Tren pendapatan ${granLabel}. Puncak: ${labels[values.indexOf(Math.max(...values))]} (${fmtRp(Math.max(...values))}).` : '';

  const tc = themeColors();
  CH.trend = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Pendapatan',
        data: values,
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,.1)',
        borderWidth: 2.5,
        pointRadius: sorted.length > 24 ? 0 : 3,
        pointHoverRadius: 5,
        fill: true,
        tension: .35,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmtRp(ctx.parsed.y) } },
      },
      scales: {
        x: { ticks: { color: tc.text, maxTicksLimit: 12, maxRotation: 45 }, grid: { color: tc.grid } },
        y: { ticks: { color: tc.text, callback: v => fmtRp(v) }, grid: { color: tc.grid } },
      },
    },
  });
}

// ── Camera Revenue ────────────────────────────────────────────────────────────

function renderCameraChart(data) {
  destroyChart('camera');
  const canvas = document.getElementById('c-camera');

  if (!data.length) {
    canvas.closest('.chart-box').innerHTML = '<p class="tbl-empty">Tidak ada data.</p>';
    return;
  }

  const revMap = sumBy(data, 'nama_kamera', 'total_bayar');
  const sorted = Object.entries(revMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([,v]) => v);

  document.getElementById('s-camera').textContent =
    `Top kamera: ${labels[0]} (${fmtRp(values[0])}).`;

  // Dynamic height based on count
  canvas.height = Math.max(220, sorted.length * 30);

  const tc = themeColors();
  CH.camera = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Pendapatan',
        data: values,
        backgroundColor: values.map((v, i) => i === 0 ? 'rgba(249,115,22,.85)' : 'rgba(30,74,138,.7)'),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ' + fmtRp(ctx.parsed.x) } },
      },
      scales: {
        x: { ticks: { color: tc.text, callback: v => fmtRp(v) }, grid: { color: tc.grid } },
        y: { ticks: { color: tc.text, font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

// ── Tipe Penyewa ──────────────────────────────────────────────────────────────

function renderTipeChart(data) {
  destroyChart('tipe');
  const canvas = document.getElementById('c-tipe');

  if (!data.length) {
    canvas.closest('.chart-box').innerHTML = '<p class="tbl-empty">Tidak ada data.</p>';
    return;
  }

  const counts = countBy(data, 'tipe_penyewa');
  const labels = Object.keys(counts);
  const values = Object.values(counts);

  document.getElementById('s-tipe').textContent =
    labels.map((l, i) => `${l}: ${values[i]}`).join(', ');

  const tc = themeColors();
  CH.tipe = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 2,
        borderColor: 'var(--bg-card)',
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: tc.text, boxWidth: 12, font: { size: 11 }, padding: 8 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const tot = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return ` ${ctx.label}: ${ctx.parsed} (${(ctx.parsed / tot * 100).toFixed(1)}%)`;
            }
          }
        },
      },
    },
  });
}

// ── Sumber Booking ────────────────────────────────────────────────────────────

function renderSumberChart(data) {
  destroyChart('sumber');
  const canvas = document.getElementById('c-sumber');

  if (!data.length) {
    canvas.closest('.chart-box').innerHTML = '<p class="tbl-empty">Tidak ada data.</p>';
    return;
  }

  const counts = countBy(data, 'sumber_booking');
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => k);
  const values = sorted.map(([,v]) => v);

  document.getElementById('s-sumber').textContent =
    labels.map((l, i) => `${l}: ${values[i]}`).join(', ');

  const tc = themeColors();
  CH.sumber = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Jumlah Sewa',
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} transaksi` } },
      },
      scales: {
        x: { ticks: { color: tc.text }, grid: { color: tc.grid } },
        y: { ticks: { color: tc.text }, grid: { color: tc.grid } },
      },
    },
  });
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

function renderHeatmap(data) {
  const wrap = document.getElementById('heatmap');
  wrap.innerHTML = '';

  if (!data.length) {
    wrap.innerHTML = '<p class="tbl-empty">Tidak ada data.</p>';
    return;
  }

  // Build day-count map
  const dayMap = {};
  data.forEach(r => { dayMap[r.tanggal_sewa] = (dayMap[r.tanggal_sewa] || 0) + 1; });

  const allDays = Object.keys(dayMap).sort();
  const maxCnt  = Math.max(...Object.values(dayMap));

  // Determine date range (cap at 13 months for performance)
  const [pStart, pEnd] = periodBounds();
  let start = pStart || parseDate(allDays[0]);
  let end   = pEnd   || parseDate(allDays[allDays.length - 1]);
  if (end - start > 395 * 86400000) start = new Date(end - 395 * 86400000);

  // Group dates by month
  const monthMap = {};
  let cur = new Date(start);
  while (cur <= end) {
    const mk = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2,'0')}`;
    if (!monthMap[mk]) monthMap[mk] = [];
    const ds = cur.toISOString().slice(0, 10);
    monthMap[mk].push({ date: ds, cnt: dayMap[ds] || 0 });
    cur = new Date(cur.getTime() + 86400000);
  }

  const mNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const grid = document.createElement('div');
  grid.className = 'hm-grid';

  Object.entries(monthMap).forEach(([mk, days]) => {
    const [, m] = mk.split('-');
    const mcol  = document.createElement('div');
    mcol.className = 'hm-mcol';

    const lbl = document.createElement('div');
    lbl.className = 'hm-mlbl';
    lbl.textContent = mNames[+m - 1];
    mcol.appendChild(lbl);

    const weeksDiv = document.createElement('div');
    weeksDiv.className = 'hm-weeks';

    // First week padding (Mon=0)
    let week = document.createElement('div');
    week.className = 'hm-week';
    const pad = (parseDate(days[0].date).getDay() + 6) % 7;
    for (let i = 0; i < pad; i++) {
      const sp = document.createElement('div');
      sp.style.cssText = 'width:13px;height:13px';
      week.appendChild(sp);
    }

    days.forEach(({ date, cnt }) => {
      const dow = (parseDate(date).getDay() + 6) % 7; // Mon=0
      if (dow === 0 && week.children.length > 0) {
        weeksDiv.appendChild(week);
        week = document.createElement('div');
        week.className = 'hm-week';
      }
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      cell.dataset.l     = heatLevel(cnt, maxCnt);
      cell.dataset.date  = date;
      cell.dataset.cnt   = cnt;
      cell.tabIndex      = 0;
      cell.setAttribute('role', 'img');
      cell.setAttribute('aria-label', `${fmtDate(date)}: ${cnt} sewa`);
      week.appendChild(cell);
    });
    weeksDiv.appendChild(week);
    mcol.appendChild(weeksDiv);
    grid.appendChild(mcol);
  });

  wrap.appendChild(grid);
  bindHeatmapTip(wrap);
}

function heatLevel(cnt, max) {
  if (!cnt) return 0;
  const r = cnt / max;
  if (r <= .25) return 1;
  if (r <= .5)  return 2;
  if (r <= .75) return 3;
  return 4;
}

function bindHeatmapTip(wrap) {
  const tip = document.getElementById('heatmap-tip');

  function show(e) {
    const c = e.currentTarget;
    tip.textContent = `${fmtDate(c.dataset.date)} — ${c.dataset.cnt} sewa`;
    tip.classList.add('show');
    tip.setAttribute('aria-hidden', 'false');
    move(e);
  }
  function move(e) {
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 34) + 'px';
  }
  function hide() {
    tip.classList.remove('show');
    tip.setAttribute('aria-hidden', 'true');
  }

  wrap.querySelectorAll('.hm-cell').forEach(c => {
    c.addEventListener('mouseenter', show);
    c.addEventListener('mousemove',  move);
    c.addEventListener('mouseleave', hide);
    c.addEventListener('focus', show);
    c.addEventListener('blur',  hide);
  });
}

// ── Table ─────────────────────────────────────────────────────────────────────

/**
 * Render the transaction table with active search/sort/pagination.
 * Reads S.search, S.sortCol, S.sortDir, S.page.
 */
function renderTable() {
  const base   = getFiltered();
  const q      = S.search.trim().toLowerCase();

  // Search filter on top of period+dropdown filters
  let rows = q
    ? base.filter(r =>
        r.nama_penyewa.toLowerCase().includes(q) ||
        r.nama_kamera.toLowerCase().includes(q))
    : base;

  // Sort
  rows = [...rows].sort((a, b) => {
    let av = a[S.sortCol], bv = b[S.sortCol];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    if (av < bv) return S.sortDir === 'asc' ? -1 : 1;
    if (av > bv) return S.sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  S.page      = Math.min(S.page, pages);
  const slice = rows.slice((S.page - 1) * PAGE_SIZE, S.page * PAGE_SIZE);

  const tbody = document.getElementById('tbl-body');
  if (!total) {
    tbody.innerHTML = '<tr><td colspan="9" class="tbl-empty">Tidak ada transaksi yang sesuai.</td></tr>';
  } else {
    tbody.innerHTML = slice.map(r => {
      const initials = r.nama_penyewa.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
      const avatarBg = avatarColor(r.nama_penyewa);
      return `<tr>
        <td style="font-size:.74rem;color:var(--text-3);font-family:monospace">${esc(r.id_transaksi)}</td>
        <td>${fmtDate(r.tanggal_sewa)}</td>
        <td><div class="cell-penyewa">
          <div class="avatar" style="background:${avatarBg}" aria-hidden="true">${initials}</div>
          ${esc(r.nama_penyewa)}
        </div></td>
        <td>${esc(r.nama_kamera)}</td>
        <td>${r.durasi_hari} hari</td>
        <td style="font-weight:600">${fmtRp(r.total_bayar)}</td>
        <td>${r.hari_telat > 0
              ? `<span class="badge badge-late">${r.hari_telat} hari</span>`
              : '<span class="badge badge-ok">Tepat</span>'}</td>
        <td>${esc(r.tipe_penyewa)}</td>
        <td>${esc(r.sumber_booking)}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('page-info').textContent =
    `Hal. ${S.page} dari ${pages} (${total.toLocaleString('id-ID')} baris)`;
  document.getElementById('btn-prev').disabled = S.page <= 1;
  document.getElementById('btn-next').disabled = S.page >= pages;

  // Update aria-sort on headers
  document.querySelectorAll('.data-table th').forEach(th => {
    const c = th.dataset.col;
    th.setAttribute('aria-sort',
      c === S.sortCol ? (S.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

// ── Filter chips ──────────────────────────────────────────────────────────────

const CHIP_LABELS = { merek: 'Merek', kategori: 'Kategori', tipe: 'Tipe', sumber: 'Sumber' };

function renderChips() {
  const box = document.getElementById('filter-chips');
  box.innerHTML = '';

  Object.entries(CHIP_LABELS).forEach(([key, label]) => {
    if (!S[key]) return;
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.setAttribute('role', 'listitem');
    chip.innerHTML = `<span>${label}: ${esc(S[key])}</span>
      <button class="chip-x" data-key="${key}" aria-label="Hapus filter ${label}">x</button>`;
    chip.querySelector('.chip-x').addEventListener('click', () => {
      S[key] = '';
      document.getElementById(`f-${key}`).value = '';
      S.page = 1;
      renderAll();
    });
    box.appendChild(chip);
  });
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  // ── Sidebar toggle ────────────────────────────────────────────────────────
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const wrapper  = document.getElementById('layout-wrapper');
  const btnToggle = document.getElementById('btn-sidebar-toggle');

  function isMobile() { return window.innerWidth < 768; }

  function openSidebar() {
    if (isMobile()) {
      document.body.classList.add('sidebar-open');
      sidebar.classList.add('open');
      overlay.classList.remove('hidden');
      overlay.classList.add('open');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
    btnToggle.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    if (isMobile()) {
      document.body.classList.remove('sidebar-open');
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      overlay.classList.add('hidden');
    } else {
      document.body.classList.add('sidebar-collapsed');
    }
    btnToggle.setAttribute('aria-expanded', 'false');
  }

  function sidebarIsOpen() {
    return isMobile()
      ? sidebar.classList.contains('open')
      : !document.body.classList.contains('sidebar-collapsed');
  }

  btnToggle.addEventListener('click', () => {
    sidebarIsOpen() ? closeSidebar() : openSidebar();
  });

  // Close on overlay tap (mobile)
  overlay.addEventListener('click', closeSidebar);

  // Sidebar nav link active highlight (scroll to section)
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('.sidebar-link').forEach(l => {
        l.classList.remove('active');
        l.removeAttribute('aria-current');
      });
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
      if (isMobile()) closeSidebar();
    });
  });

  // Period selector
  document.getElementById('sel-period').addEventListener('change', e => {
    S.period = e.target.value;
    document.getElementById('custom-range').classList.toggle('hidden', S.period !== 'custom');
    S.page = 1;
    if (S.period !== 'custom') renderAll();
  });

  document.getElementById('date-from').addEventListener('change', e => {
    S.dateFrom = e.target.value ? parseDate(e.target.value) : null;
    S.page = 1;
    if (S.period === 'custom') renderAll();
  });

  document.getElementById('date-to').addEventListener('change', e => {
    S.dateTo = e.target.value ? parseDate(e.target.value) : null;
    S.page = 1;
    if (S.period === 'custom') renderAll();
  });

  // Theme toggle
  document.getElementById('btn-theme').addEventListener('click', () => {
    const html = document.documentElement;
    const dark = html.dataset.theme === 'dark';
    html.dataset.theme = dark ? 'light' : 'dark';
    document.getElementById('icon-sun').classList.toggle('hidden', !dark);
    document.getElementById('icon-moon').classList.toggle('hidden', dark);
    // Re-render charts to pick up new theme colours
    const d = getFiltered();
    renderTrend(d);
    renderCameraChart(d);
    renderTipeChart(d);
    renderSumberChart(d);
  });

  // Dropdown filters — id pattern "f-{key}"
  ['f-merek', 'f-kategori', 'f-tipe', 'f-sumber'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      S[id.slice(2)] = e.target.value;   // strip "f-"
      S.page = 1;
      renderAll();
    });
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    S.merek = ''; S.kategori = ''; S.tipe = ''; S.sumber = '';
    S.search = ''; S.page = 1;
    ['f-merek','f-kategori','f-tipe','f-sumber'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('tbl-search').value = '';
    renderAll();
  });

  // Table search (debounced 200 ms)
  let searchTimer;
  document.getElementById('tbl-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.search = e.target.value; S.page = 1; renderTable(); }, 200);
  });

  // Table column sort (click + keyboard)
  document.querySelectorAll('.data-table th').forEach(th => {
    function doSort() {
      const col = th.dataset.col;
      S.sortDir = S.sortCol === col && S.sortDir === 'asc' ? 'desc' : 'asc';
      S.sortCol = col;
      S.page = 1;
      renderTable();
    }
    th.addEventListener('click', doSort);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSort(); } });
  });

  // Pagination
  document.getElementById('btn-prev').addEventListener('click', () => { S.page--; renderTable(); });
  document.getElementById('btn-next').addEventListener('click', () => { S.page++; renderTable(); });

  // Retry
  document.getElementById('btn-retry').addEventListener('click', loadData);

  // Trend granularity toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      S.granularity = btn.dataset.granularity;
      renderTrend(getFiltered());
    });
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/** Avatar background colour derived from name string */
function avatarColor(name) {
  const colors = ['#1e4a8a','#0d9488','#7c3aed','#db2777','#ea580c','#16a34a','#0369a1','#b45309'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/** Set the live data badge in the header */
function updateDataBadge(count) {
  const badge = document.getElementById('data-badge');
  if (!badge) return;
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  badge.innerHTML = `<span class="badge-dot"></span>${count.toLocaleString('id-ID')} data &middot; ${now}`;
}

/** Set footer stats */
function updateFooterStats(count) {
  const el = document.getElementById('footer-stats');
  if (!el) return;
  const cameras = new Set(ALL_DATA.map(r => r.nama_kamera)).size;
  const rev     = ALL_DATA.reduce((s, r) => s + r.total_bayar, 0);
  el.textContent = `${count.toLocaleString('id-ID')} transaksi · ${cameras} model kamera · Total pendapatan ${fmtRp(rev)}`;
}

/** Attach IntersectionObserver to trigger .anim-card entrance animations */
function initAnimations() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        // Stagger delay based on index within observed set
        const delay = (i % 5) * 60;
        setTimeout(() => entry.target.classList.add('visible'), delay);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.anim-card').forEach(el => io.observe(el));
}

/** Show/hide scroll-to-top button */
function initScrollTop() {
  const btn = document.getElementById('btn-top');
  window.addEventListener('scroll', () => {
    btn.classList.toggle('hidden', window.scrollY < 300);
  }, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initScrollTop();
  loadData().then(() => {
    updateDataBadge(ALL_DATA.length);
    updateFooterStats(ALL_DATA.length);
    initAnimations();
  });
});
