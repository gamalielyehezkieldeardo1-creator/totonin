// Tontonin — platform video mirip YouTube (video panjang, Shorts, Live, Playlist, Podcast + iklan sendiri)
const express = require('express');
const multer = require('multer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_MB = parseInt(process.env.MAX_MB || '500', 10);
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || ''; // kosongkan = siapa saja boleh unggah
const PLACEMENTS = ['pre', 'mid', 'feed', 'short', 'live'];

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- Database sederhana (file JSON) ---------------- */
let db = { videos: [], comments: [], playlists: [], ads: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), err => { if (!err) fs.rename(tmp, DB_FILE, () => {}); });
  }, 200);
}
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const cid = req => String(req.headers['x-client-id'] || '').slice(0, 64);

if (!db.ads.length) {
  db.ads.push(
    { id: uid(), kind: 'text', title: 'Pasang iklanmu di sini', text: 'Buat iklan sendiri lewat menu Studio Iklan — teks, gambar, atau video.', cta: 'Buat Iklan', link: '', bg: '#7c3aed', placements: PLACEMENTS.slice(), impressions: 0, clicks: 0, active: true, ownerId: 'system', channel: 'Tontonin', createdAt: Date.now() },
    { id: uid(), kind: 'text', title: 'Dukung kreator favoritmu', text: 'Bagikan video ini ke teman-temanmu dan bantu channel ini tumbuh.', cta: 'Jelajahi', link: '', bg: '#0ea5e9', placements: PLACEMENTS.slice(), impressions: 0, clicks: 0, active: true, ownerId: 'system', channel: 'Tontonin', createdAt: Date.now() }
  );
  save();
}

/* ---------------- Express ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/media', express.static(UPLOAD_DIR, { acceptRanges: true, maxAge: '7d', index: false, dotfiles: 'deny' })); // mendukung Range → bisa seek/streaming
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (/sw\.js$/.test(p) || /manifest\.webmanifest$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } // agar update PWA cepat terdeteksi
}));

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, f, cb) => cb(null, uid() + uid() + path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8))
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 2 },
  fileFilter: (req, f, cb) => {
    const t = f.mimetype || '';
    const ok = f.fieldname === 'file' ? /^(video|audio)\//.test(t)
      : f.fieldname === 'thumb' ? /^image\//.test(t)
      : f.fieldname === 'ad' ? /^(image|video)\//.test(t) : false;
    cb(ok ? null : new Error('Jenis file tidak diizinkan: ' + t), ok);
  }
});
const authUpload = (req, res, next) => {
  if (UPLOAD_PASSWORD && req.headers['x-upload-password'] !== UPLOAD_PASSWORD) return res.status(401).json({ error: 'Password unggah salah atau belum diisi' });
  next();
};
const rm = f => f && fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {});

app.get('/api/config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  res.json({ needPassword: !!UPLOAD_PASSWORD, maxMb: MAX_MB, iceServers });
});

/* ---------------- Video ---------------- */
const pubVideo = (v, c) => {
  const { ownerId, likedBy, file, thumbFile, ...r } = v;
  return { ...r, likes: (likedBy || []).length, liked: !!c && (likedBy || []).includes(c), mine: !!c && ownerId === c };
};

app.get('/api/videos', (req, res) => {
  const c = cid(req);
  let l = db.videos.slice();
  const { type, q, channel, sort } = req.query;
  if (type) l = l.filter(v => v.type === type);
  if (channel) l = l.filter(v => v.channel === channel);
  if (req.query.mine) l = l.filter(v => v.ownerId === c);
  if (q) {
    const s = String(q).toLowerCase();
    l = l.filter(v => (v.title + ' ' + v.description + ' ' + (v.tags || []).join(' ') + ' ' + v.channel).toLowerCase().includes(s));
  }
  l.sort(sort === 'popular' ? (a, b) => b.views - a.views : (a, b) => b.createdAt - a.createdAt);
  l = l.slice(0, Math.min(parseInt(req.query.limit || '100', 10) || 100, 200));
  res.json(l.map(v => pubVideo(v, c)));
});

app.get('/api/videos/:id', (req, res) => {
  const v = db.videos.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Video tidak ditemukan' });
  res.json(pubVideo(v, cid(req)));
});

