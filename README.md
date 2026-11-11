# BAYU — Smart Wind Speed & Direction Monitor
> **Praktikum Internet of Things (IoT) — Kelompok 53**  
> Teknik Informatika / Sistem Informasi, UPN "Veteran" Yogyakarta

Dashboard pemantau kecepatan dan arah angin cerdas berbasis **Next.js (App Router), React, Leaflet, MQTT over TLS, dan Firebase**. Proyek ini mengintegrasikan sensor fisik stasiun cuaca lapangan (*anemometer optik/Hall A3144*, *sensor arah angin magnetik AS5600*, dan *GPS Neo-6M*) dengan pemantauan *real-time* berbasis web.

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
- Dilengkapi sistem login & registrasi akun baru yang tersimpan persisten.

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
5. Buka Dashboard BAYU -> Masuk tab **Pengaturan** -> Centang *Aktifkan Peringatan Telegram*.
6. Tempelkan Bot Token dan Chat ID, lalu klik **🧪 Tes Kirim Pesan ke Telegram** untuk memastikan koneksi berhasil.

### 2. Downlink MQTT pada Firmware ESP32
Agar perintah kontrol dari web dapat dieksekusi secara fisik oleh alat:
- Pastikan firmware `02_Penerima_Dalam.ino` menambahkan *subscription* ke topik kontrol:
  ```cpp
  client.subscribe("bayu/stations/angin-01/command");
  ```
- Di dalam callback MQTT `02_Penerima_Dalam.ino`, teruskan perintah via ESP-NOW / serial ke `01_Pengirim_Luar.ino`:
  - Perintah `calibrate_zero`: ESP-NOW kirim karakter `'z'` untuk kalibrasi nol sensor AS5600.
  - Perintah `buzzer_mute`: Set output pin buzzer ke `LOW`.

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
| **Akun Admin Dashboard** | User: `admin` \| Password: `bayu0098` | Akses penuh kontrol downlink & pengaturan |
| **API Telemetry Share Key** | `BAYU_TELEMETRY_SHARE_KEY` | Kunci baca untuk `/api/check-data`, diisi pada pengaturan Live dashboard |
| **Command Secret** | `BAYU_COMMAND_SECRET` | Kunci server terpisah untuk mengantrekan perintah stasiun |
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
*Hasil: 12/12 unit test validasi telemetri, GPS, komparasi, ekspor CSV, dan kalkulasi mawar angin lulus 100%.*

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
│   └── simulation.test.mjs           # Unit test otomatis (12 skenario pengujian)
├── worker/
│   └── index.mjs                     # Background daemon subscriber MQTT ke Firebase
├── package.json                      # Konfigurasi dependensi dan scripts npm
└── README.md                         # Dokumentasi lengkap proyek
```

---

## 👥 Pengembang

- **Kelompok 53 — Praktikum Internet of Things**
- Program Studi Informatika / Sistem Informasi
- Universitas Pembangunan Nasional "Veteran" Yogyakarta
