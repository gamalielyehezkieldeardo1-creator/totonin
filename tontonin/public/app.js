/* Tontonin — frontend (vanilla JS, SPA dengan hash routing) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const CID = localStorage.cid || (localStorage.cid = uid());
const main = $('#main');
let CONFIG = { needPassword: false, maxMb: 500, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const cleanups = [];

/* ---------- penyimpanan offline (video disimpan di Cache Storage, dilayani service worker) ---------- */
const OFF_CACHE = 'tontonin-offline';
const offIds = () => { try { return JSON.parse(localStorage.offIds || '[]'); } catch { return []; } };
const offMeta = () => { try { return JSON.parse(localStorage.offMeta || '{}'); } catch { return {}; } };
async function saveOffline(v, onp) {
  if (!('caches' in window)) throw new Error('Browser tidak mendukung penyimpanan offline');
  const cache = await caches.open(OFF_CACHE);
  const r = await fetch(v.url);
  if (!r.ok || !r.body) throw new Error('Gagal mengunduh video');
  const total = +r.headers.get('content-length') || v.size || 0, reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onp && onp(total ? got / total : 0); }
  const blob = new Blob(chunks, { type: v.mime || r.headers.get('content-type') || 'video/mp4' });
  await cache.put(v.url, new Response(blob, { status: 200, headers: { 'Content-Type': blob.type, 'Content-Length': String(blob.size) } }));
  await cache.add(v.thumb).catch(() => {});
  const meta = offMeta(); meta[v.id] = { ...v, description: (v.description || '').slice(0, 1000), offlineSize: blob.size, savedAt: Date.now() };
  localStorage.offMeta = JSON.stringify(meta);
  localStorage.offIds = JSON.stringify([...new Set([...offIds(), v.id])]);
  navigator.storage?.persist?.();
}
async function removeOffline(v) {
  const cache = await caches.open(OFF_CACHE);
  await cache.delete(v.url); await cache.delete(v.thumb);
  const meta = offMeta(); delete meta[v.id]; localStorage.offMeta = JSON.stringify(meta);
  localStorage.offIds = JSON.stringify(offIds().filter(x => x !== v.id));
}
const fmtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';