app.post('/api/videos', authUpload, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const f = req.files?.file?.[0], t = req.files?.thumb?.[0];
  const fail = (code, msg) => { rm(f?.filename); rm(t?.filename); return res.status(code).json({ error: msg }); };
  if (!f) return fail(400, 'File video/audio wajib diisi');
  const type = ['long', 'short', 'podcast'].includes(req.body.type) ? req.body.type : 'long';
  const title = clean(req.body.title, 120);
  if (!title) return fail(400, 'Judul wajib diisi');
  const duration = Math.max(0, Math.min(parseFloat(req.body.duration) || 0, 86400));
  if (type === 'short' && duration > 185) return fail(400, 'Shorts maksimal 3 menit');
  const v = {
    id: uid(), type, title,
    description: clean(req.body.description, 5000),
    tags: clean(req.body.tags, 200).split(',').map(s => s.trim()).filter(Boolean).slice(0, 10),
    channel: clean(req.body.channel, 40) || 'Anonim',
    ownerId: cid(req) || 'anon',
    file: f.filename, url: '/media/' + f.filename,
    thumbFile: t?.filename || '', thumb: t ? '/media/' + t.filename : '/placeholder.svg',
    isAudio: f.mimetype.startsWith('audio/'), mime: f.mimetype, size: f.size,
    duration, views: 0, likedBy: [], createdAt: Date.now()
  };
  db.videos.unshift(v); save();
  res.json(pubVideo(v, cid(req)));
});

const viewSeen = new Map();
app.post('/api/videos/:id/view', (req, res) => {
  const v = db.videos.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Tidak ditemukan' });
  const key = (cid(req) || req.ip) + v.id, now = Date.now();
  if (!viewSeen.has(key) || now - viewSeen.get(key) > 3600e3) { viewSeen.set(key, now); v.views++; save(); }
  if (viewSeen.size > 50000) viewSeen.clear();
  res.json({ views: v.views });
});

app.post('/api/videos/:id/like', (req, res) => {
  const c = cid(req); if (!c) return res.status(400).json({ error: 'Client id kosong' });
  const v = db.videos.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Tidak ditemukan' });
  v.likedBy = v.likedBy || [];
  const i = v.likedBy.indexOf(c);
  if (i >= 0) v.likedBy.splice(i, 1); else v.likedBy.push(c);
  save(); res.json({ liked: i < 0, likes: v.likedBy.length });
});

app.delete('/api/videos/:id', (req, res) => {
  const i = db.videos.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Tidak ditemukan' });
  const v = db.videos[i];
  if (v.ownerId !== cid(req)) return res.status(403).json({ error: 'Bukan videomu' });
  rm(v.file); rm(v.thumbFile);
  db.videos.splice(i, 1);
  db.comments = db.comments.filter(c => c.videoId !== v.id);
  db.playlists.forEach(p => { p.videoIds = p.videoIds.filter(x => x !== v.id); });
  save(); res.json({ ok: true });
});

/* ---------------- Komentar ---------------- */
app.get('/api/videos/:id/comments', (req, res) => {
  res.json(db.comments.filter(c => c.videoId === req.params.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).map(({ ownerId, ...c }) => c));
});
app.post('/api/videos/:id/comments', (req, res) => {
  if (!db.videos.some(v => v.id === req.params.id)) return res.status(404).json({ error: 'Video tidak ditemukan' });
  const text = clean(req.body.text, 1000); if (!text) return res.status(400).json({ error: 'Komentar kosong' });
  const c = { id: uid(), videoId: req.params.id, name: clean(req.body.name, 40) || 'Anonim', text, ownerId: cid(req), createdAt: Date.now() };
  db.comments.push(c); save();
  const { ownerId, ...r } = c; res.json(r);
});

