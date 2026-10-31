# Tontonin — platform video mirip YouTube

Fitur:
- **Video panjang** (Beranda, pemutar, suka, komentar, bagikan, deskripsi, tag, hitung penonton)
- **Shorts** (feed vertikal, scroll/geser, autoplay, suka, bagikan)
- **Live** (siaran dari kamera atau layar lewat WebRTC, chat langsung, hitung penonton)
- **Playlist** (buat, simpan video, putar semua + otomatis lanjut)
- **Podcast** (audio mp3/m4a atau video, tampilan daftar episode)
- **Iklan buatan sendiri** (Studio Iklan): teks / gambar / video, tombol + link tujuan, statistik tayang/klik/CTR
  - **Pre-roll** sebelum video, **mid-roll** di tengah video (tiap 5 menit, atau di tengah untuk video pendek), tombol "Lewati" setelah 5 detik
  - Kartu iklan di Beranda & sidebar, slide iklan tiap 3 Shorts, banner di siaran Live
- **PWA + offline:** bisa dipasang ke layar utama (tombol “Pasang aplikasi” / menu browser), tampilan app tetap terbuka
  saat tidak ada internet, daftar video yang pernah dibuka tersimpan sementara, dan tombol **⬇ Offline** di halaman video
  menyimpan videonya ke perangkat untuk ditonton tanpa internet (menu **Tersimpan offline**). Iklan dilewati saat offline.
- Video benar-benar diunggah ke server dan dikirim ke penonton dengan HTTP Range (bisa seek/streaming)

## Menjalankan

Butuh Node.js 18+.

```bash
npm install
npm start
# buka http://localhost:3000
```

Untuk mengunggah video: menu **Unggah**. Untuk siaran: tombol **● Live**
(kamera/mikrofon hanya bisa dipakai lewat `localhost` atau **HTTPS**).

## Pengaturan (environment variable)

| Variabel | Fungsi | Default |
|---|---|---|
| `PORT` | Port server | 3000 |
| `DATA_DIR` | Folder data (db.json + file upload) | `./data` |
| `MAX_MB` | Ukuran maksimum upload | 500 |
| `UPLOAD_PASSWORD` | Jika diisi, hanya yang tahu password boleh unggah video/iklan/live. **Sangat disarankan saat online.** | kosong (terbuka) |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | Server TURN agar Live tembus jaringan ketat (4G/kantor) | kosong |

## Agar benar-benar sampai ke penonton (online)

Server ini harus berjalan di internet, bukan hanya di laptopmu.

1. **VPS** (paling cocok): sewa VPS (mis. 1–2 vCPU, disk 50GB+), pasang Node 18+, lalu
   `UPLOAD_PASSWORD=rahasia PORT=3000 npm start` (pakai `pm2` agar tetap hidup).
   Pasang **Caddy** atau **Nginx + Let's Encrypt** untuk HTTPS (wajib untuk fitur Live dari HP/browser lain), contoh Caddy:
   ```
   videomu.com {
     reverse_proxy localhost:3000
   }
   ```
2. **Platform hosting** (Railway / Render / Fly.io): deploy repo ini, set `DATA_DIR` ke **volume/disk persisten**
   (tanpa itu, video hilang tiap restart), dan set `UPLOAD_PASSWORD`.
3. Untuk Live di jaringan seluler, pasang server TURN (mis. coturn) dan isi `TURN_*`.

## Batasan yang perlu kamu tahu

- **Penyimpanan & bandwidth** ditanggung servermu. Video dikirim apa adanya (tanpa transcoding), jadi kualitas
  tidak otomatis menyesuaikan seperti YouTube. Pakai file **MP4 (H.264/AAC)**, WebM, MP3, atau M4A.
  Untuk skala besar: tambahkan ffmpeg (HLS multi-kualitas) dan CDN / object storage.
- **Live memakai WebRTC peer-to-peer dari host ke tiap penonton**, jadi cocok untuk puluhan penonton.
  Untuk ratusan/ribuan penonton perlu SFU (mis. LiveKit / mediasoup). Siaran tidak direkam otomatis.
- **Belum ada akun/login.** Pemilik video/iklan dikenali lewat ID browser; hapus data browser = tidak bisa
  mengelola video lama. Database berupa file JSON — cukup untuk komunitas kecil, bukan jutaan data.
- **Moderasi & hukum:** jika terbuka untuk umum, kamu bertanggung jawab atas konten yang diunggah
  (hak cipta, konten ilegal). Karena itu gunakan `UPLOAD_PASSWORD` atau tambahkan sistem akun.
- Statistik iklan dihitung sederhana (tanpa deteksi klik palsu) dan belum ada pembayaran/saldo iklan.

- **PWA/offline:** service worker hanya aktif di **HTTPS** (atau `localhost`). Video offline disimpan di penyimpanan
  browser (kuota tergantung perangkat; video besar memakan memori saat diunduh). iPhone/Safari bisa menghapus data
  situs yang lama tidak dibuka. Saat kamu mengubah `public/app.js` dll., naikkan `VERSION` di `public/sw.js`.
  Live dan iklan tetap butuh internet.

## Struktur

```
server.js          API, upload, streaming, iklan, WebSocket live
public/index.html  kerangka halaman
public/style.css   tampilan
public/app.js      semua halaman & logika pemutar/iklan/live
data/              (dibuat otomatis) db.json + uploads/
```