/* ---------- util ---------- */
async function api(p, o = {}) {
  const h = { 'x-client-id': CID, ...(o.headers || {}) };
  let body = o.body;
  if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch('/api' + p, { method: o.method || 'GET', headers: h, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}
const fmtDur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' jt' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' rb' : String(n || 0);
const ago = t => { const s = (Date.now() - t) / 1000; for (const [a, n] of [[31536000, 'tahun'], [2592000, 'bulan'], [604800, 'minggu'], [86400, 'hari'], [3600, 'jam'], [60, 'menit']]) if (s >= a) return Math.floor(s / a) + ' ' + n + ' lalu'; return 'baru saja'; };
const getName = () => localStorage.name || '';
const initial = n => (n || '?').trim().charAt(0).toUpperCase() || '?';
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
function modal(html) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="mbox">${html}</div>`; m.onclick = e => { if (e.target === m) m.remove(); }; document.body.appendChild(m); return m; }
function ensureName() { let n = getName(); if (!n) { n = (prompt('Nama channel / nama tampilanmu:') || '').trim().slice(0, 40); if (n) { localStorage.name = n; refreshMe(); } } return n || 'Anonim'; }
function refreshMe() { $('#me').textContent = initial(getName()); }
const shareUrl = (p) => location.origin + '/' + p;
async function copy(t) { try { await navigator.clipboard.writeText(t); toast('Link disalin'); } catch { prompt('Salin link ini:', t); } }

/* ---------- iklan (buatan sendiri) ---------- */
function adMedia(ad, inPlayer) {
  if (ad.kind === 'image') return `<img src="${esc(ad.mediaUrl)}" alt="">`;
  if (ad.kind === 'video') return `<video src="${esc(ad.mediaUrl)}" ${inPlayer ? '' : 'autoplay muted loop'} playsinline preload="auto"></video>`;
  return `<div class="adtext" style="background:linear-gradient(135deg,${esc(ad.bg)},#111)"><b>${esc(ad.title)}</b><span>${esc(ad.text)}</span></div>`;
}
const adAttr = ad => `data-ad="${esc(ad.id)}" data-link="${esc(ad.link || '')}"`;
const adCard = (ad, cls = 'card') => `<div class="${cls} adcard" ${adAttr(ad)}><div class="thumb">${adMedia(ad)}<span class="adtag">Iklan</span></div><div class="meta"><div class="av ad">Ad</div><div><h3>${esc(ad.title)}</h3><p>Bersponsor • ${esc(ad.channel || '')}</p><button class="cta">${esc(ad.cta)}</button></div></div></div>`;
const adRel = ad => `<div class="rel adcard" ${adAttr(ad)}><div class="thumb">${adMedia(ad)}<span class="adtag">Iklan</span></div><div><h3>${esc(ad.title)}</h3><p>Bersponsor • ${esc(ad.channel || '')}</p><button class="cta">${esc(ad.cta)}</button></div></div>`;
const adObs = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { adObs.unobserve(e.target); api(`/ads/${e.target.dataset.ad}/impression`, { method: 'POST' }).catch(() => {}); }
}), { threshold: .6 });
const watchAds = root => $$('[data-ad]', root).forEach(n => adObs.observe(n));
document.addEventListener('click', e => {
  const n = e.target.closest('[data-ad]'); if (!n) return;
  api(`/ads/${n.dataset.ad}/click`, { method: 'POST' }).catch(() => {});
  const l = n.dataset.link; if (l) window.open(l, '_blank', 'noopener'); else if (n.dataset.ad) location.hash = '#/ads';
});
async function pickAds(slot, n = 1) { try { return await api(`/ads/pick?slot=${slot}&n=${n}`); } catch { return []; } }

/* ---------- komponen kartu ---------- */
const card = v => `<a class="card" href="#/watch/${v.id}"><div class="thumb"><img loading="lazy" src="${esc(v.thumb)}" alt=""><span class="dur">${v.isAudio ? '🎙 ' : ''}${fmtDur(v.duration)}</span></div><div class="meta"><div class="av">${esc(initial(v.channel))}</div><div><h3>${esc(v.title)}</h3><p>${esc(v.channel)}</p><p>${fmtNum(v.views)} x ditonton • ${ago(v.createdAt)}</p></div></div></a>`;
const shortCard = v => `<a class="scard" href="#/shorts/${v.id}"><div class="thumb"><img loading="lazy" src="${esc(v.thumb)}" alt=""></div><h3>${esc(v.title)}</h3><p>${fmtNum(v.views)} x ditonton</p></a>`;
const relCard = v => `<a class="rel" href="#/watch/${v.id}"><div class="thumb"><img loading="lazy" src="${esc(v.thumb)}" alt=""><span class="dur">${fmtDur(v.duration)}</span></div><div><h3>${esc(v.title)}</h3><p>${esc(v.channel)}</p><p>${fmtNum(v.views)} x • ${ago(v.createdAt)}</p></div></a>`;
const empty = (msg, btn) => `<div class="empty"><p>${msg}</p>${btn ? `<a class="btn red" href="${btn[0]}">${btn[1]}</a>` : ''}</div>`;
function withAds(items, render, ads, every = 5) {
  let h = '', k = 0;
  items.forEach((v, i) => { h += render(v); if ((i + 1) % every === 0 && ads[k]) h += adCard(ads[k++]); });
  if (items.length < every && items.length && ads[0]) h += adCard(ads[k++]);
  return h;
}

/* ---------- router ---------- */
const routes = [
  [/^\/?$/, home], [/^\/search$/, search], [/^\/watch\/([\w-]+)$/, watch], [/^\/shorts(?:\/([\w-]+))?$/, shorts],
  [/^\/live$/, liveList], [/^\/live\/([\w-]+)$/, liveWatch], [/^\/golive$/, goLive], [/^\/podcast$/, podcast],
  [/^\/playlists$/, playlists], [/^\/playlist\/([\w-]+)$/, playlistPage], [/^\/upload$/, uploadPage],
  [/^\/mine$/, minePage], [/^\/ads$/, adsPage], [/^\/offline$/, offlinePage]
];
async function route() {
  while (cleanups.length) { try { cleanups.pop()(); } catch {} }
  $('#side').classList.remove('open');
  const h = location.hash.slice(1) || '/';
  const [path, qs] = h.split('?'); const q = new URLSearchParams(qs || '');
  const nav = path === '/' ? 'home' : path.split('/')[1];
  $$('.side a').forEach(a => a.classList.toggle('act', a.dataset.nav === nav));
  window.scrollTo(0, 0);
  main.innerHTML = '<div class="empty">Memuat…</div>';
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { try { await fn(q, ...m.slice(1)); } catch (e) { console.error(e); main.innerHTML = navigator.onLine ? empty(esc(e.message)) : empty('Kamu sedang offline dan halaman ini belum tersimpan.', ['#/offline', 'Buka video tersimpan offline']); } return; }
  }
  main.innerHTML = empty('Halaman tidak ditemukan', ['#/', 'Ke Beranda']);
}
window.addEventListener('hashchange', route);
$('#menu').onclick = () => $('#side').classList.toggle('open');
$('#me').onclick = () => { const n = (prompt('Nama channel / nama tampilanmu:', getName()) || '').trim().slice(0, 40); if (n) { localStorage.name = n; refreshMe(); toast('Nama disimpan'); } };
$('#searchForm').onsubmit = e => { e.preventDefault(); const v = $('#searchInput').value.trim(); if (v) location.hash = '#/search?q=' + encodeURIComponent(v); };

/* ---------- Beranda ---------- */
async function home(q) {
  const t = q.get('t') || '';
  const [vs, ads] = await Promise.all([api('/videos?limit=100'), pickAds('feed', 8)]);
  const shorts = vs.filter(v => v.type === 'short');
  const rest = vs.filter(v => v.type !== 'short' && (!t || t === v.type));
  const chip = (k, l) => `<a class="chip ${t === k ? 'on' : ''}" href="${k === 'live' ? '#/live' : k ? '#/?t=' + k : '#/'}">${l}</a>`;
  let h = `<div class="chips">${chip('', 'Semua')}${chip('long', 'Video')}${chip('short', 'Shorts')}${chip('podcast', 'Podcast')}${chip('live', '🔴 Live')}</div>`;
  if (t === 'short') h += shorts.length ? `<div class="shelfrow" style="flex-wrap:wrap">${shorts.map(shortCard).join('')}</div>` : empty('Belum ada Shorts', ['#/upload', 'Unggah Shorts']);
  else {
    if (!t && shorts.length) h += `<section class="shelf"><h2>⚡ Shorts</h2><div class="shelfrow">${shorts.slice(0, 12).map(shortCard).join('')}</div></section>`;
    h += rest.length ? `<div class="grid">${withAds(rest, card, ads)}</div>` : (!shorts.length ? empty('Belum ada video. Jadilah yang pertama mengunggah!', ['#/upload', 'Unggah Video']) : '');
  }
  main.innerHTML = h; watchAds(main);
}
async function search(q) {
  const s = q.get('q') || ''; $('#searchInput').value = s;
  const [vs, ads] = await Promise.all([api('/videos?q=' + encodeURIComponent(s)), pickAds('feed', 4)]);
  main.innerHTML = `<h2 style="margin-bottom:16px">Hasil untuk “${esc(s)}”</h2>` + (vs.length ? `<div class="grid">${withAds(vs, card, ads, 6)}</div>` : empty('Tidak ada hasil'));
  watchAds(main);
}

/* ---------- Tonton (pemutar + iklan sela video) ---------- */
function midPoints(d) {
  if (!d || d < 150) return [];
  const pts = [];
  if (d < 360) pts.push(Math.floor(d / 2)); else for (let t = 300; t < d - 40; t += 300) pts.push(t);
  return pts;
}
function runAd(slot, layer) {
  return new Promise(async res => {
    const ads = await pickAds(slot, 1);
    if (!ads.length || !layer.isConnected) return res();
    const ad = ads[0];
    layer.hidden = false;
    layer.innerHTML = `<div class="adbox" ${adAttr(ad)}>${adMedia(ad, true)}</div><div class="adbar"><span class="adbadge">Iklan</span><span>${esc(ad.title)}${ad.text ? ' — ' + esc(ad.text) : ''}</span><button class="cta" ${adAttr(ad)}>${esc(ad.cta)}</button><button class="skip" id="adskip" disabled>Lewati dalam 5</button></div>`;
    api(`/ads/${ad.id}/impression`, { method: 'POST' }).catch(() => {});
    let t = 0, done = false;
    const skip = $('#adskip', layer), vEl = $('video', layer);
    const finish = () => { if (done) return; done = true; clearInterval(iv); layer.hidden = true; layer.innerHTML = ''; res(); };
    const iv = setInterval(() => {
      t++;
      if (t >= 5) { skip.disabled = false; skip.textContent = 'Lewati iklan ›'; } else skip.textContent = 'Lewati dalam ' + (5 - t);
      if (ad.kind !== 'video' && t >= 8) finish();
      if (ad.kind === 'video' && t >= 45) finish();
    }, 1000);
    skip.onclick = e => { e.stopPropagation(); finish(); };
    if (vEl) { vEl.onended = finish; vEl.onerror = finish; vEl.play().catch(() => { vEl.muted = true; vEl.play().catch(finish); }); }
    cleanups.push(finish);
  });
}

async function watch(q, id) {
  const listId = q.get('list');
  const [v, all, comments, myPls, pl] = await Promise.all([
    api('/videos/' + id).catch(e => { const m = offMeta()[id]; if (m) return m; throw e; }), // saat offline pakai data tersimpan
    api('/videos?limit=60').catch(() => []), api(`/videos/${id}/comments`).catch(() => []), api('/playlists?mine=1').catch(() => []),
    listId ? api('/playlists/' + listId).catch(() => null) : null
  ]);
  const relAds = await pickAds('feed', 1);
  const related = all.filter(x => x.id !== v.id && x.type !== 'short').slice(0, 14);
  document.title = v.title + ' – Tontonin';
  cleanups.push(() => { document.title = 'Tontonin'; });
  let plIdx = pl ? pl.videos.findIndex(x => x.id === v.id) : -1;
  const plHtml = pl ? `<div class="plpanel"><header>${esc(pl.title)} • ${plIdx + 1}/${pl.videos.length}</header>${pl.videos.map((x, i) => `<a class="rel ${x.id === v.id ? 'cur' : ''}" href="#/watch/${x.id}?list=${pl.id}"><div class="thumb"><img src="${esc(x.thumb)}" alt=""><span class="dur">${fmtDur(x.duration)}</span></div><div><h3>${esc(x.title)}</h3><p>${esc(x.channel)}</p></div></a>`).join('')}</div>` : '';
  const sideRel = related.map((x, i) => relCard(x) + (i === 1 && relAds[0] ? adRel(relAds[0]) : '')).join('') || (relAds[0] ? adRel(relAds[0]) : '');
  main.innerHTML = `<div class="watch"><div>
    <div class="player ${v.isAudio ? 'audio' : ''}" id="player"><video id="vid" src="${esc(v.url)}" poster="${esc(v.thumb)}" controls playsinline preload="metadata"></video><div class="adlayer" id="adlayer" hidden></div></div>
    <h1 class="wtitle">${v.type === 'podcast' ? '🎙️ ' : ''}${esc(v.title)}</h1>
    <div class="wrow"><div class="chan"><div class="av">${esc(initial(v.channel))}</div><div><b>${esc(v.channel)}</b><small>${fmtNum(v.views)} x ditonton • ${ago(v.createdAt)}</small></div></div>
    <div class="acts"><button class="btn ${v.liked ? 'on' : ''}" id="like">👍 <span>${v.likes}</span></button><button class="btn" id="share">↗ Bagikan</button><button class="btn" id="save">＋ Simpan</button><button class="btn" id="offbtn">⬇ Offline</button>${v.mine ? '<button class="btn" id="del">🗑 Hapus</button>' : ''}</div></div>
    <div class="desc"><b>${v.type === 'long' ? 'Video' : v.type === 'podcast' ? 'Episode podcast' : 'Shorts'} • ${fmtDur(v.duration)}</b>${esc(v.description) || '<span style="color:var(--tx2)">Tanpa deskripsi.</span>'}${v.tags?.length ? `<p style="color:var(--ac)">${v.tags.map(t => '#' + esc(t.replace(/\s+/g, ''))).join(' ')}</p>` : ''}</div>
    <section class="comments"><h3>${comments.length} Komentar</h3>
      <form class="cform" id="cform"><input name="name" placeholder="Nama" value="${esc(getName())}" maxlength="40"><input name="text" placeholder="Tulis komentar…" maxlength="1000" required><button class="btn red">Kirim</button></form>
      <div id="clist">${comments.map(cmHtml).join('')}</div></section>
  </div><aside>${plHtml}${sideRel}</aside></div>`;
  watchAds(main);

  const vid = $('#vid'), layer = $('#adlayer');
  const mids = midPoints(v.duration); const played = new Set();
  let pre = false, inAd = false, counted = false;
  const withAd = async slot => { inAd = true; vid.pause(); await runAd(slot, layer); inAd = false; vid.play().catch(() => {}); };
  vid.addEventListener('play', () => { if (!pre) { pre = true; withAd('pre'); } });
  vid.addEventListener('timeupdate', () => {
    const ct = vid.currentTime;
    if (!counted && ct > 5) { counted = true; api(`/videos/${v.id}/view`, { method: 'POST' }).catch(() => {}); }
    if (inAd) return;
    for (const p of mids) if (!played.has(p) && ct >= p) { played.add(p); if (ct < p + 2) withAd('mid'); break; }
  });
  vid.addEventListener('ended', () => {
    if (pl && plIdx >= 0 && pl.videos[plIdx + 1]) location.hash = `#/watch/${pl.videos[plIdx + 1].id}?list=${pl.id}`;
  });
  vid.play().catch(() => {});
  cleanups.push(() => { vid.pause(); vid.removeAttribute('src'); vid.load(); });

  $('#like').onclick = async () => { try { const r = await api(`/videos/${v.id}/like`, { method: 'POST' }); $('#like span').textContent = r.likes; $('#like').classList.toggle('on', r.liked); } catch (e) { toast(e.message); } };
  $('#share').onclick = () => copy(shareUrl('#/watch/' + v.id));
  $('#del') && ($('#del').onclick = async () => { if (confirm('Hapus video ini permanen?')) { await api('/videos/' + v.id, { method: 'DELETE' }); toast('Video dihapus'); location.hash = '#/mine'; } });
  $('#save').onclick = () => navigator.onLine ? savePlaylistModal(v.id, myPls) : toast('Sedang offline');
  const ob = $('#offbtn'), setOb = () => { const on = offIds().includes(v.id); ob.textContent = on ? '✓ Tersimpan offline' : '⬇ Offline'; ob.classList.toggle('on', on); };
  setOb();
  ob.onclick = async () => {
    if (offIds().includes(v.id)) { await removeOffline(v); setOb(); toast('Dihapus dari penyimpanan offline'); return; }
    if (!navigator.onLine) return toast('Sedang offline');
    ob.disabled = true;
    try { await saveOffline(v, p => { ob.textContent = '⬇ ' + Math.round(p * 100) + '%'; }); toast('Tersimpan — bisa ditonton tanpa internet'); }
    catch (e) { toast(e.name === 'QuotaExceededError' ? 'Penyimpanan perangkat penuh' : e.message); }
    ob.disabled = false; setOb();
  };
  $('#cform').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try {
      if (f.name.value.trim()) localStorage.name = f.name.value.trim(); refreshMe();
      const c = await api(`/videos/${v.id}/comments`, { method: 'POST', body: { name: f.name.value, text: f.text.value } });
      $('#clist').insertAdjacentHTML('afterbegin', cmHtml(c)); f.text.value = '';
    } catch (er) { toast(er.message); }
  };
}
const cmHtml = c => `<div class="cm"><div class="av">${esc(initial(c.name))}</div><div><b>${esc(c.name)}</b> <small>${ago(c.createdAt)}</small><p>${esc(c.text)}</p></div></div>`;
function savePlaylistModal(videoId, pls) {
  const m = modal(`<h3>Simpan ke playlist</h3><div id="pls">${pls.length ? pls.map(p => `<label class="pl"><input type="checkbox" data-p="${p.id}" ${p.videoIds.includes(videoId) ? 'checked' : ''}> ${esc(p.title)} <small style="color:var(--tx2)">(${p.count})</small></label>`).join('') : '<p style="color:var(--tx2)">Kamu belum punya playlist.</p>'}</div>
    <form id="npl" style="display:flex;gap:6px;margin-top:12px"><input name="t" placeholder="Nama playlist baru" style="flex:1" maxlength="100"><button class="btn red">Buat</button></form>`);
  m.addEventListener('change', async e => {
    const p = e.target.dataset.p; if (!p) return;
    try { await (e.target.checked ? api(`/playlists/${p}/videos`, { method: 'POST', body: { videoId } }) : api(`/playlists/${p}/videos/${videoId}`, { method: 'DELETE' })); toast(e.target.checked ? 'Ditambahkan' : 'Dihapus dari playlist'); } catch (er) { toast(er.message); e.target.checked = !e.target.checked; }
  });
  $('#npl', m).onsubmit = async e => {
    e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return;
    try { const p = await api('/playlists', { method: 'POST', body: { title: t, channel: ensureName() } }); await api(`/playlists/${p.id}/videos`, { method: 'POST', body: { videoId } }); toast('Playlist dibuat & video disimpan'); m.remove(); } catch (er) { toast(er.message); }
  };
}