/* ---------------- Playlist ---------------- */
const pubPlaylist = (p, c, full) => {
  const vids = p.videoIds.map(id => db.videos.find(v => v.id === id)).filter(Boolean);
  const r = { id: p.id, title: p.title, description: p.description, channel: p.channel, count: vids.length, cover: vids[0]?.thumb || '/placeholder.svg', mine: !!c && p.ownerId === c, createdAt: p.createdAt, videoIds: p.videoIds };
  if (full) r.videos = vids.map(v => pubVideo(v, c));
  return r;
};
const findPl = (req, res) => {
  const p = db.playlists.find(x => x.id === req.params.id);
  if (!p) { res.status(404).json({ error: 'Playlist tidak ditemukan' }); return null; }
  return p;
};
const ownPl = (req, res) => {
  const p = findPl(req, res); if (!p) return null;
  if (p.ownerId !== cid(req)) { res.status(403).json({ error: 'Bukan playlistmu' }); return null; }
  return p;
};
app.get('/api/playlists', (req, res) => {
  const c = cid(req);
  let l = db.playlists.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (req.query.mine) l = l.filter(p => p.ownerId === c);
  res.json(l.map(p => pubPlaylist(p, c)));
});
app.get('/api/playlists/:id', (req, res) => { const p = findPl(req, res); if (p) res.json(pubPlaylist(p, cid(req), true)); });
app.post('/api/playlists', (req, res) => {
  const title = clean(req.body.title, 100); if (!title) return res.status(400).json({ error: 'Nama playlist wajib diisi' });
  if (!cid(req)) return res.status(400).json({ error: 'Client id kosong' });
  const p = { id: uid(), title, description: clean(req.body.description, 500), channel: clean(req.body.channel, 40) || 'Anonim', ownerId: cid(req), videoIds: [], createdAt: Date.now() };
  db.playlists.unshift(p); save(); res.json(pubPlaylist(p, cid(req)));
});
app.post('/api/playlists/:id/videos', (req, res) => {
  const p = ownPl(req, res); if (!p) return;
  const id = String(req.body.videoId || '');
  if (!db.videos.some(v => v.id === id)) return res.status(404).json({ error: 'Video tidak ditemukan' });
  if (!p.videoIds.includes(id)) p.videoIds.push(id);
  save(); res.json(pubPlaylist(p, cid(req)));
});
app.delete('/api/playlists/:id/videos/:vid', (req, res) => {
  const p = ownPl(req, res); if (!p) return;
  p.videoIds = p.videoIds.filter(x => x !== req.params.vid); save(); res.json(pubPlaylist(p, cid(req)));
});
app.delete('/api/playlists/:id', (req, res) => {
  const p = ownPl(req, res); if (!p) return;
  db.playlists = db.playlists.filter(x => x !== p); save(); res.json({ ok: true });
});

/* ---------------- Iklan buatan sendiri ---------------- */
const pubAd = (a, c) => { const { ownerId, ...r } = a; return { ...r, mine: !!c && ownerId === c }; };
app.get('/api/ads/pick', (req, res) => {
  const slot = String(req.query.slot || 'feed'), n = Math.min(parseInt(req.query.n || '1', 10) || 1, 12);
  const pool = db.ads.filter(a => a.active && a.placements.includes(slot));
  if (!pool.length) return res.json([]);
  // acak berbobot sederhana; ulang bila stok iklan lebih sedikit dari n
  const out = [];
  let bag = [];
  while (out.length < n) { if (!bag.length) bag = pool.slice().sort(() => Math.random() - 0.5); out.push(bag.pop()); }
  res.json(out.map(a => pubAd(a, cid(req))));
});
app.get('/api/ads/mine', (req, res) => res.json(db.ads.filter(a => a.ownerId === cid(req)).sort((a, b) => b.createdAt - a.createdAt).map(a => pubAd(a, cid(req)))));
app.post('/api/ads', authUpload, upload.fields([{ name: 'ad', maxCount: 1 }]), (req, res) => {
  const f = req.files?.ad?.[0];
  const fail = (code, msg) => { rm(f?.filename); return res.status(code).json({ error: msg }); };
  const kind = ['text', 'image', 'video'].includes(req.body.kind) ? req.body.kind : 'text';
  const title = clean(req.body.title, 80); if (!title) return fail(400, 'Judul iklan wajib diisi');
  if (kind !== 'text' && !f) return fail(400, 'File gambar/video iklan wajib diisi');
  if (kind === 'image' && !f.mimetype.startsWith('image/')) return fail(400, 'File harus gambar');
  if (kind === 'video' && !f.mimetype.startsWith('video/')) return fail(400, 'File harus video');
  let link = clean(req.body.link, 500);
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  const bg = /^#[0-9a-f]{6}$/i.test(req.body.bg || '') ? req.body.bg : '#7c3aed';
  let placements = String(req.body.placements || '').split(',').map(s => s.trim()).filter(p => PLACEMENTS.includes(p));
  if (!placements.length) placements = PLACEMENTS.slice();
  const a = {
    id: uid(), kind, title, text: clean(req.body.text, 200), cta: clean(req.body.cta, 24) || 'Selengkapnya', link, bg, placements,
    mediaFile: f?.filename || '', mediaUrl: f ? '/media/' + f.filename : '',
    impressions: 0, clicks: 0, active: true, ownerId: cid(req) || 'anon', channel: clean(req.body.channel, 40) || 'Pengiklan', createdAt: Date.now()
  };
  db.ads.unshift(a); save(); res.json(pubAd(a, cid(req)));
});
const adOf = (req, res) => { const a = db.ads.find(x => x.id === req.params.id); if (!a) res.status(404).json({ error: 'Iklan tidak ditemukan' }); return a; };
app.post('/api/ads/:id/impression', (req, res) => { const a = adOf(req, res); if (a) { a.impressions++; save(); res.json({ ok: true }); } });
app.post('/api/ads/:id/click', (req, res) => { const a = adOf(req, res); if (a) { a.clicks++; save(); res.json({ ok: true }); } });
app.post('/api/ads/:id/toggle', (req, res) => {
  const a = adOf(req, res); if (!a) return;
  if (a.ownerId !== cid(req)) return res.status(403).json({ error: 'Bukan iklanmu' });
  a.active = !a.active; save(); res.json(pubAd(a, cid(req)));
});
app.delete('/api/ads/:id', (req, res) => {
  const a = adOf(req, res); if (!a) return;
  if (a.ownerId !== cid(req)) return res.status(403).json({ error: 'Bukan iklanmu' });
  rm(a.mediaFile); db.ads = db.ads.filter(x => x !== a); save(); res.json({ ok: true });
});

