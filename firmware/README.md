# Firmware ESP32 — AeroSense Alert & Bayu Wind Station

Direktori ini berisi firmware resmi mikrokontroler ESP32 untuk proyek **BAYU (Smart Wind Speed & Direction Monitor)** / **AeroSense Alert System**.

---

## 🏗️ Arsitektur Firmware (Dual ESP32 Cloud Database)

Sistem menggunakan 2 mikrokontroler ESP32 yang terhubung secara independen ke broker Cloud EMQX melalui **MQTTS TLS (Port 8883)**:
- **Node 1 (Sensor Luar / Outdoor Transmitter)**: Membaca Anemometer optik/Hall, AS5600 Arah Angin, dan GPS Neo-6M, lalu mem-publish data JSON setiap **1 detik** ke topik `bayu/stations/angin-01/telemetry`.
- **Node 2 (Penerima / Indoor LCD Display)**: Berlangganan (*subscribe*) ke topik telemetri dan kontrol, menampilkan visualisasi pada LCD 16x2, mengontrol LED RGB indikator, dan membunyikan alarm buzzer jika terjadi anomali cuaca.

> [!NOTE]
> Kedua ESP32 **tidak perlu berada dalam satu jaringan Wi-Fi lokal** (bebas beda router, Wi-Fi rumah vs outdoor vs tethering HP) karena komunikasi sepenuhnya difasilitasi oleh Cloud Database.

---

## 📁 Struktur File Firmware

```
firmware/
├── 01_Pengirim_Luar/
│   └── 01_Pengirim_Luar.ino            # Skrip Node 1 (Outdoor Station)
├── 02_Penerima_Dalam/
│   └── 02_Penerima_Dalam.ino           # Skrip Node 2 (Indoor Display & Gateway)
├── AeroSense_Sensor_Pengirim/
│   └── AeroSense_Sensor_Pengirim.ino   # Alias resmi Node 1
└── AeroSense_ESP_Penerima/
    └── AeroSense_ESP_Penerima.ino      # Alias resmi Node 2
```

---

## 🔌 Pemetaan Pin Hardware (Pinout)

### Node 1: Sensor Luar (Outdoor Station)
| Komponen | Pin ESP32 | Keterangan |
|---|---|---|
| **Anemometer (Kecepatan)** | GPIO 4 | Hardware Interrupt FALLING (Debounce 10 ms) |
| **AS5600 SDA (Arah Angin)** | GPIO 21 | Bus I2C Data (Alamat 0x36) |
| **AS5600 SCL (Arah Angin)** | GPIO 22 | Bus I2C Clock (Alamat 0x36) |
| **AS5600 OUT (Analog Fallback)**| GPIO 34 | ADC1 Analog Input (Jika I2C terputus) |
| **GPS TX -> RX2 ESP32** | GPIO 16 | UART2 Hardware Serial (9600 bps) |
| **GPS RX <- TX2 ESP32** | GPIO 17 | UART2 Hardware Serial |
| **Buzzer Alarm 1** | GPIO 18 | Active-HIGH (0V=Mati, 3.3V=Bunyi) |
| **Buzzer Alarm 2** | GPIO 19 | Active-HIGH (0V=Mati, 3.3V=Bunyi) |
| **LED RGB (Merah)** | GPIO 25 | Indikator Status Bahaya |
| **LED RGB (Hijau)** | GPIO 26 | Indikator Status Aman |
| **LED RGB (Biru)** | GPIO 27 | Indikator Standby |
| **Push Button (Mute)** | GPIO 13 | INPUT_PULLUP ke GND (Snooze 5 Menit) |

### Node 2: Display Dalam (Indoor Station)
| Komponen | Pin ESP32 | Keterangan |
|---|---|---|
| **LCD 16x2 I2C SDA** | GPIO 21 | Bus I2C Data (Auto-detect 0x27 / 0x3F) |
| **LCD 16x2 I2C SCL** | GPIO 22 | Bus I2C Clock |
| **LCD 16x2 VCC & GND** | 5V & GND | Daya modul LCD I2C |
| **Buzzer Alarm 1** | GPIO 18 | Active-HIGH (0V=Mati, 3.3V=Bunyi) |
| **Buzzer Alarm 2** | GPIO 19 | Active-HIGH (0V=Mati, 3.3V=Bunyi) |
| **LED RGB (Merah)** | GPIO 25 | Indikator Bahaya |
| **LED RGB (Hijau)** | GPIO 26 | Indikator Aman |
| **LED RGB (Biru)** | GPIO 27 | Indikator Mencari Sinyal Cloud |
| **Push Button (Mute)** | GPIO 13 | INPUT_PULLUP ke GND (Snooze 5 Menit) |

