# BAYU — Smart Wind Speed & Direction Monitor
> **Praktikum Internet of Things (IoT) — Kelompok 53**  
> Teknik Informatika / Sistem Informasi, UPN "Veteran" Yogyakarta

Dashboard pemantau kecepatan dan arah angin cerdas berbasis **Next.js (App Router), React, Leaflet, MQTT over TLS, dan Firebase**. Proyek ini mengintegrasikan sensor fisik stasiun cuaca lapangan (*anemometer optik/Hall A3144*, *sensor arah angin magnetik AS5600*, dan *GPS Neo-6M*) dengan pemantauan *real-time* berbasis web.

**Konfigurasi terkini:** Salin `.env.example` ke `.env.local` dan isi `BAYU_ADMIN_PASSWORD` (minimal 12 karakter) untuk membuat akun admin pertama saat login. Pada workspace lokal ini nilainya sudah dibuat secara acak di `.env.local`; baca nilainya di sana untuk login pertama. Server dashboard memerlukan `FIREBASE_SERVICE_ACCOUNT_JSON` atau `GOOGLE_APPLICATION_CREDENTIALS` agar akun, sesi, dan riwayat Firestore berfungsi. Setelah akun admin dibuat, password dan role dibaca dari Firestore; nilai bootstrap tidak dipakai lagi. Worker menyimpan sampel setiap menit. Jika riwayat belum bisa dibaca, dashboard menampilkan data sesi saat ini. Kredensial Wi-Fi/MQTT yang pernah ditulis di sketch lama perlu diganti di perangkat dan broker sebelum dipakai lagi.

**Mode demo lokal:** `BAYU_LOCAL_AUTH=1` pada `.env.local` mengaktifkan akun dummy hanya saat `npm run dev` dan hanya jika kredensial Firebase Admin belum tersedia. Admin pertama tetap memakai username `admin` dan `BAYU_ADMIN_PASSWORD`; akun serta sesi tersimpan di `.local-data/auth.json` (diabaikan Git). Mode ini tidak aktif pada build/server produksi. Kalibrasi dari dashboard tetap menggunakan broker MQTT dan firmware fisik, sehingga keberhasilannya memerlukan ACK dari ESP. Jangan arahkan sensor ke utara setelah menekan tombol; posisikan sebelum menekan kalibrasi.

`START_BAYU_DASHBOARD.bat` otomatis memakai `npm run dev` saat mode demo aktif. Skrip menampilkan alamat dashboard dan membiarkan Anda membuka browser sendiri.

### Menyiapkan database akun

1. Di Firebase Console, buka proyek BAYU yang sudah dipakai untuk telemetri. Jika Firestore belum dibuat, buka **Databases & Storage → Firestore → Create database**, pilih lokasi dan **Production mode**.
2. Buka **Project settings → Service accounts → Generate new private key**. Simpan file JSON di luar repositori; jangan kirim private key lewat chat atau commit ke Git.
3. Isi `GOOGLE_APPLICATION_CREDENTIALS` di `.env.local` dengan path absolut file JSON tersebut. Pastikan `FIREBASE_DATABASE_URL` menunjuk ke proyek Firebase yang sama. Restart `npm run dev`.
4. Login dengan username `admin` dan nilai `BAYU_ADMIN_PASSWORD` dari `.env.local`. Login pertama membuat dokumen `dashboardUsers/admin`; sesi tersimpan di `dashboardSessions`. Gunakan **Kelola Akun** untuk membuat akun pembaca/admin lain dan menonaktifkannya.

Sesi memakai token acak yang hash-nya tersimpan di Firestore, berlaku 12 jam. Password tersimpan sebagai hash scrypt. Lima kegagalan login mengunci akun selama 15 menit. Dokumen sesi kadaluarsa dapat dibersihkan dengan kebijakan TTL Firestore pada field `expiresAt`.

---

## 🌐 Akses Dashboard

