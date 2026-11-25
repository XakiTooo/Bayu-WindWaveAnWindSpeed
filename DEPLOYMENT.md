# Deploy BAYU

Node 24. Jalankan `npm ci`, `npm test`, dan `npm run build` dari root repo.

Push branch `feature/*` atau `fix/*` menjalankan verifikasi. Preview otomatis lewat GitHub Actions memerlukan secret repository `VERCEL_TOKEN` milik akun yang sudah memiliki akses proyek Vercel BAYU. Bila secret belum ada, verifikasi tetap berjalan dan deploy preview dilewati dengan pemberitahuan. Integrasi Git Vercel yang sudah terhubung juga dapat membuat preview branch.

Production hanya dideploy dari `main` setelah perubahan direview dan digabung. Workflow tidak menggabungkan branch secara otomatis.

## Environment Vercel

Gunakan konfigurasi proyek BAYU yang sudah ada. Pastikan scope Preview dan Production sesuai. Variabel server: `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_DATABASE_URL`, `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `BAYU_EMQX_WEBHOOK_SECRET`, `BAYU_TELEMETRY_SHARE_KEY`. Gunakan `MQTT_CA_PEM` bila membutuhkan sertifikat kustom; sertifikat EMQX bawaan disertakan dalam paket. Jangan gunakan path file Windows pada Vercel. Variabel publik Firebase mengikuti `.env.example`.

Jangan mengimpor `.env.local` ke Vercel. `BAYU_LOCAL_WORKER` harus tidak disetel atau bernilai `0` pada Vercel. Mode lokal memakai `processedLatest`/`processedReadings`; deployment online memakai webhook dan `latest`/`readings`.

## Verifikasi setelah deploy

Pastikan domain preview/production diizinkan dalam Firebase Authentication. Login lalu periksa stasiun milik akun. Webhook EMQX harus menunjuk deployment online yang menjalankan `/api/telemetry/ingest` dengan header otorisasi yang sudah ada. Akun MQTT backend perlu publish `/processed`, pengirim perlu subscribe `/processed`. Periksa telemetri `directionBackendFresh:true`, arah dashboard/LCD, perekaman empat arah, dan ACK mute kedua ESP.

Empat titik kalibrasi sudah tersimpan di Firebase dan tidak perlu dibuat ulang saat deploy. Firmware dengan konfigurasi pribadi ada di `firmware/local/`, diabaikan Git. File dalam `firmware/BAYU_*_Web/` adalah template aman untuk unduhan web.
