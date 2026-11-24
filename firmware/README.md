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