- **Versi Publik (Live Vercel):**  
  👉 [https://bayu-windwave-and-windspeed.vercel.app](https://bayu-windwave-and-windspeed.vercel.app)
- **Versi Lokal (Development):**  
  👉 `http://localhost:3000` (atau `http://127.0.0.1:3000`)

---

## 🏗️ Arsitektur Sistem

```
[ Sensor Outdoor ]
  A3144 (Kecepatan) + AS5600 (Arah) + GPS Neo-6M
         │
         │ ESP-NOW (Nirkabel 2.4 GHz)
         ▼
[ Gateway Indoor (ESP32) ]
         │
         │ MQTT over TLS (Port 8883)
         ▼
[ Broker EMQX Cloud ] ──> [ Background Worker (Node.js) ]
                                │
                                ▼
                   [ Firebase RTDB & Firestore ]
                                │
                                ▼
                   [ Dashboard Web Next.js (Vercel) ]
```

---

## 🚀 Fitur Unggulan

### 1. Visualisasi Peta & Sensor Interaktif
- **Peta Interaktif Babarsari:** Menampilkan stasiun pemantauan dengan penanda (*marker*) arah angin yang berputar dinamis mengikuti derajat mata angin asli.
- **Kompas Analog Presisi:** Indikator jarum kompas real-time dengan sudut derajat (° dari Utara) dan label 8 mata angin (Utara, Timur Laut, Timur, Tenggara, Selatan, Barat Daya, Barat, Barat Laut).
- **Grafik Mini 30 Sampel:** Tren visual kecepatan angin terkini dalam bentuk bar chart interaktif.
- **Pencarian Cepat:** Filter nama stasiun dan tombol fokus otomatis ke lokasi alat.

### 2. Mode Data Ganda (Dual Data Pipeline)
- **Mode Simulasi:** Mode latihan dengan 5 stasiun dummy dan generator fluktuasi angin dinamis tanpa membutuhkan koneksi alat fisik.
- **Mode Live IoT:** Terhubung langsung ke telemetri hardware riil (`angin-01`) melalui REST API `/api/check-data`. Status paket data terdeteksi otomatis (*Hardware Aktif*, *Data Stale*, atau *Offline*).

### 3. Analitik Riwayat & Diagram Mawar Angin (*Wind Rose*)
- **Ringkasan Statistik Instan:** Menghitung otomatis **Gust Maksimum**, **Kecepatan Rata-rata**, dan **Arah Dominan** dari data pengukuran.
- **Diagram Mawar Angin (Wind Rose):** Visualisasi distribusi frekuensi tiupan angin pada 8 sektor mata angin lengkap dengan persentase dan kecepatan rata-rata.
- **Tabel Log Riwayat:** Menampilkan data pengukuran lengkap dengan stempel waktu, kecepatan (km/jam & m/s), arah derajat, dan label sumber data (`IoT Real` vs `Simulasi`).

### 4. Sistem Alarm & Peringatan Dini
- **Ambang Batas Kustom:** Pengaturan batas kecepatan bahaya dan batas minimum baterai luar yang tersimpan aman di `localStorage`.
- **Alarm Suara Otomatis:** Nada dering peringatan otomatis via Web Audio API browser (osilator 880 Hz → 440 Hz) saat kecepatan angin melampaui batas aman.
- **Floating Alert Banner:** Banner peringatan darurat yang melayang di atas peta jika terdeteksi anomali cuaca ekstrem.

### 5. Diagnostik Kesehatan Alat (*Device Health*)
- **Pemantauan Kualitas Jaringan:** Menampilkan nilai **Wi-Fi RSSI (dBm)** dan evaluasi sinyal gateway.
- **Integritas Sensor:** Status deteksi medan magnetik sensor AS5600.
- **Kualitas Transmisi ESP-NOW:** Tingkat keberhasilan transmisi paket data dan kalkulasi *packet loss*.
- **Status Sistem ESP32:** Sisa memori RAM bebas (*Free Heap*) dan waktu aktif (*uptime*).

### 6. Komparasi Cuaca Regional (DIY)
- Integrasi prakiraan cuaca eksternal regional Sleman / D.I. Yogyakarta (via `/api/weather`).
- Membandingkan langsung pembacaan mikroklimat sensor lokal Babarsari terhadap kondisi makro cuaca regional lengkap dengan selisih kecepatan angin.

### 7. Kontrol Downlink Dua Arah (Web ➔ ESP32)
- Mengirim perintah operasional dari antarmuka web ke mikrokontroler melalui endpoint `/api/command`:
  - **Kalibrasi Titik Nol (Utara):** Menyetel ulang titik referensi utara pada sensor magnetik AS5600.
  - **Mute / Unmute Buzzer:** Mematikan atau menyalakan suara alarm buzzer di lapangan secara jarak jauh.
  - **Paksa Sinkronisasi Telemetri:** Meminta ESP32 mengirim paket data segar sesegera mungkin.
- Log audit pengiriman perintah tercatat langsung di antarmuka.

### 8. Autentikasi Pengguna & Role-Based Access Control (RBAC)
- **Role Tamu (Guest):** Akses publik *read-only* untuk memantau cuaca, grafik, dan peta tanpa risiko mengubah konfigurasi sistem.
- **Role Administrator:** Akses penuh untuk mengirim kontrol downlink hardware, mengubah ambang batas bahaya, mengatur webhook, dan ekspor data.
- Akun dan sesi disimpan di Firestore (`dashboardUsers` dan `dashboardSessions`). Password memakai hash scrypt; cookie sesi HttpOnly. Admin dapat membuat dan menonaktifkan akun pembaca atau admin lain.

### 9. Ekspor Data Laporan (CSV)
- Unduh seluruh riwayat telemetri dalam format CSV standar.
- Menyertakan data waktu ISO-8601, ID stasiun, kecepatan (km/jam), sudut arah (°), baterai (%), koordinat GPS dinamis (`latitude`, `longitude`), dan penanda sumber data (`HARDWARE_REAL` vs `SIMULASI`).

---

## ⚙️ Fitur yang Memerlukan Konfigurasi Lanjutan

Beberapa fitur terintegrasi dengan layanan pihak ketiga atau hardware fisik dan memerlukan konfigurasi berikut:

### 1. Integrasi Notifikasi Bot Telegram
Untuk menerima pesan bahaya langsung di ponsel saat kecepatan angin melebihi ambang batas:
1. Buka aplikasi Telegram, cari akun `@BotFather`, lalu buat bot baru dengan perintah `/newbot`.
2. Simpan **HTTP API Bot Token** yang diberikan (contoh: `7123456789:AAFx...`).
3. Mulai obrolan dengan bot Anda, lalu klik tombol **/start**.
4. Dapatkan **Chat ID** Anda melalui bot `@userinfobot` atau `@getmyid_bot` (contoh: `123456789`).
5. Isi `BAYU_TELEGRAM_BOT_TOKEN`, `BAYU_TELEGRAM_CHAT_ID`, dan `BAYU_ALERT_THRESHOLD_KMH` pada lingkungan worker. Isi token dan chat ID yang sama pada server dashboard untuk tombol tes.
6. Jalankan worker. Peringatan dikirim dari worker meski halaman dashboard ditutup; tombol tes tersedia untuk administrator.

### 2. Downlink MQTT pada Firmware ESP32
Agar perintah kontrol dari web bekerja, upload firmware pengirim terbaru. Node pengirim berlangganan `bayu/stations/angin-01/cmd` dan mengirim konfirmasi ke `bayu/stations/angin-01/ack`. Node penerima berlangganan topik `cmd` untuk menyamakan status mute.

### 3. Modul GPS Fisik (Neo-6M)
- Modul GPS membutuhkan sinyal satelit langsung (berada di luar ruangan atau dekat jendela terbuka).
- Pada saat dinyalakan pertama kali (*cold start*), modul membutuhkan waktu 1–3 menit hingga lampu LED indikator GPS berkedip (menandakan *lock fix* tercapai). Begitu koordinat terbaca, penanda stasiun di peta akan otomatis berpindah ke koordinat riil.

### 4. Background Worker (MQTT ke Firebase)
Untuk menghubungkan broker EMQX Cloud ke database Firebase:
- Jalankan service worker di server atau cloud menggunakan file `worker/index.mjs`:
  ```bash
  cd worker
  npm install
  node index.mjs
  ```
- Membutuhkan environment variables:
  - `MQTT_URL`: `mqtts://g916bd01.ala.us-east-1.emqxsl.com:8883`
  - `MQTT_USERNAME`: `bayu-gateway-angin-01`
  - `MQTT_PASSWORD`: `[REDACTED]`
  - `MQTT_CA_FILE`: path ke file root CA (DigiCert / ISRG Root X1)
  - `FIREBASE_DATABASE_URL`: URL Firebase Realtime Database proyek Anda
  - `GOOGLE_APPLICATION_CREDENTIALS`: Path ke Service Account JSON Firebase

---

## 🔑 Kredensial & Parameter Bawaan

| Item | Nilai Default | Keterangan |
|---|---|---|
| **Akun Admin Dashboard** | `BAYU_ADMIN_PASSWORD` | Password bootstrap satu kali untuk akun `admin`; akun berikutnya dikelola dari dashboard |
| **API Telemetry Share Key** | `BAYU_TELEMETRY_SHARE_KEY` | Kunci baca untuk `/api/check-data`, diisi pada pengaturan Live dashboard |
| **Kontrol alat** | Sesi admin + MQTT TLS | Perintah dianggap berhasil setelah ACK dari ESP |
| **Broker MQTT** | `g916bd01.ala.us-east-1.emqxsl.com` | EMQX Cloud Server |
| **Port MQTT** | `8883` (TLS) / `8084` (WSS) | Enkripsi aman TLS v1.2/v1.3 |
| **Topik Telemetri** | `bayu/stations/angin-01/telemetry` | Jalur publikasi data alat |
| **Topik Kontrol** | `bayu/stations/angin-01/command` | Jalur kirim perintah downlink |

---

## 💻 Panduan Menjalankan Lokal

### 1. Prasyarat Sistem
- Node.js versi 18.18+ atau versi 20+ (Direkomendasikan Node.js v20/v24).
- npm versi 9+.

### 2. Pemasangan & Menjalankan
```bash
# Clone atau buka folder Dashboard-Bayu
cd Dashboard-Bayu

# Pasang dependensi
npm install

# Jalankan server pengembangan lokal
npm run dev
```

Buka peramban di: **`http://localhost:3000`**

### 3. Menjalankan Pengujian (Testing)
Proyek ini dilengkapi rangkaian pengujian unit otomatis (*zero-dependency* native `node:test`):
```bash
npm test
```
Tes mencakup telemetri, GPS, simulasi, ekspor CSV, dan sesi admin.

### 4. Melakukan Kompilasi Produksi (Production Build)
```bash
npm run build
```
*Menggunakan Next.js Turbopack compiler. Menghasilkan static prerendered assets dan dynamic serverless endpoints.*

---

## 📁 Struktur Direktori

```
Dashboard-Bayu/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── check-data/route.js   # API penyedia telemetri hardware riil
│   │   │   ├── command/route.js      # API kirim perintah downlink ke ESP32
│   │   │   ├── notify/route.js       # API pengirim webhook bot Telegram
│   │   │   └── weather/route.js      # API komparasi cuaca regional DIY
│   │   ├── layout.jsx                # Layout dasar HTML & meta tags Next.js
│   │   ├── maps.css                  # Style sheet terpadu (tema visual BAYU)
│   │   └── page.jsx                  # Halaman utama aplikasi
│   ├── components/
│   │   ├── MapDashboard.jsx          # Komponen dashboard utama (state, drawer, dialog)
│   │   └── WindMap.jsx               # Komponen wrapper peta Leaflet OpenStreetMap
│   └── lib/
│       ├── firebase-admin.js         # Inisialisasi Firebase Admin SDK server-side
│       ├── simulation.mjs            # Logika telemetri, mawar angin, analitik & simulasi
│       └── telemetry.mjs             # Validator skema data hardware
├── tests/
│   └── simulation.test.mjs           # Unit test otomatis
├── worker/
│   └── index.mjs                     # Background daemon subscriber MQTT ke Firebase
├── package.json                      # Konfigurasi dependensi dan scripts npm
└── README.md                         # Dokumentasi lengkap proyek
```

---

## Menambah Stasiun di Dashboard

Masuk sebagai admin, lalu klik tombol **+** di kolom pencarian atau **Tambah stasiun** pada daftar stasiun. Isi nama, ID unik (misalnya `ANGIN-06`), dan koordinat cadangan. Daftar stasiun tersimpan di browser yang digunakan dan tetap ada setelah halaman dimuat ulang.

Untuk menghapus stasiun tambahan, pilih titiknya lalu klik **Hapus** dan konfirmasi. Titik, konfigurasi, dan riwayat sesi stasiun tersebut dihapus dari browser ini; data alat di server tetap tersimpan. Stasiun bawaan tidak dapat dihapus.

Alat harus mengirim telemetri dengan ID yang sesuai ke `bayu/stations/angin-06/telemetry`. Dashboard membaca setiap stasiun secara terpisah melalui `/api/check-data?stationId=angin-06` dengan kunci baca pada header `x-bayu-read-key`. Stasiun baru tampil offline sampai menerima data; lokasi menggunakan koordinat cadangan saat GPS belum terkunci. Broker perlu memberi izin membaca topik stasiun tersebut.

Pada tab **Kontrol Alat**, masuk sebagai administrator. Sebelum upload firmware, salin `config.example.h` menjadi `config.h` pada folder firmware yang digunakan, lalu isi Wi-Fi dan kredensial MQTT baru. Dashboard mengirim `calibrate_zero`, `buzzer_mute`, `buzzer_unmute`, dan `request_telemetry` langsung ke `bayu/stations/<id>/cmd`; web hanya menampilkan sukses setelah menerima ACK dari firmware pengirim di `bayu/stations/<id>/ack`. Firmware pengirim terbaru harus di-upload untuk perintah ini. Restart server setelah mengubah `.env.local`, dan pastikan `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, serta `MQTT_CA_FILE` tersedia.

## 👥 Pengembang

- **Kelompok 53 — Praktikum Internet of Things**
- Program Studi Informatika / Sistem Informasi
- Universitas Pembangunan Nasional "Veteran" Yogyakarta