/* ---------- Shorts ---------- */
async function shorts(q, startId) {
  const [vs, ads] = await Promise.all([api('/videos?type=short&limit=60'), pickAds('short', 12)]);
  if (!vs.length) { main.innerHTML = empty('Belum ada Shorts', ['#/upload', 'Unggah Shorts']); return; }
  if (startId) { const i = vs.findIndex(v => v.id === startId); if (i > 0) vs.unshift(...vs.splice(i, 1)); }
  let h = '', k = 0;
  vs.forEach((v, i) => {
    h += `<section class="short" data-id="${v.id}"><video src="${esc(v.url)}" poster="${esc(v.thumb)}" loop playsinline preload="metadata"></video>
      <div class="sinfo"><b>@${esc(v.channel)}</b><p>${esc(v.title)}</p></div>
      <div class="sact"><button data-like="${v.id}" class="${v.liked ? 'on' : ''}">♥<small>${v.likes}</small></button><button data-share="${v.id}">↗<small>Bagikan</small></button><button data-mute>🔊</button></div></section>`;
    if ((i + 1) % 3 === 0 && ads[k]) { const a = ads[k++]; h += `<section class="short adslide" ${adAttr(a)}><div class="adfull">${adMedia(a)}</div><div class="sinfo"><span class="adbadge">Iklan</span><p><b>${esc(a.title)}</b></p><p>${esc(a.text)}</p><button class="cta">${esc(a.cta)}</button></div></section>`; }
  });
  main.innerHTML = `<div class="shorts" id="sh">${h}</div><div class="sctl"><button id="sup">↑</button><button id="sdn">↓</button></div>`;
  watchAds(main);
  const box = $('#sh'); let muted = false; const counted = new Set();
  const io = new IntersectionObserver(es => es.forEach(e => {
    const vd = $('video', e.target); if (!vd || e.target.classList.contains('adslide')) return;
    if (e.isIntersecting) {
      vd.muted = muted; vd.play().catch(() => { vd.muted = true; vd.play().catch(() => {}); });
      const id = e.target.dataset.id;
      if (!counted.has(id)) { counted.add(id); api(`/videos/${id}/view`, { method: 'POST' }).catch(() => {}); }
    } else vd.pause();
  }), { root: box, threshold: .7 });
  $$('.short', box).forEach(s => io.observe(s));
  cleanups.push(() => { io.disconnect(); $$('video', box).forEach(v => v.pause()); });
  box.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.like) { try { const r = await api(`/videos/${b.dataset.like}/like`, { method: 'POST' }); $('small', b).textContent = r.likes; b.classList.toggle('on', r.liked); } catch (er) { toast(er.message); } }
    else if (b.dataset.share) copy(shareUrl('#/shorts/' + b.dataset.share));
    else if ('mute' in b.dataset) { muted = !muted; $$('.short video', box).forEach(v => v.muted = muted); $$('[data-mute]', box).forEach(x => x.textContent = muted ? '🔇' : '🔊'); }
    else if (b.classList.contains('cta')) return;
  });
  const step = d => box.scrollBy({ top: d * box.clientHeight, behavior: 'smooth' });
  $('#sup').onclick = () => step(-1); $('#sdn').onclick = () => step(1);
  const key = e => { if (e.key === 'ArrowDown') { e.preventDefault(); step(1); } if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); } };
  document.addEventListener('keydown', key); cleanups.push(() => document.removeEventListener('keydown', key));
}

