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
  period:   'all',   // 'all' | 'this_month' | '3_months' | 'custom'
  dateFrom: null,    // Date | null
  dateTo:   null,    // Date | null
  merek:    '',
  kategori: '',
  tipe:     '',
  sumber:   '',
  search:   '',
  sortCol:  'tanggal_sewa',
  sortDir:  'desc',
  page:     1,
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
  const n        = data.length;
  const revenue  = data.reduce((s, r) => s + r.total_bayar, 0);
  const denda    = data.reduce((s, r) => s + r.denda, 0);
  const durasi   = n ? data.reduce((s, r) => s + r.durasi_hari, 0) / n : 0;
  const lateCount = data.filter(r => r.hari_telat > 0).length;
  const latePct  = n ? (lateCount / n * 100) : 0;

  document.getElementById('kv-pendapatan').textContent = fmtRp(revenue);
  document.getElementById('kv-jumlah').textContent     = n.toLocaleString('id-ID') + ' transaksi';
  document.getElementById('kv-durasi').textContent     = durasi.toFixed(1) + ' hari';
  document.getElementById('kv-telat').textContent      = latePct.toFixed(1) + '%';
  document.getElementById('kv-denda').textContent      = fmtRp(denda);
}

// ── Insight ───────────────────────────────────────────────────────────────────

const INS_ICONS = {
  camera: `<svg class="ins-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  trend:  `<svg class="ins-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  clock:  `<svg class="ins-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

function renderInsight(data) {
  const el = document.getElementById('insight-body');
  if (!data.length) {
    el.innerHTML = '<p>Tidak ada data untuk filter yang dipilih.</p>';
    return;
  }

  const lines = [];

  // Top camera by transaction count
  const byCam = countBy(data, 'nama_kamera');
  const topCam = Object.entries(byCam).sort((a, b) => b[1] - a[1])[0];
  if (topCam)
    lines.push(`${INS_ICONS.camera} Kamera terlaris adalah <strong>${topCam[0]}</strong> dengan <strong>${topCam[1]}</strong> transaksi.`);

  // Peak month
  const byMonth = {};
  data.forEach(r => { const k = r.tanggal_sewa.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; });
  const peakM = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  if (peakM) {
    const [y, m] = peakM[0].split('-');
    const names  = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    lines.push(`${INS_ICONS.trend} Bulan paling sibuk adalah <strong>${names[+m - 1]} ${y}</strong> dengan <strong>${peakM[1]}</strong> sewa.`);
  }

  // Tipe penyewa with highest late rate
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
    lines.push(`${INS_ICONS.clock} Tipe <strong>${lateRates[0].tipe}</strong> memiliki tingkat keterlambatan tertinggi sebesar <strong>${lateRates[0].pct.toFixed(1)}%</strong>.`);

  el.innerHTML = lines.map(s => `<p>${s}</p>`).join('');
}

// ── Revenue Trend ─────────────────────────────────────────────────────────────

function renderTrend(data) {
  destroyChart('trend');
  const canvas = document.getElementById('c-trend');

  if (!data.length) {
    canvas.closest('.chart-box').innerHTML = '<p class="tbl-empty">Tidak ada data.</p>';
    return;
  }

  // Group by month
  const monthly = {};
  data.forEach(r => {
    const k = r.tanggal_sewa.slice(0, 7); // YYYY-MM
    monthly[k] = (monthly[k] || 0) + r.total_bayar;
  });
  const sorted   = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0]));
  const monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const labels   = sorted.map(([k]) => { const [y,m] = k.split('-'); return `${monthNames[+m-1]} ${y}`; });
  const values   = sorted.map(([,v]) => v);

  // Screen-reader summary
  document.getElementById('s-trend').textContent =
    `Tren pendapatan bulanan. Puncak: ${labels[values.indexOf(Math.max(...values))]} (${fmtRp(Math.max(...values))}).`;

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
    tbody.innerHTML = slice.map(r => `
      <tr>
        <td>${esc(r.id_transaksi)}</td>
        <td>${fmtDate(r.tanggal_sewa)}</td>
        <td>${esc(r.nama_penyewa)}</td>
        <td>${esc(r.nama_kamera)}</td>
        <td>${r.durasi_hari} hari</td>
        <td>${fmtRp(r.total_bayar)}</td>
        <td>${r.hari_telat > 0
              ? `<span class="badge badge-late">${r.hari_telat} hari</span>`
              : '<span class="badge badge-ok">Tepat</span>'}</td>
        <td>${esc(r.tipe_penyewa)}</td>
        <td>${esc(r.sumber_booking)}</td>
      </tr>`).join('');
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
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadData();
});