/* ---------------- Live (daftar) ---------------- */
const lives = new Map();
app.get('/api/live', (req, res) => {
  res.json([...lives.values()].map(l => ({ id: l.id, title: l.title, channel: l.channel, viewers: l.viewers.size, startedAt: l.startedAt })).sort((a, b) => b.viewers - a.viewers));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File terlalu besar (maks ${MAX_MB} MB)` });
  res.status(400).json({ error: err.message || 'Terjadi kesalahan' });
});

/* ---------------- Live via WebRTC (signaling WebSocket) ---------------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const count = live => { const m = { t: 'viewers', n: live.viewers.size }; send(live.host, m); live.viewers.forEach(v => send(v, m)); };

wss.on('connection', ws => {
  ws.id = uid().slice(0, 8); ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'start') {
      if (ws.live) return;
      if (UPLOAD_PASSWORD && m.password !== UPLOAD_PASSWORD) return send(ws, { t: 'error', msg: 'Password siaran salah' });
      const live = { id: uid().slice(0, 8), title: clean(m.title, 100) || 'Siaran langsung', channel: clean(m.channel, 40) || 'Anonim', host: ws, viewers: new Map(), startedAt: Date.now() };
      lives.set(live.id, live); ws.live = live; send(ws, { t: 'started', id: live.id });
    } else if (m.t === 'join') {
      const live = lives.get(String(m.id));
      if (!live) return send(ws, { t: 'error', msg: 'Siaran tidak ditemukan atau sudah selesai' });
      ws.room = live; live.viewers.set(ws.id, ws);
      send(ws, { t: 'joined', title: live.title, channel: live.channel });
      send(live.host, { t: 'viewer-join', vid: ws.id }); count(live);
    } else if (m.t === 'signal') {
      if (ws.live) { const v = ws.live.viewers.get(m.vid); if (v) send(v, { t: 'signal', data: m.data }); }
      else if (ws.room) send(ws.room.host, { t: 'signal', vid: ws.id, data: m.data });
    } else if (m.t === 'chat') {
      const room = ws.live || ws.room; if (!room) return;
      const text = clean(m.text, 200); if (!text) return;
      const msg = { t: 'chat', name: clean(m.name, 30) || 'Anonim', text, host: !!ws.live };
      send(room.host, msg); room.viewers.forEach(v => send(v, msg));
    }
  });
  ws.on('close', () => {
    if (ws.live) { ws.live.viewers.forEach(v => send(v, { t: 'ended' })); lives.delete(ws.live.id); }
    else if (ws.room) { ws.room.viewers.delete(ws.id); send(ws.room.host, { t: 'viewer-left', vid: ws.id }); count(ws.room); }
  });
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000);

server.listen(PORT, () => console.log(`Tontonin berjalan di http://localhost:${PORT}  (unggah ${UPLOAD_PASSWORD ? 'dikunci password' : 'terbuka untuk siapa saja'}, maks ${MAX_MB} MB)`));