/* ---------- Podcast ---------- */
async function podcast() {
  const [vs, ads] = await Promise.all([api('/videos?type=podcast'), pickAds('feed', 3)]);
  let h = `<div class="panel" style="max-width:900px"><h1>🎙️ Podcast</h1>`;
  if (!vs.length) h += empty('Belum ada episode podcast', ['#/upload', 'Unggah Episode']);
  else vs.forEach((v, i) => {
    h += `<a class="rel" href="#/watch/${v.id}" style="padding:10px;background:var(--bg2);border-radius:12px;gap:14px"><div class="thumb" style="width:150px;aspect-ratio:1/1"><img src="${esc(v.thumb)}" loading="lazy" alt=""></div><div><h3 style="font-size:17px">${esc(v.title)}</h3><p>${esc(v.channel)} • ${fmtDur(v.duration)} • ${ago(v.createdAt)}</p><p style="-webkit-line-clamp:3;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">${esc(v.description)}</p></div></a>`;
    if ((i + 1) % 4 === 0 && ads[0]) h += adRel(ads[0]);
  });
  main.innerHTML = h + '</div>'; watchAds(main);
}

/* ---------- Live (WebRTC) ---------- */
const wsUrl = () => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
async function liveList() {
  const draw = async () => {
    const l = await api('/live').catch(() => []);
    if (!main.querySelector('#livebox')) return;
    $('#livebox').innerHTML = l.length ? `<div class="grid livegrid">${l.map(x => `<a class="card" href="#/live/${x.id}"><div class="thumb"><div class="livecover">${esc(x.title)}</div><span class="badge">● LIVE</span><span class="dur">👁 ${x.viewers}</span></div><div class="meta"><div class="av">${esc(initial(x.channel))}</div><div><h3>${esc(x.title)}</h3><p>${esc(x.channel)} • mulai ${ago(x.startedAt)}</p></div></div></a>`).join('')}</div>` : empty('Tidak ada siaran langsung sekarang.', ['#/golive', '● Mulai Live']);
  };
  main.innerHTML = `<h2 style="margin-bottom:16px">🔴 Siaran Langsung</h2><div id="livebox"></div>`;
  await draw(); const iv = setInterval(draw, 8000); cleanups.push(() => clearInterval(iv));
}
function chatUI(ws) {
  const add = m => { const log = $('#chatlog'); if (!log) return; log.insertAdjacentHTML('beforeend', `<p><b class="${m.host ? 'h' : ''}">${esc(m.name)}${m.host ? ' (host)' : ''}</b> ${esc(m.text)}</p>`); log.scrollTop = log.scrollHeight; };
  const f = $('#chatform');
  f.onsubmit = e => { e.preventDefault(); const t = f.t.value.trim(); if (!t) return; ws.send(JSON.stringify({ t: 'chat', text: t, name: getName() || 'Penonton' })); f.t.value = ''; };
  return add;
}
const chatHtml = `<div class="chatbox"><header>Obrolan Langsung</header><div class="chatlog" id="chatlog"></div><form id="chatform"><input name="t" placeholder="Ketik pesan…" maxlength="200" autocomplete="off"><button class="btn red sm">Kirim</button></form></div>`;