---

## 🚨 Logika Status & Alarm

| Batas Kecepatan | Status | LED RGB | Buzzer | Keterangan |
|---|---|---|---|---|
| `< 5.0 km/h` | **AMAN** | Hijau Solid | **Mati Total (0V)** | Kondisi tenang, auto-reset mute |
| `5.0 - 15.0 km/h` | **WASPADA** | Kuning Solid | Beep Berkala (500 ms) | Peringatan angin sedang |
| `>= 15.0 km/h` | **BAHAYA** | Merah Kedip Cepat | Sirine Cepat (150 ms) | Anomali badai / angin kencang |

### Fitur Mute Snooze 5 Menit:
- Saat kondisi abnormal dan tombol GPIO 13 ditekan: Buzzer disenyapkan selama **5 menit (300.000 ms)** dan LCD menampilkan `[MUTE5m]`.
- Status Mute disinkronkan ke Cloud (`bayu/stations/angin-01/cmd`) sehingga kedua node kompak senyap.
- **Jika setelah 5 menit kondisi angin masih abnormal, buzzer otomatis BERBUNYI KEMBALI.**
- Jika kecepatan angin reda ke `< 5.0 km/h` sebelum 5 menit, status mute otomatis di-reset.

---

## 🛠️ Panduan Perintah Serial Monitor (Baudrate 115200)

Ketikkan karakter berikut di Serial Monitor untuk pengujian cepat:
- `'c'` / `'s'` : Kalibrasi titik UTARA (0.0°) pada sensor arah angin.
- `'d'` : Diagnostik lengkap sensor arah (Cek I2C 0x36, magnet status register 0x0B, dan Analog 34).
- `'p'` : Balik polaritas buzzer (Active-HIGH vs Active-LOW).
- `'x'` : Hard Mute (Paksa senyap total untuk presentasi).
- `'m'` : Mute / Unmute manual via serial.
- `'1'` / `'2'` / `'3'` : Tes manual LED Merah / Hijau / Biru.
- `'4'` : Tes manual Buzzer 1 detik.

## Perbaikan mute web dan tombol penerima

Gunakan pasangan terbaru `BAYU_Pengirim_Web/BAYU_Pengirim_Web.ino` dan `BAYU_Penerima_Web/BAYU_Penerima_Web.ino`. Isi Wi-Fi, kredensial MQTT dan StationId yang sama untuk kedua ESP. Kode lama di folder bernomor/AeroSense tidak mendapat perbaikan ini.

- Tombol penerima mematikan buzzer lokal dan mengirim permintaan mute melalui `/cmd`. Permintaan dicoba ulang setiap dua detik sampai telemetri pengirim mengonfirmasi, maksimal lima menit.
- Perintah web `buzzer_mute` dan `buzzer_unmute` ditangani oleh kedua ESP. Backend menunggu ACK dengan nonce yang sama dari `sender` dan `receiver` sebelum menyatakan berhasil. Pesan gagal dapat berarti hanya satu ESP yang sudah menerapkan perintah.
- Telemetri pengirim menyinkronkan mute dan unmute ke penerima. Dashboard mengikuti `is_muted` sehingga perubahan dari tombol fisik dan berakhirnya snooze ikut terlihat.
- Mute adalah snooze lima menit. Alarm suara dapat aktif kembali setelah timeout, dan kondisi aman mereset mute. LED tetap menunjukkan kondisi angin.
- Kedua ESP harus online di broker. Akun MQTT penerima perlu izin publish `/cmd` dan `/ack`, subscribe `/cmd` dan `/telemetry`. Akun pengirim perlu subscribe `/cmd` dan `/config`, publish `/ack` dan `/telemetry`.

Uji perangkat setelah mengunggah kedua sketch: buat kondisi alarm, tekan tombol penerima, pastikan kedua buzzer senyap dan `is_muted:true` diterima web. Ulangi melalui web, lalu unmute dan tunggu snooze berakhir. Matikan koneksi salah satu ESP untuk memastikan web menampilkan konfirmasi belum lengkap.

## Kalibrasi empat arah AS5600

Web → Kontrol → Kalibrasi empat arah. Mulai, arahkan sayap ke Utara dan rekam; ulangi Timur, Selatan, Barat. ESP merekam 30 sampel stabil (~3 detik), menolak sensor/magnet yang tidak terbaca, serta berhenti setelah 8 detik bila sudut terus bergerak. Selisih sampel dari titik acuan harus dalam 2 derajat.

