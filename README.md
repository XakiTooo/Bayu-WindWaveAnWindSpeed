# BAYU — dashboard angin

Prototipe lokal berbasis **Next.js App Router + React + Leaflet**. Lima titik di sekitar Kampus Babarsari UPN Yogyakarta memakai data simulasi. Prototipe fisik tetap satu stasiun. Belum terhubung ke ESP32, MQTT, atau Firebase.

## Menjalankan lokal

```sh
npm install
npm run dev
```

Buka http://127.0.0.1:3000 (atau http://localhost:3000). Tanpa akun atau login ChatGPT. Peta dasar OpenStreetMap memerlukan internet. Leaflet dan CSS sudah menjadi dependensi lokal.

## Pemeriksaan

```sh
npm test
npm run build
```

## Struktur

- `src/app/`: halaman, layout, dan CSS.
- `src/components/MapDashboard.jsx`: peta penuh, pencarian stasiun, dan panel statistik yang muncul setelah titik dipilih.
- `src/components/WindMap.jsx`: peta Leaflet dan penanda arah angin yang dimuat di browser.
- `src/lib/simulation.mjs`: model stasiun, pembaruan dummy, status, dan CSV.
- `tests/`: pemeriksaan logika alarm, data terputus, dan ekspor.
- `dist/`: versi HTML/JavaScript sebelumnya, disimpan sebagai arsip referensi. Next.js tidak memakai folder ini.

## Vercel nanti

Pilih direktori proyek `dashboard-bayu` sebagai Root Directory, Framework Preset **Next.js**, Build Command `npm run build`, dan biarkan Output Directory mengikuti bawaan Next.js. Belum dilakukan deployment ke Vercel.

Manifest `.openai/hosting.json` hanya merekam publikasi lama. Tidak diperlukan untuk menjalankan Next.js maupun deployment Vercel. Pengembangan saat ini lokal saja.

Riwayat simulasi disimpan di memori halaman dan hilang saat reload. Pengaturan ambang disimpan di localStorage browser. Lokasi dan data dummy tidak mewakili pengukuran nyata.