async function liveWatch(q, id) {
  main.innerHTML = `<div class="liveview"><div><div class="player" id="player"><video id="lv" autoplay playsinline controls></video></div><h1 class="wtitle" id="ltitle">Menyambung…</h1><div class="wrow"><div class="chan"><div class="av" id="lav">?</div><div><b id="lch"></b><small id="lvw">👁 0 menonton</small></div></div><div class="acts"><button class="btn" id="lshare">↗ Bagikan</button></div></div></div><aside>${chatHtml}</aside></div>`;
  const ws = new WebSocket(wsUrl()); const add = chatUI(ws);
  const video = $('#lv'); let pc = null, chain = Promise.resolve(), ended = false, bannerTimer = null;
  const player = $('#player');
  const showBanner = async () => {
    const ads = await pickAds('live', 1); if (!ads.length || !player.isConnected) return; const a = ads[0];
    const b = document.createElement('div'); b.className = 'banner'; b.setAttribute('data-ad', a.id); b.setAttribute('data-link', a.link || '');
    b.innerHTML = `<span class="adbadge">Iklan</span><b>${esc(a.title)}</b><span style="opacity:.8">${esc(a.text)}</span><button class="cta">${esc(a.cta)}</button><button class="x" aria-label="Tutup">✕</button>`;
    $('.x', b).onclick = e => { e.stopPropagation(); b.remove(); };
    player.appendChild(b); api(`/ads/${a.id}/impression`, { method: 'POST' }).catch(() => {}); setTimeout(() => b.remove(), 12000);
  };
  const handle = async m => {
    if (m.t === 'joined') {
      $('#ltitle').textContent = '🔴 ' + m.title; $('#lch').textContent = m.channel; $('#lav').textContent = initial(m.channel); document.title = m.title + ' – LIVE';
      bannerTimer = setInterval(showBanner, 90000); setTimeout(showBanner, 15000);
    } else if (m.t === 'signal') {
      if (!pc) {
        pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
        pc.ontrack = e => { video.srcObject = e.streams[0]; video.play().catch(() => { video.muted = true; video.play().catch(() => {}); }); };
        pc.onicecandidate = e => e.candidate && ws.send(JSON.stringify({ t: 'signal', data: { candidate: e.candidate } }));
      }
      const d = m.data;
      if (d.sdp) { await pc.setRemoteDescription(d.sdp); if (d.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); ws.send(JSON.stringify({ t: 'signal', data: { sdp: pc.localDescription } })); } }
      if (d.candidate) await pc.addIceCandidate(d.candidate).catch(() => {});
    } else if (m.t === 'viewers') $('#lvw').textContent = `👁 ${m.n} menonton`;
    else if (m.t === 'chat') add(m);
    else if (m.t === 'ended') { ended = true; $('#ltitle').textContent = 'Siaran telah selesai'; video.srcObject = null; if (pc) pc.close(); }
    else if (m.t === 'error') { $('#ltitle').textContent = m.msg; }
  };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', id }));
  ws.onmessage = e => { const m = JSON.parse(e.data); chain = chain.then(() => handle(m)).catch(console.error); };
  ws.onclose = () => { if (!ended && $('#ltitle') && $('#ltitle').textContent === 'Menyambung…') $('#ltitle').textContent = 'Koneksi terputus'; };
  $('#lshare').onclick = () => copy(shareUrl('#/live/' + id));
  cleanups.push(() => { clearInterval(bannerTimer); ws.close(); if (pc) pc.close(); document.title = 'Tontonin'; });
}

async function goLive() {
  if (!navigator.mediaDevices?.getUserMedia) { main.innerHTML = empty('Browser/alamat ini tidak mendukung siaran langsung. Buka lewat HTTPS atau localhost.'); return; }
  main.innerHTML = `<div class="panel"><h1>🔴 Mulai Siaran Langsung</h1>
    <div class="field"><label>Judul siaran</label><input id="lt" maxlength="100" placeholder="Misal: Ngobrol santai malam ini"></div>
    <div class="field"><label>Sumber</label><div class="seg"><label><input type="radio" name="src" value="cam" checked><b>📷 Kamera + Mikrofon</b><small>Untuk ngobrol / vlog</small></label><label><input type="radio" name="src" value="screen"><b>🖥️ Layar</b><small>Untuk gaming / presentasi</small></label></div></div>
    ${CONFIG.needPassword ? '<div class="field"><label>Password siaran</label><input id="lpw" type="password"></div>' : ''}
    <button class="btn red" id="lgo">Mulai Live</button><div id="lmsg"></div></div>`;
  $('#lgo').onclick = async () => {
    const title = $('#lt').value.trim(); if (!title) return toast('Isi judul siaran dulu');
    const src = $('input[name=src]:checked').value; let stream;
    try {
      if (src === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); mic.getAudioTracks().forEach(t => stream.addTrack(t)); } catch {}
      } else stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
    } catch (e) { $('#lmsg').innerHTML = `<div class="msg err">Tidak bisa mengakses perangkat: ${esc(e.message)}</div>`; return; }
    const channel = ensureName();
    main.innerHTML = `<div class="liveview"><div><div class="player"><video id="pv" autoplay muted playsinline></video></div><h1 class="wtitle">🔴 ${esc(title)}</h1><div class="wrow"><div id="lstat" class="msg" style="margin:0">Menyambung ke server…</div><div class="acts"><button class="btn" id="lcopy" disabled>↗ Salin link siaran</button><button class="btn red" id="lstop">■ Akhiri siaran</button></div></div></div><aside>${chatHtml}</aside></div>`;
    $('#pv').srcObject = stream;
    const ws = new WebSocket(wsUrl()); const add = chatUI(ws); const pcs = new Map(); let chain = Promise.resolve(), liveId = null;
    const stop = () => { stream.getTracks().forEach(t => t.stop()); pcs.forEach(p => p.close()); try { ws.close(); } catch {} };
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { stop(); location.hash = '#/live'; });
    const handle = async m => {
      if (m.t === 'started') { liveId = m.id; $('#lstat').textContent = '● Sedang siaran • 👁 0 menonton'; $('#lcopy').disabled = false; $('#lcopy').onclick = () => copy(shareUrl('#/live/' + liveId)); }
      else if (m.t === 'error') { $('#lstat').className = 'msg err'; $('#lstat').textContent = m.msg; stream.getTracks().forEach(t => t.stop()); }
      else if (m.t === 'viewer-join') {
        const pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers }); pcs.set(m.vid, pc);
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        pc.onicecandidate = e => e.candidate && ws.send(JSON.stringify({ t: 'signal', vid: m.vid, data: { candidate: e.candidate } }));
        const off = await pc.createOffer(); await pc.setLocalDescription(off);
        ws.send(JSON.stringify({ t: 'signal', vid: m.vid, data: { sdp: pc.localDescription } }));
      } else if (m.t === 'signal') {
        const pc = pcs.get(m.vid); if (!pc) return;
        if (m.data.sdp) await pc.setRemoteDescription(m.data.sdp);
        if (m.data.candidate) await pc.addIceCandidate(m.data.candidate).catch(() => {});
      } else if (m.t === 'viewer-left') { pcs.get(m.vid)?.close(); pcs.delete(m.vid); }
      else if (m.t === 'viewers') $('#lstat').textContent = `● Sedang siaran • 👁 ${m.n} menonton`;
      else if (m.t === 'chat') add(m);
    };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'start', title, channel, password: $('#lpw')?.value || localStorage.upw || '' }));
    ws.onmessage = e => { const m = JSON.parse(e.data); chain = chain.then(() => handle(m)).catch(console.error); };
    ws.onclose = () => { const s = $('#lstat'); if (s && !s.classList.contains('err')) s.textContent = 'Siaran berhenti'; };
    $('#lstop').onclick = () => { stop(); toast('Siaran diakhiri'); location.hash = '#/live'; };
    cleanups.push(stop);
  };
}

