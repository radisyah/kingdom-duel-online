# KINGDOM DUEL · Online

Duel strategi fantasi + soal matematika, kini bisa **1 vs 1 online dengan kode ruangan** (sistem yang sama dengan *NUMBER BOMBER Online*).
Satu perangkat = satu pemain. Pembuat ruangan = Pemain 1 (Biru), yang bergabung = Pemain 2 (Merah). Mode **Main Lokal** (2 pemain, 1 perangkat) tetap ada.

## Cara kerja online
- **Koneksi langsung (WebRTC DataChannel)** antar-perangkat → latensi = jarak jaringan kedua pemain saja. Badge di tengah-atas: `LANGSUNG · xx ms`.
  Bila koneksi langsung gagal dalam ±9 dtk, otomatis jatuh ke **relay lewat Vercel + Upstash Redis** (`RELAY`, lebih lambat).
- Server Vercel + Redis hanya dipakai untuk membuat/gabung ruangan (kode 5 karakter), bertukar SDP/ICE, dan relay cadangan (`api/room.js`, `lib/store.js`).
- **Dipegang tiap perangkat (respons instan):** soal & jawaban, energi, cooldown kartu/skill, pilihan jalur.
- **Diputuskan host (dunia bersama):** pasukan, gerak, pertempuran, HP benteng, efek Shield/Rally/Blast, timer, hasil.
  Disiarkan ke tamu sebagai snapshot 15×/dtk + kejadian andal (efek, hitung mundur, hasil). Pasukan di layar tamu dihaluskan dengan interpolasi.
- Tamu mengirim **permintaan** panggil unit / skill; host bisa menolak (jalur penuh, tak ada target Blast) → energi & cooldown tamu dikembalikan.
- **Adil:** seed soal dibagikan host, jadi jenis operasi & level soal ke-n sama untuk kedua pemain (angkanya berbeda), seperti mode lokal.
- Di online tidak ada Jeda/Mulai Ulang. Tombol **Menu** (tekan 2×) = keluar ruangan. **Rematch**: bisa diminta salah satu pemain, host yang memulai.
- Kontrol online: keyboard (skema P1 **dan** P2 sama-sama aktif untuk pemain di perangkat itu) atau sentuh. Hanya panel milikmu yang tampil.

## Deploy ke Vercel
1. Upload folder ini ke GitHub → di Vercel **Add New → Project**, pilih repo (preset **Other**, tanpa build command; `vercel.json` sudah mengatur `public/` dan `api/room.js`).
2. **Storage / Marketplace → Upstash Redis** → hubungkan ke proyek (mengisi `KV_REST_API_URL` / `KV_REST_API_TOKEN` atau `UPSTASH_REDIS_REST_*`). Lalu **Redeploy**.
3. *(Disarankan)* Tambahkan **TURN** agar jaringan seluler dengan NAT ketat tetap bisa P2P: env `METERED_APP_NAME`, `METERED_API_KEY` (+ `METERED_REGION`) atau `ICE_SERVERS` — lihat `.env.example`.
   Cek `/api/room?action=ice` → harus ada entri `turn:`.
4. Buka URL → **Main Online** → **Buat Ruangan** → kirim kode / tautan (`?r=KODE`) ke teman → teman memilih **Gabung**.

## Lokal & tes
```bash
node dev-server.js        # http://localhost:3000 (penyimpanan memori, tanpa Redis)
npm test                  # 17 tes API pensinyalan
# e2e: 2 browser sungguhan (WebRTC + jalur relay):  npm i playwright && npx playwright install chromium && node test/e2e.js
```
Tambahkan `?debug=1` di URL untuk membuka objek `window.__kd` (dipakai tes e2e).

## Batasan
- Host dipercaya untuk dunia; tiap perangkat dipercaya untuk soal/energinya sendiri (cukup untuk duel antar-teman, bukan anti-cheat).
- Tidak ada sambung-ulang di tengah pertandingan: bila koneksi putus, kembali ke lobi (bila sudah di layar hasil, hasil tetap terlihat).
- Simulasi dunia berhenti bila tab host disembunyikan (browser menghentikan animasi); biarkan tab host tetap terbuka.
- Belum ada mode penonton (Room Master) seperti di Number Bomber; endpoint `api/room.js` sudah mendukungnya bila ingin ditambah.