Simpan kalibrasi memvalidasi empat titik dengan jarak tiap sektor 30–150 derajat mentah dan total satu putaran. Putaran sensor normal maupun terbalik didukung. Koreksi menggunakan interpolasi tiap sektor, termasuk melewati nol derajat. Draft kedaluwarsa setelah 15 menit. Memulai ulang mengganti draft sesi sebelumnya.

Titik disimpan sebagai satu record NVS `cardinal4` dan dimuat saat boot. Kalibrasi aktif sebelumnya tetap digunakan sampai penyimpanan berhasil. Perintah MQTT `/cmd` memakai `calibrate_four`, operation `start/capture/save/cancel`, session numerik, point 0–3 untuk capture, serta nonce. ACK pengirim berisi hasil atau alasan penolakan. Hanya pengirim perlu firmware baru; penerima tetap menampilkan sudut terkoreksi dari telemetri.

Perubahan mekanik atau magnet memerlukan kalibrasi ulang. Jika posisi fisik yang sama menghasilkan pembacaan berbeda, benahi magnet dan dudukannya terlebih dahulu. Koreksi arah virtual di dashboard adalah pengaturan tambahan yang terpisah dari kalibrasi sensor.


Kalibrasi tetap empat arah. Nilai mentah titik Barat tidak harus 270 derajat. Setiap sektor memakai rentang hasil rekamnya sendiri. Misalnya S mentah 180, B mentah 240, U mentah 10: sektor S–B menggunakan rentang 60 derajat mentah untuk 90 derajat keluaran; B–U menggunakan rentang 130 derajat mentah melewati nol untuk 90 derajat keluaran. Jarak tiap sektor mentah yang diterima 8–172 derajat, urutan harus konsisten membentuk satu putaran.


## Implementasi aktif: kalibrasi empat arah di backend

Versi terbaru menggantikan penyimpanan kalibrasi di NVS. Empat titik raw disimpan dalam `stationRegistry/{id}.directionCalibration` di Firestore. Draft berada dalam dokumen stasiun dan hanya pemilik/admin yang dapat mengubahnya melalui endpoint berautentikasi. Web tetap memakai langkah U → T → S → B.

Pengirim mengirim `rawWindDirectionDeg`, `directionProcessing: server`, validitas AS5600 serta hasil jendela stabil 30 sampel. Backend menunggu jendela baru setelah tombol Rekam ditekan, memvalidasi empat titik, dan menghitung interpolasi per sektor. Contoh U=10, T=100, S=180, B=240: raw 240 dikoreksi menjadi 270; raw 305 menjadi 315. Rumus berada di `src/lib/direction-calibration.mjs`.

Webhook `/api/telemetry/ingest` menyimpan raw dan hasil koreksi, kemudian mengirim sudut final ke `bayu/stations/{id}/processed` menggunakan MQTT TLS. Pengirim subscribe ke topik ini, dan meneruskan hasil terakhir dalam kolom `direction_deg`/`cardinal` pada telemetri berikutnya. Penerima tetap memakai firmware yang sudah ada. Raw selalu terpisah agar tidak dikoreksi dua kali. Koreksi arah virtual web ikut diterapkan pada hasil akhir.

Deploy backend/web versi ini sebelum menguji kalibrasi dengan firmware baru. Tidak ada environment baru; backend membutuhkan MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD dan CA serta kredensial Firebase yang sudah digunakan. ACL akun backend perlu publish `/processed`, akun pengirim perlu subscribe `/processed`.

Jika backend tidak membalas, pengirim tetap mengirim raw. LCD menahan hasil koreksi terakhir, atau menampilkan raw jika belum pernah menerima hasil backend. Kolom `directionBackendFresh` melaporkan apakah hasil backend diterima dalam lima detik terakhir. Pemrosesan arah membutuhkan backend yang aktif; halaman browser boleh ditutup. Pengujian end-to-end dengan sensor tetap diperlukan setelah deployment dan upload firmware.


## Uji backend lokal

Jalankan `npm run worker:local` dari root repo. `.env.local` memakai `BAYU_LOCAL_WORKER=1` dan `BAYU_LOCAL_STATION_ID` untuk stasiun uji. Dashboard lokal membaca `processedLatest` dan `processedReadings`, sehingga tidak tertimpa data webhook Vercel versi lama. Worker menggunakan konfigurasi MQTT/Firebase yang sudah ada dan mengirim sudut final melalui `/processed`. Notifikasi Telegram tidak dikirim dalam mode lokal. Laptop dan worker harus tetap berjalan selama pengujian. Untuk kembali memakai jalur webhook pada suatu environment, gunakan `BAYU_LOCAL_WORKER=0` dan restart server environment tersebut.