/* ---------- Playlist ---------- */
async function playlists() {
  const pls = await api('/playlists');
  main.innerHTML = `<div class="wrow" style="margin-bottom:16px"><h2>📑 Playlist</h2><button class="btn red" id="newpl">＋ Playlist baru</button></div>` +
    (pls.length ? `<div class="grid">${pls.map(p => `<a class="card" href="#/playlist/${p.id}"><div class="thumb"><img src="${esc(p.cover)}" alt=""><span class="dur">${p.count} video</span></div><div class="meta"><div><h3>${esc(p.title)}</h3><p>${esc(p.channel)} • ${ago(p.createdAt)}</p></div></div></a>`).join('')}</div>` : empty('Belum ada playlist'));
  $('#newpl').onclick = () => {
    const m = modal(`<h3>Playlist baru</h3><form id="f"><div class="field"><input name="t" placeholder="Nama playlist" required maxlength="100"></div><div class="field"><textarea name="d" rows="3" placeholder="Deskripsi (opsional)" maxlength="500"></textarea></div><button class="btn red">Buat</button></form>`);
    $('#f', m).onsubmit = async e => { e.preventDefault(); try { const p = await api('/playlists', { method: 'POST', body: { title: e.target.t.value, description: e.target.d.value, channel: ensureName() } }); m.remove(); location.hash = '#/playlist/' + p.id; } catch (er) { toast(er.message); } };
  };
}
async function playlistPage(q, id) {
  const p = await api('/playlists/' + id);
  main.innerHTML = `<div class="panel" style="max-width:900px"><div class="wrow"><div><h1>${esc(p.title)}</h1><p style="color:var(--tx2)">${esc(p.channel)} • ${p.count} video</p><p>${esc(p.description)}</p></div><div class="acts">${p.count ? `<a class="btn red" href="#/watch/${p.videos[0].id}?list=${p.id}">▶ Putar semua</a>` : ''}<button class="btn" id="pshare">↗ Bagikan</button>${p.mine ? '<button class="btn" id="pdel">🗑 Hapus playlist</button>' : ''}</div></div><div style="margin-top:18px">${p.videos.length ? p.videos.map(v => `<div class="rel" style="align-items:center"><a href="#/watch/${v.id}?list=${p.id}" class="rel" style="margin:0;flex:1"><div class="thumb"><img src="${esc(v.thumb)}" alt=""><span class="dur">${fmtDur(v.duration)}</span></div><div><h3>${esc(v.title)}</h3><p>${esc(v.channel)} • ${fmtNum(v.views)} x ditonton</p></div></a>${p.mine ? `<button class="btn sm" data-rm="${v.id}">Keluarkan</button>` : ''}</div>`).join('') : empty('Playlist ini masih kosong. Buka video lalu klik “Simpan”.')}</div></div>`;
  $('#pshare').onclick = () => copy(shareUrl('#/playlist/' + p.id));
  $('#pdel') && ($('#pdel').onclick = async () => { if (confirm('Hapus playlist ini?')) { await api('/playlists/' + p.id, { method: 'DELETE' }); location.hash = '#/playlists'; } });
  $$('[data-rm]').forEach(b => b.onclick = async () => { await api(`/playlists/${p.id}/videos/${b.dataset.rm}`, { method: 'DELETE' }); route(); });
}

/* ---------- Upload ---------- */
function probe(file) {
  return new Promise(res => {
    const isV = file.type.startsWith('video/'), url = URL.createObjectURL(file);
    const m = document.createElement(isV ? 'video' : 'audio'); m.preload = 'metadata'; m.muted = true; m.src = url;
    const fin = r => { URL.revokeObjectURL(url); res(r); };
    const to = setTimeout(() => fin({ duration: 0, thumb: null, w: 0, h: 0 }), 15000);
    m.onerror = () => { clearTimeout(to); fin({ duration: 0, thumb: null, w: 0, h: 0 }); };
    m.onloadedmetadata = () => { if (!isV) { clearTimeout(to); fin({ duration: m.duration || 0, thumb: null, w: 0, h: 0 }); } else m.currentTime = Math.min(1, (m.duration || 2) / 2); };
    m.onseeked = () => {
      clearTimeout(to);
      const w = m.videoWidth, h = m.videoHeight, sc = Math.min(1, 720 / Math.max(w, h || 1)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
      c.getContext('2d').drawImage(m, 0, 0, c.width, c.height);
      c.toBlob(b => fin({ duration: m.duration || 0, thumb: b, w, h }), 'image/jpeg', .82);
    };
  });
}
function coverFor(title) {
  return new Promise(res => {
    const c = document.createElement('canvas'); c.width = c.height = 720; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 720, 720); g.addColorStop(0, '#4c1d95'); g.addColorStop(1, '#db2777'); x.fillStyle = g; x.fillRect(0, 0, 720, 720);
    x.fillStyle = '#fff'; x.font = '700 54px system-ui,sans-serif'; x.textAlign = 'center'; x.fillText('🎙️', 360, 280);
    x.font = '700 42px system-ui,sans-serif'; const words = title.split(' '); let line = '', y = 380;
    for (const w of words) { if (x.measureText(line + w).width > 600) { x.fillText(line, 360, y); y += 54; line = ''; } line += w + ' '; if (y > 600) break; }
    x.fillText(line.trim(), 360, y); c.toBlob(res, 'image/jpeg', .85);
  });
}
async function uploadPage() {
  main.innerHTML = `<div class="panel"><h1>⬆️ Unggah</h1><form id="uf">
    <div class="field"><label>Format</label><div class="seg">
      <label><input type="radio" name="type" value="long" checked><b>🎬 Video panjang</b><small>Tampil di Beranda</small></label>
      <label><input type="radio" name="type" value="short"><b>⚡ Shorts</b><small>Maks 3 menit, disarankan vertikal</small></label>
      <label><input type="radio" name="type" value="podcast"><b>🎙️ Podcast</b><small>Audio (mp3/m4a) atau video</small></label></div></div>
    <div class="field"><label>File (maks ${CONFIG.maxMb} MB)</label><input type="file" name="file" accept="video/*,audio/*" required><small>Paling aman: MP4 (H.264/AAC), WebM, MP3, M4A — format yang bisa diputar langsung oleh browser.</small></div>
    <div class="field"><label>Judul</label><input name="title" maxlength="120" required></div>
    <div class="field"><label>Deskripsi</label><textarea name="description" rows="4" maxlength="5000"></textarea></div>
    <div class="field"><label>Tag (pisahkan koma)</label><input name="tags" maxlength="200" placeholder="vlog, musik, tutorial"></div>
    <div class="field"><label>Nama channel</label><input name="channel" maxlength="40" value="${esc(getName())}" required></div>
    <div class="field"><label>Cover / thumbnail (opsional)</label><input type="file" name="thumbf" accept="image/*"><small>Kosongkan untuk dibuat otomatis dari video.</small></div>
    ${CONFIG.needPassword ? '<div class="field"><label>Password unggah</label><input type="password" name="pw" value="' + esc(localStorage.upw || '') + '" required></div>' : ''}
    <button class="btn red" id="ubtn">Unggah</button><div class="prog" id="uprog" hidden><i></i></div><div id="umsg"></div></form></div>`;
  $('#uf').onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = $('#ubtn'), msg = $('#umsg');
    const file = f.file.files[0]; if (!file) return;
    if (file.size > CONFIG.maxMb * 1048576) { msg.innerHTML = `<div class="msg err">File lebih dari ${CONFIG.maxMb} MB.</div>`; return; }
    btn.disabled = true; msg.innerHTML = '<div class="msg">Membaca file…</div>';
    const info = await probe(file); const type = f.type.value;
    if (!info.duration) { msg.innerHTML = '<div class="msg err">Browser tidak bisa membaca file ini. Ubah dulu ke MP4 (H.264/AAC) atau MP3.</div>'; btn.disabled = false; return; }
    if (type === 'short' && info.duration > 185) { msg.innerHTML = '<div class="msg err">Shorts maksimal 3 menit. Pilih format “Video panjang” untuk video ini.</div>'; btn.disabled = false; return; }
    localStorage.name = f.channel.value.trim(); refreshMe(); if (f.pw) localStorage.upw = f.pw.value;
    const fd = new FormData();
    fd.append('type', type); fd.append('title', f.title.value); fd.append('description', f.description.value); fd.append('tags', f.tags.value);
    fd.append('channel', f.channel.value); fd.append('duration', info.duration);
    fd.append('file', file);
    const cover = f.thumbf.files[0] || info.thumb || await coverFor(f.title.value);
    fd.append('thumb', cover, 'thumb.jpg');
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/videos');
    xhr.setRequestHeader('x-client-id', CID); if (f.pw) xhr.setRequestHeader('x-upload-password', f.pw.value);
    const pg = $('#uprog'); pg.hidden = false;
    xhr.upload.onprogress = ev => { if (ev.lengthComputable) { const p = Math.round(ev.loaded / ev.total * 100); $('i', pg).style.width = p + '%'; msg.innerHTML = `<div class="msg">Mengunggah… ${p}%</div>`; } };
    xhr.onload = () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200) { toast('Berhasil diunggah!'); location.hash = type === 'short' ? '#/shorts/' + j.id : '#/watch/' + j.id; }
      else { msg.innerHTML = `<div class="msg err">${esc(j.error || 'Gagal mengunggah (' + xhr.status + ')')}</div>`; btn.disabled = false; }
    };
    xhr.onerror = () => { msg.innerHTML = '<div class="msg err">Koneksi terputus saat mengunggah. Coba lagi.</div>'; btn.disabled = false; };
    xhr.send(fd);
  };
}

/* ---------- Video Saya ---------- */
async function minePage() {
  const vs = await api('/videos?mine=1');
  main.innerHTML = `<div class="panel" style="max-width:1000px"><div class="wrow"><h1>🎬 Video Saya</h1><a class="btn red" href="#/upload">＋ Unggah</a></div>` + (vs.length ? `<table class="table"><tr><th></th><th>Judul</th><th>Format</th><th>Tayang</th><th>Suka</th><th></th></tr>${vs.map(v => `<tr><td><div class="mini"><img src="${esc(v.thumb)}" alt=""></div></td><td><a href="#/${v.type === 'short' ? 'shorts' : 'watch'}/${v.id}"><b>${esc(v.title)}</b></a><br><small style="color:var(--tx2)">${ago(v.createdAt)}</small></td><td>${{ long: 'Video', short: 'Shorts', podcast: 'Podcast' }[v.type]}</td><td>${v.views}</td><td>${v.likes}</td><td><button class="btn sm" data-del="${v.id}">Hapus</button></td></tr>`).join('')}</table>` : empty('Kamu belum mengunggah apa pun di browser ini.')) + `<p style="color:var(--tx2);margin-top:16px">Catatan: kepemilikan dikenali lewat browser ini. Jika data browser dihapus, kamu tidak bisa lagi mengelola video lama.</p></div>`;
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Hapus permanen?')) { await api('/videos/' + b.dataset.del, { method: 'DELETE' }); route(); } });
}

/* ---------- Studio Iklan ---------- */
async function adsPage() {
  const mine = await api('/ads/mine');
  const pls = [['pre', 'Sebelum video (pre-roll)'], ['mid', 'Di tengah video (mid-roll)'], ['feed', 'Di Beranda & sidebar'], ['short', 'Di antara Shorts'], ['live', 'Banner saat Live']];
  main.innerHTML = `<div class="panel" style="max-width:1000px"><h1>📢 Studio Iklan</h1><p style="color:var(--tx2);margin-top:-8px">Buat iklanmu sendiri. Iklan akan disisipkan di sela-sela video, Shorts, Beranda, dan siaran langsung.</p>
  <div class="two"><form id="af">
    <div class="field"><label>Jenis iklan</label><div class="seg"><label><input type="radio" name="kind" value="text" checked><b>Teks</b></label><label><input type="radio" name="kind" value="image"><b>Gambar</b></label><label><input type="radio" name="kind" value="video"><b>Video</b></label></div></div>
    <div class="field" id="fileF" hidden><label>File iklan</label><input type="file" name="ad" accept="image/*,video/*"></div>
    <div class="field"><label>Judul</label><input name="title" maxlength="80" required placeholder="Diskon 50% hari ini!"></div>
    <div class="field"><label>Teks pendukung</label><input name="text" maxlength="200" placeholder="Khusus pembelian online"></div>
    <div class="field"><label>Tombol</label><input name="cta" maxlength="24" value="Selengkapnya"></div>
    <div class="field"><label>Link tujuan</label><input name="link" placeholder="https://tokomu.com"></div>
    <div class="field"><label>Warna latar (iklan teks)</label><input type="color" name="bg" value="#7c3aed" style="height:40px;padding:2px"></div>
    <div class="field"><label>Tampil di</label><div class="row">${pls.map(([k, l]) => `<label><input type="checkbox" name="pl" value="${k}" checked> ${l}</label>`).join('')}</div></div>
    ${CONFIG.needPassword ? '<div class="field"><label>Password unggah</label><input type="password" name="pw" value="' + esc(localStorage.upw || '') + '" required></div>' : ''}
    <button class="btn red" id="abtn">Terbitkan Iklan</button><div id="amsg"></div></form>
    <div><b>Pratinjau</b><div id="apv" style="margin-top:10px;max-width:340px"></div></div></div>
  <h2 style="margin-top:30px">Iklan saya</h2>
  ${mine.length ? `<table class="table"><tr><th></th><th>Iklan</th><th>Tayang</th><th>Klik</th><th>CTR</th><th></th></tr>${mine.map(a => `<tr><td><div class="mini">${a.kind === 'text' ? `<div class="adtext" style="background:${esc(a.bg)};font-size:9px;padding:6px"><b style="font-size:11px">${esc(a.title)}</b></div>` : adMedia({ ...a }, true).replace('<video', '<video muted')}</div></td><td><b>${esc(a.title)}</b><br><small style="color:var(--tx2)">${a.placements.join(', ')} ${a.active ? '' : '• DIJEDA'}</small></td><td>${a.impressions}</td><td>${a.clicks}</td><td>${a.impressions ? (a.clicks / a.impressions * 100).toFixed(1) + '%' : '-'}</td><td style="white-space:nowrap"><button class="btn sm" data-tg="${a.id}">${a.active ? 'Jeda' : 'Aktifkan'}</button> <button class="btn sm" data-ad-del="${a.id}">Hapus</button></td></tr>`).join('')}</table>` : '<p style="color:var(--tx2)">Belum ada iklan. Iklan bawaan sistem akan dipakai sampai kamu membuat sendiri.</p>'}</div>`;
  const f = $('#af');
  const preview = () => {
    const kind = f.kind.value; $('#fileF').hidden = kind === 'text';
    const file = f.ad.files[0]; const url = file ? URL.createObjectURL(file) : '';
    const ad = { id: '', kind: kind === 'text' || !url ? 'text' : kind, title: f.title.value || 'Judul iklanmu', text: f.text.value || 'Teks pendukung iklan', cta: f.cta.value || 'Selengkapnya', bg: f.bg.value, link: '', mediaUrl: url, channel: getName() || 'Kamu' };
    $('#apv').innerHTML = adCard(ad).replace(/data-ad="[^"]*"/, '');
  };
  f.addEventListener('input', preview); f.addEventListener('change', preview); preview();
  f.onsubmit = async e => {
    e.preventDefault(); const btn = $('#abtn'), msg = $('#amsg'); btn.disabled = true;
    const fd = new FormData(); ['kind', 'title', 'text', 'cta', 'link', 'bg'].forEach(k => fd.append(k, f[k].value));
    fd.append('placements', $$('input[name=pl]:checked', f).map(x => x.value).join(',')); fd.append('channel', getName() || 'Pengiklan');
    if (f.kind.value !== 'text' && f.ad.files[0]) fd.append('ad', f.ad.files[0]);
    const h = {}; if (f.pw) { h['x-upload-password'] = f.pw.value; localStorage.upw = f.pw.value; }
    try { await api('/ads', { method: 'POST', body: fd, headers: h }); toast('Iklan diterbitkan'); route(); } catch (er) { msg.innerHTML = `<div class="msg err">${esc(er.message)}</div>`; btn.disabled = false; }
  };
  $$('[data-tg]').forEach(b => b.onclick = async () => { await api(`/ads/${b.dataset.tg}/toggle`, { method: 'POST' }); route(); });
  $$('[data-ad-del]').forEach(b => b.onclick = async () => { if (confirm('Hapus iklan ini?')) { await api('/ads/' + b.dataset.adDel, { method: 'DELETE' }); route(); } });
}

/* ---------- Tersimpan offline ---------- */
async function offlinePage() {
  const meta = offMeta(), vs = offIds().map(i => meta[i]).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `Penyimpanan terpakai: ${fmtSize(e.usage || 0)} dari ${fmtSize(e.quota || 0)}`; } catch {}
  main.innerHTML = `<div class="wrow" style="margin-bottom:16px"><h2>⬇️ Tersimpan offline</h2><span style="color:var(--tx2)">${usage}</span></div>` +
    (vs.length ? `<div class="grid">${vs.map(v => `<div>${card(v)}<div class="acts" style="margin-top:6px"><small style="color:var(--tx2);align-self:center">${fmtSize(v.offlineSize || 0)}</small><button class="btn sm" data-offdel="${v.id}">Hapus dari offline</button></div></div>`).join('')}</div>`
      : empty('Belum ada video tersimpan. Buka video lalu klik “⬇ Offline” untuk menontonnya tanpa internet.'));
  $$('[data-offdel]').forEach(b => b.onclick = async () => { await removeOffline(meta[b.dataset.offdel]); toast('Dihapus'); route(); });
}

/* ---------- PWA: service worker, tombol pasang, status koneksi ---------- */
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#install').hidden = false; });
$('#install').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('#install').hidden = true; };
window.addEventListener('appinstalled', () => { $('#install').hidden = true; toast('Aplikasi terpasang'); });
const netUI = () => { $('#offbar').hidden = navigator.onLine; };
window.addEventListener('offline', netUI);
window.addEventListener('online', () => { netUI(); toast('Kembali online'); });
netUI();

/* ---------- mulai ---------- */
refreshMe();
api('/config').then(c => { CONFIG = c; }).catch(() => {}).finally(route);
