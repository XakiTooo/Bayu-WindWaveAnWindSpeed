// BAYU: konfigurasi alarm dari backend melalui MQTT /config.
// Nilai terakhir disimpan di NVS agar alarm lokal tetap berjalan saat offline.
/*
 * BAYU_Pengirim_Web
 * Pembacaan Hall effect, AS5600 dan GPS; konfigurasi alarm diterima dari backend melalui MQTT /config.
 * Koneksi MQTT TLS ke EMQX. ID, Wi-Fi dan kredensial di config.h.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>
#include <mqtt_client.h>
#include <ArduinoJson.h>
#include <ctime>
#include <atomic>
// ===== KONFIGURASI ALAT: EDIT DI BAGIAN INI =====
constexpr char StationId[] = "YOUR_STATION_ID";

// Copy to config.h in this folder and fill in the ESP32 Wi-Fi and MQTT details.
constexpr char WifiSsid[] = "YOUR_2_4_GHZ_WIFI";
constexpr char WifiPassword[] = "YOUR_WIFI_PASSWORD";
constexpr char MqttUsername[] = "YOUR_MQTT_USERNAME";
constexpr char MqttPassword[] = "YOUR_MQTT_PASSWORD";
constexpr char brokerUrl[] = "mqtts://g916bd01.ala.us-east-1.emqxsl.com:8883";
// ===== AKHIR KONFIGURASI ALAT =====

// ========================== 1. KONFIGURASI WI-FI & EMQX CLOUD ================


// Topik MQTT
const String TopicTelemetryValue = String("bayu/stations/") + StationId + "/telemetry";
const char* TopicTelemetry = TopicTelemetryValue.c_str();
const String TopicCommandValue = String("bayu/stations/") + StationId + "/cmd";
const char* TopicCommand = TopicCommandValue.c_str();
const String TopicAckValue = String("bayu/stations/") + StationId + "/ack";
const char* TopicAck = TopicAckValue.c_str();
const String TopicConfigValue = String("bayu/stations/") + StationId + "/config";
const char* TopicConfig = TopicConfigValue.c_str();

// Sertifikat Root CA DigiCert Global Root G2 (TLS Port 8883 EMQX Cloud)
constexpr char BrokerCa[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
)PEM";

// ========================== 2. PEMETAAN PIN HARDWARE =========================
#define PIN_ANEMOMETER      4     // GPIO 4 : Anemometer Interrupt
#define PIN_ANALOG_VANE     34    // GPIO 34: Sensor Arah Mode Analog (ADC1)
#define PIN_BUZZER_1        18    // GPIO 18: Buzzer Utama
#define PIN_BUZZER_2        19    // GPIO 19: Buzzer Tambahan
#define PIN_RGB_RED         25    // GPIO 25: LED RGB Merah
#define PIN_RGB_GREEN       26    // GPIO 26: LED RGB Hijau
#define PIN_RGB_BLUE        27    // GPIO 27: LED RGB Biru
#define PIN_BUTTON          13    // GPIO 13: Push Button Mute

#define I2C_SDA_PIN         21    // GPIO 21: Bus I2C Data Sensor Arah AS5600
#define I2C_SCL_PIN         22    // GPIO 22: Bus I2C Clock Sensor Arah AS5600
#define AS5600_ADDR         0x36  // Alamat I2C tetap IC AS5600

#define GPS_RX_PIN          16    // GPIO 16 (RX2 ESP32) <- TX Modul GPS
#define GPS_TX_PIN          17    // GPIO 17 (TX2 ESP32) -> RX Modul GPS
#define GPS_BAUDRATE        9600  // Baud rate standar modul GPS

// ========================== 3. PARAMETER & THRESHOLD =========================
bool isBuzzerActiveLow      = false; // false = Active-HIGH (0V=Mati Senyap, 3.3V=Bunyi)
bool isCommonAnode          = false; // false = Common Cathode (GND), true = Common Anode (3.3V)
bool hardMute               = false; // Paksa senyap total via Serial 'x'

const int FREQ_WARN         = 2400; // Frekuensi waspada (Hz)
const int FREQ_DANGER_1     = 3000; // Frekuensi bahaya 1 (Hz)
const int FREQ_DANGER_2     = 3500; // Frekuensi bahaya 2 (Hz)

const float CUP_RADIUS_M    = 0.085f;
const float K_AERO          = 1.85f;
const int   MAGNETS_PER_REV = 1;

// Ambang Batas Responsif untuk Pengujian (Bisa ditiup / diputar pakai tangan)
float SPEED_SAFE_MAX  = 5.0f;   // < 5.0 km/h  -> AMAN (Hijau solid, Buzzer mati total)
float SPEED_WARN_MAX  = 15.0f;  // 5.0 - 15.0 km/h -> WASPADA (Kuning, Beep waspada)
                                      // >= 15.0 km/h -> BAHAYA (Merah kedip, Alarm bahaya)

const uint32_t MUTE_SNOOZE_MS = 300000UL; // 5 Menit (5 * 60 * 1000 ms)

// ========================== 4. VARIABEL GLOBAL ===============================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
Preferences prefs;

esp_mqtt_client_handle_t mqttClient = nullptr;
std::atomic<bool> mqttConnected{false};
std::atomic<uint32_t> pendingNorthCalibrationNonce{0};
std::atomic<uint32_t> pendingTelemetryNonce{0};
struct AlarmConfig {
  float warningKmh;
  float dangerKmh;
  uint64_t revision;
  uint32_t nonce;
};
portMUX_TYPE configMux = portMUX_INITIALIZER_UNLOCKED;
AlarmConfig pendingAlarmConfig{};
bool hasPendingAlarmConfig = false;
uint64_t appliedConfigRevision = 0;


enum SystemState {
  STATE_NORMAL_SAFE = 0,
  STATE_WIND_WARNING,
  STATE_WIND_DANGER
};

SystemState currentState  = STATE_NORMAL_SAFE;
SystemState previousState = STATE_NORMAL_SAFE;

bool globalMuted          = false;
uint32_t muteStartTime    = 0;
bool as5600I2CDetected    = false;
bool as5600MagnetDetected = false;
float northOffsetDeg      = 0.0f;
char lastArahSource[32]   = "Belum Dibaca";
float lastRawAngleDeg     = 0.0f;

volatile unsigned long pulseCounter = 0;
volatile unsigned long lastPulseTimeMicros = 0;
unsigned long lastSampleTime        = 0;
const unsigned long SAMPLE_MS       = 1000; // Kirim data tiap 1 detik

unsigned long lastBuzzerToggle      = 0;
bool buzzerToggleState              = false;

int lastButtonReading               = HIGH;
int stableButtonState               = HIGH;
unsigned long lastDebounceTime      = 0;
uint32_t packetIdCounter            = 0;

// State Telemetri Node 1
struct TelemetryData {
  float windKmh = 0.0f;
  float windMps = 0.0f;
  float rpm = 0.0f;
  float windDeg = 0.0f;
  char  windDir[4] = "U";
  uint8_t statusCode = 0; // 0=AMAN, 1=WASPADA, 2=BAHAYA
  float gpsLat = -7.76211f;
  float gpsLon = 110.40928f;
  uint8_t gpsSats = 0;
  bool gpsFix = false;
} liveData;

// ========================== 5. INTERRUPT ANEMOMETER ==========================
void IRAM_ATTR isrAnemometer() {
  unsigned long now = micros();
  // Filter debounce 10ms (10000 us): Mencegah chattering kontak reed switch saat putaran melambat atau berhenti
  if (now - lastPulseTimeMicros >= 10000) {
    pulseCounter++;
    lastPulseTimeMicros = now;
  }
}

// ========================== 6. HELPER MATA ANGIN & SENSOR ARAH ===============
const char* getWindCardinal(float deg) {
  if (deg < 0.0f) deg += 360.0f;
  if (deg >= 360.0f) deg -= 360.0f;
  if (deg >= 337.5f || deg < 22.5f)  return "U";
  if (deg >= 22.5f  && deg < 67.5f)  return "TL";
  if (deg >= 67.5f  && deg < 112.5f) return "T";
  if (deg >= 112.5f && deg < 157.5f) return "TG";
  if (deg >= 157.5f && deg < 202.5f) return "S";
  if (deg >= 202.5f && deg < 247.5f) return "BD";
  if (deg >= 247.5f && deg < 292.5f) return "B";
  if (deg >= 292.5f && deg < 337.5f) return "BL";
  return "--";
}

const char* statusToStr(uint8_t code) {
  switch (code) {
    case 1:  return "WASPADA";
    case 2:  return "BAHAYA";
    default: return "AMAN";
  }
}

// Fungsi pembacaan sudut raw (0.0 - 359.9°) dari I2C AS5600 atau Analog Pin 34
float getRawAngleDegrees() {
  // 1. Coba baca I2C AS5600 (Register 0x0B Status & 0x0C RAW ANGLE dengan Repeated Start)
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(0x0B); // Register STATUS
  if (Wire.endTransmission(false) == 0) {
    if (Wire.requestFrom((uint8_t)AS5600_ADDR, (uint8_t)1) >= 1) {
      uint8_t st = Wire.read();
      as5600MagnetDetected = (st & 0x20) != 0; // Bit 5: Magnet Detected (MD)
    }

    Wire.beginTransmission(AS5600_ADDR);
    Wire.write(0x0C); // Register RAW ANGLE (0x0C MSB, 0x0D LSB)
    if (Wire.endTransmission(false) == 0) {
      if (Wire.requestFrom((uint8_t)AS5600_ADDR, (uint8_t)2) >= 2) {
        uint8_t msb = Wire.read();
        uint8_t lsb = Wire.read();
        uint16_t rawAngle = ((uint16_t)(msb & 0x0F) << 8) | lsb;
        lastRawAngleDeg = ((float)rawAngle * 360.0f) / 4096.0f;
        as5600I2CDetected = true;
        if (as5600MagnetDetected) {
          snprintf(lastArahSource, sizeof(lastArahSource), "I2C 0x36 (Mag OK)");
        } else {
          snprintf(lastArahSource, sizeof(lastArahSource), "I2C 0x36 (NO MAGNET!)");
        }
        return lastRawAngleDeg;
      }
    }
  }

  // 2. Jika I2C tidak merespon, fallback ke Pin Analog 34 (OUT AS5600)
  uint32_t adcSum = 0;
  for (int i = 0; i < 16; i++) {
    adcSum += analogRead(PIN_ANALOG_VANE);
    delayMicroseconds(50);
  }
  float adcAvg = (float)adcSum / 16.0f;
  lastRawAngleDeg = (adcAvg / 4095.0f) * 360.0f;

  if (adcAvg > 40.0f) {
    snprintf(lastArahSource, sizeof(lastArahSource), "ANALOG Pin 34");
  } else {
    snprintf(lastArahSource, sizeof(lastArahSource), "TIDAK TERHUBUNG (0V)");
  }
  return lastRawAngleDeg;
}

// Pembacaan Sensor Arah setelah dikurangi Offset Kalibrasi Utara
float readWindDirectionDegrees() {
  float rawDeg = getRawAngleDegrees();

  float calDeg = rawDeg - northOffsetDeg;
  while (calDeg < 0.0f)   calDeg += 360.0f;
  while (calDeg >= 360.0f) calDeg -= 360.0f;
  return calDeg;
}

// ========================== 7. DRIVER ACTUATOR (LED & BUZZER) ================
void setRGB(bool r, bool g, bool b) {
  if (isCommonAnode) {
    digitalWrite(PIN_RGB_RED,   r ? LOW : HIGH);
    digitalWrite(PIN_RGB_GREEN, g ? LOW : HIGH);
    digitalWrite(PIN_RGB_BLUE,  b ? LOW : HIGH);
  } else {
    digitalWrite(PIN_RGB_RED,   r ? HIGH : LOW);
    digitalWrite(PIN_RGB_GREEN, g ? HIGH : LOW);
    digitalWrite(PIN_RGB_BLUE,  b ? HIGH : LOW);
  }
}

void setBuzzerState(bool active) {
  pinMode(PIN_BUZZER_1, OUTPUT);
  pinMode(PIN_BUZZER_2, OUTPUT);

  if (active && !globalMuted && !hardMute) {
    if (isBuzzerActiveLow) {
      digitalWrite(PIN_BUZZER_1, LOW);
      digitalWrite(PIN_BUZZER_2, LOW);
    } else {
      digitalWrite(PIN_BUZZER_1, HIGH);
      digitalWrite(PIN_BUZZER_2, HIGH);
    }
  } else {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    noTone(PIN_BUZZER_1);
    noTone(PIN_BUZZER_2);
#endif
    if (isBuzzerActiveLow) {
      digitalWrite(PIN_BUZZER_1, HIGH);
      digitalWrite(PIN_BUZZER_2, HIGH);
    } else {
      digitalWrite(PIN_BUZZER_1, LOW);
      digitalWrite(PIN_BUZZER_2, LOW);
    }
  }
}

void updateActuators() {
  unsigned long now = millis();

  // 1. Cek Timeout 5 Menit Mute:
  if (globalMuted && (currentState != STATE_NORMAL_SAFE)) {
    if (now - muteStartTime >= MUTE_SNOOZE_MS) {
      globalMuted = false;
      muteStartTime = 0;
      Serial.println(F("\n[SNOOZE EXPIRED NODE 1] Sudah 5 menit & angin masih kencang! Buzzer kembali aktif!\n"));
    }
  }

  // 2. Jika kondisi NORMAL (AMAN / kecepatan < 5 km/h):
  if (currentState == STATE_NORMAL_SAFE) {
    setRGB(false, true, false); // Hijau Solid
    setBuzzerState(false);      // Buzzer DIEM / MATI TOTAL (0V/LOW)
    globalMuted = false;        // Reset status mute
    muteStartTime = 0;
    return;
  }

  // 3. Jika kondisi ABNORMAL:
  if (currentState == STATE_WIND_DANGER) {
    // BAHAYA (>= 15.0 km/h): Merah kedip cepat & Sirine cepat
    bool blinkFast = (now / 150) % 2;
    setRGB(blinkFast, false, false);
    setBuzzerState(blinkFast);
  } else if (currentState == STATE_WIND_WARNING) {
    // WASPADA (5.0 - 15.0 km/h): Kuning Solid & Beep berkala
    setRGB(true, true, false);
    bool beep = (now / 500) % 2;
    setBuzzerState(beep);
  } else {
    setBuzzerState(false);
  }
}

// ========================== 8. MQTT PUBLISH & EVENT ==========================
void publishMuteCommand(bool muteVal) {
  if (!mqttConnected || mqttClient == nullptr) return;
  char payload[64];
  snprintf(payload, sizeof(payload), "{\"cmd\":\"mute\",\"is_muted\":%s}", muteVal ? "true" : "false");
  esp_mqtt_client_publish(mqttClient, TopicCommand, payload, 0, 1, 0);
  Serial.printf("[MQTT CLOUD] Memancarkan status MUTE = %s ke Cloud Database\n", muteVal ? "ON" : "OFF");
}

void publishCommandAck(const char *command, uint32_t nonce) {
  if (!mqttConnected || mqttClient == nullptr) return;
  char payload[96];
  snprintf(payload, sizeof(payload),
           "{\"cmd\":\"%s\",\"nonce\":%lu,\"status\":\"applied\"}",
           command, (unsigned long)nonce);
  esp_mqtt_client_publish(mqttClient, TopicAck, payload, 0, 1, 0);
}

void mqttEventCallback(void *, esp_event_base_t, int32_t eventId, void *eventData) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)eventData;
  if (eventId == MQTT_EVENT_CONNECTED) {
    mqttConnected = true;
    Serial.println(F("[EMQX CLOUD] Node 1 Terhubung ke Broker TLS (Port 8883) Sukses!"));
    // Berlangganan topik perintah kontrol (Mute)
    esp_mqtt_client_subscribe(mqttClient, TopicCommand, 1);
    esp_mqtt_client_subscribe(mqttClient, TopicConfig, 1);
  } else if (eventId == MQTT_EVENT_DISCONNECTED || eventId == MQTT_EVENT_ERROR) {
    mqttConnected = false;
    Serial.println(F("[EMQX CLOUD] Node 1 Terputus. Menjadwalkan coba ulang..."));
  } else if (eventId == MQTT_EVENT_DATA) {
    // Menerima perintah remote via MQTT (misal tombol mute ditekan di Node 2)
    // Commands/configurations fit in one MQTT event; reject fragmented or oversized data.
    if (event->current_data_offset != 0 || event->data_len != event->total_data_len) return;
    const bool configTopic = event->topic_len == strlen(TopicConfig) &&
      memcmp(event->topic, TopicConfig, event->topic_len) == 0;
    const bool commandTopic = event->topic_len == strlen(TopicCommand) &&
      memcmp(event->topic, TopicCommand, event->topic_len) == 0;
    if (!configTopic && !commandTopic) return;
    if (configTopic) {
      JsonDocument config;
      if (deserializeJson(config, event->data, event->data_len)) return;
      if (strcmp(config["cmd"] | "", "apply_settings") != 0) return;
      AlarmConfig incoming{
        config["warningKmh"] | -1.0f,
        config["dangerKmh"] | -1.0f,
        config["revision"] | (uint64_t)0,
        config["nonce"] | 0U
      };
      if (!isfinite(incoming.warningKmh) || !isfinite(incoming.dangerKmh) ||
          incoming.warningKmh < 0 || incoming.dangerKmh <= incoming.warningKmh ||
          incoming.dangerKmh > 200 || incoming.revision == 0 || incoming.nonce == 0) return;
      portENTER_CRITICAL(&configMux);
      pendingAlarmConfig = incoming;
      hasPendingAlarmConfig = true;
      portEXIT_CRITICAL(&configMux);
      return;
    }

    if (event->data_len > 0) {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, event->data, event->data_len);
      if (!err && strcmp(doc["cmd"] | "", "calibrate_zero") == 0) {
        uint32_t nonce = doc["nonce"] | 0U;
        if (nonce != 0) {
          pendingNorthCalibrationNonce = nonce;
          Serial.println(F("[MQTT CLOUD] Perintah kalibrasi utara diterima."));
        }
        return;
      }
      if (!err && strcmp(doc["cmd"] | "", "request_telemetry") == 0) {
        uint32_t nonce = doc["nonce"] | 0U;
        if (nonce != 0) pendingTelemetryNonce = nonce;
        return;
      }
      if (!err && (strcmp(doc["cmd"] | "", "buzzer_mute") == 0 ||
                   strcmp(doc["cmd"] | "", "buzzer_unmute") == 0)) {
        uint32_t nonce = doc["nonce"] | 0U;
        bool mute = strcmp(doc["cmd"] | "", "buzzer_mute") == 0;
        globalMuted = mute;
        muteStartTime = mute ? millis() : 0;
        if (mute) setBuzzerState(false);
        if (nonce != 0) publishCommandAck(mute ? "buzzer_mute" : "buzzer_unmute", nonce);
        return;
      }
      if (!err && doc.containsKey("is_muted")) {
        globalMuted = doc["is_muted"];
        if (globalMuted) {
          muteStartTime = millis();
          setBuzzerState(false);
          Serial.println(F("[SYNC MUTE VIA CLOUD] Alarm disenyapkan selama 5 menit!"));
        } else {
          muteStartTime = 0;
        }
      }
    }
  }
}

void startMqtt() {
  if (mqttClient != nullptr) return;

  Serial.println(F("[EMQX CLOUD] Inisialisasi koneksi MQTT TLS Node 1..."));
  esp_mqtt_client_config_t config{};
  config.broker.address.uri = brokerUrl;
  config.broker.verification.certificate = BrokerCa;
  config.credentials.username = MqttUsername;
  config.credentials.authentication.password = MqttPassword;
  config.credentials.client_id = "aerosense-node1-outdoor-station";
  config.outbox.limit = 2048;

  mqttClient = esp_mqtt_client_init(&config);
  if (!mqttClient) {
    Serial.println(F("[EMQX CLOUD] Gagal inisialisasi mqtt_client"));
    return;
  }
  if (esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, mqttEventCallback, nullptr) != ESP_OK ||
      esp_mqtt_client_start(mqttClient) != ESP_OK) {
    Serial.println(F("[EMQX CLOUD] Gagal memulai mqtt_client"));
    esp_mqtt_client_destroy(mqttClient);
    mqttClient = nullptr;
  }
}

void publishTelemetryToDatabase() {
  if (!mqttConnected || mqttClient == nullptr) return;

  char payload[512];
  snprintf(payload, sizeof(payload),
           "{"
           "\"stationId\":\"%s\","
           "\"windSpeedKmh\":%.2f,"
           "\"windDirectionDeg\":%.2f,"
           "\"station_id\":\"%s\","
           "\"speed_kmh\":%.2f,"
           "\"speed_mps\":%.2f,"
           "\"direction_deg\":%.2f,"
           "\"cardinal\":\"%s\","
           "\"status\":\"%s\","
           "\"status_code\":%u,"
           "\"gps\":{\"lat\":%.5f,\"lon\":%.5f,\"sats\":%u,\"fix\":%s},"
           "\"is_muted\":%s,"
           "\"packet_id\":%u,"
           "\"rssi\":%d,"
            "\"uptime_s\":%lu,"
            "\"heap_kb\":%lu"
           "}",
           StationId,
           liveData.windKmh,
           liveData.windDeg,
           StationId,
           liveData.windKmh,
           liveData.windMps,
           liveData.windDeg,
           liveData.windDir,
           statusToStr(liveData.statusCode),
           liveData.statusCode,
           liveData.gpsLat,
           liveData.gpsLon,
           liveData.gpsSats,
           liveData.gpsFix ? "true" : "false",
           globalMuted ? "true" : "false",
           ++packetIdCounter,
           WiFi.RSSI(),
            millis() / 1000,
            (unsigned long)(ESP.getFreeHeap() / 1024));

  esp_mqtt_client_publish(mqttClient, TopicTelemetry, payload, 0, 1, 0);
}

void applyPendingWebConfig() {
  AlarmConfig incoming{};
  portENTER_CRITICAL(&configMux);
  const bool pending = hasPendingAlarmConfig;
  if (pending) {
    incoming = pendingAlarmConfig;
    hasPendingAlarmConfig = false;
  }
  portEXIT_CRITICAL(&configMux);
  if (!pending || incoming.revision < appliedConfigRevision) return;
  if (incoming.revision == appliedConfigRevision) {
    if (incoming.warningKmh == SPEED_SAFE_MAX && incoming.dangerKmh == SPEED_WARN_MAX)
      publishCommandAck("apply_settings", incoming.nonce);
    return;
  }
  JsonDocument config;
  config["warningKmh"] = incoming.warningKmh;
  config["dangerKmh"] = incoming.dangerKmh;
  config["revision"] = incoming.revision;
  String serialized;
  serializeJson(config, serialized);
  if (prefs.putString("webAlarm", serialized) == 0) return;
  SPEED_SAFE_MAX = incoming.warningKmh;
  SPEED_WARN_MAX = incoming.dangerKmh;
  appliedConfigRevision = incoming.revision;
  publishCommandAck("apply_settings", incoming.nonce);
  Serial.println(F("[WEB CONFIG] Ambang alarm tersimpan di ESP."));
}

// ========================== 9. INPUT TOMBOL & KALIBRASI SERIAL ===============
bool calibrateNorth() {
  as5600I2CDetected = false;
  as5600MagnetDetected = false;
  const float measured = getRawAngleDegrees();
  if (!as5600I2CDetected || !as5600MagnetDetected || !isfinite(measured)) {
    Serial.println(F("[KALIBRASI DITOLAK] Periksa AS5600 I2C dan magnet."));
    return false;
  }
  if (prefs.putFloat("north", measured) == 0) return false;
  northOffsetDeg = measured;

  Serial.println(F("\n>>> [KALIBRASI UTARA SUKSES] Titik ini dikunci sebagai UTARA (0.0 deg)! <<<"));
  Serial.printf(">>> Sumber Sensor: %s | Nilai Offset Disimpan: %.1f derajat <<<\n\n", lastArahSource, northOffsetDeg);
  return true;
}

void handleSerialCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'c' || c == 'C' || c == 's' || c == 'S' || c == 'z' || c == 'Z') {
      calibrateNorth();
    } else if (c == 'd' || c == 'D') {
      Serial.println(F("\n======================================================="));
      Serial.println(F("  DIAGNOSTIK REAL-TIME SENSOR ARAH ANGIN NODE 1       "));
      Serial.println(F("======================================================="));
      Wire.beginTransmission(AS5600_ADDR);
      int i2cStat = Wire.endTransmission();
      Serial.printf(" 1. Bus I2C (Pin SDA 21, SCL 22) Alamat 0x36: %s (Status: %d)\n",
                    (i2cStat == 0) ? "TERHUBUNG (OK!)" : "TIDAK MERESPON / TIDAK TERDETEKSI!", i2cStat);
      if (i2cStat == 0) {
        Wire.beginTransmission(AS5600_ADDR);
        Wire.write(0x0B);
        Wire.endTransmission(false);
        Wire.requestFrom((uint8_t)AS5600_ADDR, (uint8_t)1);
        uint8_t st = Wire.available() ? Wire.read() : 0;
        Serial.printf(" 2. Sensor Magnet Status (Reg 0x0B = 0x%02X):\n", st);
        Serial.printf("    - Magnet Detected (MD) : %s\n", (st & 0x20) ? "YA (TERDETEKSI!)" : "TIDAK ADA MAGNET! (Dekatkan magnet 1-2 mm di atas chip!)");
        Serial.printf("    - Magnet Too Weak (ML) : %s\n", (st & 0x10) ? "YA (Magnet terlalu jauh / lemah)" : "TIDAK (Jarak normal)");
        Serial.printf("    - Magnet Too High (MH) : %s\n", (st & 0x08) ? "YA (Magnet terlalu dekat / kuat)" : "TIDAK (Normal)");

        Wire.beginTransmission(AS5600_ADDR);
        Wire.write(0x0C);
        Wire.endTransmission(false);
        Wire.requestFrom((uint8_t)AS5600_ADDR, (uint8_t)2);
        if (Wire.available() >= 2) {
          uint16_t raw = ((Wire.read() & 0x0F) << 8) | Wire.read();
          Serial.printf(" 3. I2C Raw Angle (0x0C): %d / 4095 (%.1f derajat)\n", raw, ((float)raw * 360.0f) / 4096.0f);
        }
      }
      int adc = analogRead(PIN_ANALOG_VANE);
      float vAdc = ((float)adc / 4095.0f) * 3.3f;
      Serial.printf(" 4. Pin Analog 34 (ADC Fallback) : %d counts (%.2f Volt -> %.1f derajat)\n",
                    adc, vAdc, ((float)adc / 4095.0f) * 360.0f);
      Serial.printf(" 5. Offset Kalibrasi Utara       : %.1f derajat (Ketik 'r' untuk reset ke 0)\n", northOffsetDeg);
      Serial.printf(" 6. HASIL AKHIR ARAH ANGIN       : %.1f derajat (Mata Angin: %s)\n",
                    readWindDirectionDegrees(), getWindCardinal(readWindDirectionDegrees()));
      Serial.println(F("=======================================================\n"));
    } else if (c == 'p' || c == 'P') {
      isBuzzerActiveLow = !isBuzzerActiveLow;
      setBuzzerState(false);
      Serial.printf("\n>>> [BUZZER NODE 1] Polaritas diubah: %s <<<\n\n",
                    isBuzzerActiveLow ? "ACTIVE-LOW (HIGH=Mati, LOW=Bunyi)" : "ACTIVE-HIGH (LOW=Mati, HIGH=Bunyi)");
    } else if (c == 'x' || c == 'X') {
      hardMute = !hardMute;
      setBuzzerState(false);
      Serial.printf("\n>>> [BUZZER NODE 1] Hard Mute: %s <<<\n\n", hardMute ? "SENYAP TOTAL" : "NORMAL");
    } else if (c == 'a' || c == 'A') {
      isCommonAnode = !isCommonAnode;
      Serial.printf("\n>>> [LED RGB NODE 1] Mode LED: %s <<<\n\n",
                    isCommonAnode ? "COMMON ANODE (3.3V)" : "COMMON CATHODE (GND)");
    } else if (c == '1') {
      Serial.println(F("[TES NODE 1] LED Merah 1.5 detik..."));
      setRGB(true, false, false); delay(1500); setRGB(false, false, false);
    } else if (c == '2') {
      Serial.println(F("[TES NODE 1] LED Hijau 1.5 detik..."));
      setRGB(false, true, false); delay(1500); setRGB(false, false, false);
    } else if (c == '3') {
      Serial.println(F("[TES NODE 1] LED Biru 1.5 detik..."));
      setRGB(false, false, true); delay(1500); setRGB(false, false, false);
    } else if (c == '4') {
      Serial.println(F("[TES NODE 1] Buzzer 1 detik..."));
      setBuzzerState(true); delay(1000); setBuzzerState(false);
    } else if (c == 'm' || c == 'M') {
      globalMuted = !globalMuted;
      muteStartTime = globalMuted ? millis() : 0;
      if (globalMuted) setBuzzerState(false);
      publishMuteCommand(globalMuted);
      Serial.printf("\n>>> [MUTE TOGGLE] Status Buzzer: %s <<<\n\n", globalMuted ? "SENYAP (5 MENIT)" : "AKTIF (UNMUTED)");
    } else if (c == 'r' || c == 'R') {
      northOffsetDeg = 0.0f;
      prefs.putFloat("north", 0.0f);
      Serial.println(F("\n>>> [RESET KALIBRASI] Offset Utara dikembalikan ke 0.0 derajat <<<\n"));
    }
  }
}

void handleButtonInput() {
  int reading = digitalRead(PIN_BUTTON);
  unsigned long now = millis();

  if (reading != lastButtonReading) {
    lastDebounceTime = now;
  }

  if ((now - lastDebounceTime) > 35) {
    if (reading != stableButtonState) {
      stableButtonState = reading;
      if (stableButtonState == LOW) {
        Serial.println(F("[TOMBOL NODE 1] Ditekan!"));
        if (currentState != STATE_NORMAL_SAFE) {
          globalMuted = true;
          muteStartTime = millis();
          setBuzzerState(false);
          publishMuteCommand(true);
          Serial.println(F("[TOMBOL NODE 1] Alarm abnormal disenyapkan selama 5 menit!"));
        } else {
          Serial.println(F("[TOMBOL NODE 1] Angin dalam kondisi AMAN, tidak ada alarm yang perlu disenyapkan."));
        }
      }
    }
  }
  lastButtonReading = reading;
}

// ========================== 10. SETUP ========================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println(F("\n======================================================="));
  Serial.println(F("  AEROSENSE IOT - NODE 1: PENGIRIM SENSOR (CLOUD DB)   "));
  Serial.println(F("======================================================="));

  // Konfigurasi Pin Hardware
  pinMode(PIN_ANEMOMETER, INPUT_PULLUP);
  pinMode(PIN_ANALOG_VANE, INPUT);
  pinMode(PIN_RGB_RED, OUTPUT);
  pinMode(PIN_RGB_GREEN, OUTPUT);
  pinMode(PIN_RGB_BLUE, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER_1, OUTPUT);
  pinMode(PIN_BUZZER_2, OUTPUT);
  setBuzzerState(false);
  setRGB(false, false, false);

  // Baca kalibrasi offset Utara dari memori Flash
  prefs.begin("aerosense", false);
  northOffsetDeg = prefs.getFloat("north", 0.0f);
  JsonDocument storedWebConfig;
  const String storedAlarm = prefs.getString("webAlarm", "");
  if (!deserializeJson(storedWebConfig, storedAlarm)) {
    const float warning = storedWebConfig["warningKmh"] | -1.0f;
    const float danger = storedWebConfig["dangerKmh"] | -1.0f;
    if (isfinite(warning) && isfinite(danger) && warning >= 0 && danger > warning && danger <= 200) {
      SPEED_SAFE_MAX = warning;
      SPEED_WARN_MAX = danger;
      appliedConfigRevision = storedWebConfig["revision"] | (uint64_t)0;
    }
  }

  Serial.printf("[MEMORI] Offset Arah Utara: %.1f derajat\n", northOffsetDeg);

  // Inisialisasi I2C Sensor AS5600
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  delay(50);
  Wire.beginTransmission(AS5600_ADDR);
  if (Wire.endTransmission() == 0) {
    as5600I2CDetected = true;
    Serial.println(F("[OK] Sensor AS5600 terdeteksi pada I2C 0x36."));
  } else {
    as5600I2CDetected = false;
    Serial.println(F("[INFO] AS5600 I2C tidak aktif, beralih ke Mode Analog (Pin 34)."));
  }

  // Inisialisasi UART2 GPS
  gpsSerial.begin(GPS_BAUDRATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println(F("[OK] GPS UART2 aktif di GPIO 16 (RX2) & GPIO 17 (TX2)."));

  // Beep startup dan tes LED
  setRGB(true, false, false); delay(150);
  setRGB(false, true, false); delay(150);
  setRGB(false, false, true); delay(150);
  setRGB(false, true, false);

  // Inisialisasi Wi-Fi Station
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  Serial.printf("[WIFI] Menghubungkan ke '%s'...\n", WifiSsid);
  WiFi.begin(WifiSsid, WifiPassword);
  WiFi.setDNS(IPAddress(8, 8, 8, 8), IPAddress(1, 1, 1, 1));

  // Pasang interrupt anemometer
  attachInterrupt(digitalPinToInterrupt(PIN_ANEMOMETER), isrAnemometer, FALLING);

  Serial.println(F("-------------------------------------------------------"));
  Serial.println(F("Panduan Perintah Serial Node 1:"));
  Serial.println(F(" 1. 'c' / 's' : Kalibrasi Arah Angin (Arahkan bilah ke UTARA lalu ENTER)"));
  Serial.printf( " 2. 'p'       : Balik Polaritas Buzzer (Sekarang: %s)\n", isBuzzerActiveLow ? "ACTIVE-LOW (HIGH=Mati)" : "ACTIVE-HIGH (LOW=Mati)");
  Serial.println(F(" 3. 'x'       : Paksa Senyap Buzzer Total (Hard Mute ON/OFF)"));
  Serial.println(F(" 4. 'm'       : Mute / Unmute Buzzer (Snooze 5 Menit)"));
  Serial.printf( " 5. 'a'       : Balik Polaritas LED RGB (Sekarang: %s)\n", isCommonAnode ? "COMMON ANODE (3.3V)" : "COMMON CATHODE (GND)");
  Serial.println(F(" 6. '1'/'2'/'3' : Tes Manual LED Merah / Hijau / Biru"));
  Serial.println(F(" 7. '4'       : Tes Manual Buzzer 1 Detik"));
  Serial.println(F(" 8. 'd'       : Diagnostik Detail Sensor Arah (Cek I2C, Magnet & Analog)"));
  Serial.println(F(" 9. 'r'       : Reset Kalibrasi Utara ke 0.0 Derajat"));
  Serial.println(F("-------------------------------------------------------\n"));
  Serial.println(F("[OK] Node 1 Aktif & Mengirim Telemetri ke Cloud Database!\n"));
}

// ========================== 11. LOOP UTAMA ===================================
void loop() {
  static uint32_t lastMqttAttempt = 0;
  static bool wifiWasConnected = false;
  unsigned long now = millis();

  // 1. Baca data GPS secara streaming
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. Cek input tombol Mute & Serial Kalibrasi
  handleButtonInput();
  handleSerialCommands();
  applyPendingWebConfig();
  uint32_t calibrationNonce = pendingNorthCalibrationNonce.exchange(0);
  if (calibrationNonce != 0) {
    if (calibrateNorth()) publishCommandAck("calibrate_zero", calibrationNonce);
  }
  uint32_t telemetryNonce = pendingTelemetryNonce.exchange(0);
  if (telemetryNonce != 0) {
    publishTelemetryToDatabase();
    publishCommandAck("request_telemetry", telemetryNonce);
  }

  // 3. Manajemen Wi-Fi & Auto-Connect MQTT dengan NTP
  bool isWifiConnected = (WiFi.status() == WL_CONNECTED);
  static uint32_t lastWifiRetry = 0;

  if (isWifiConnected && !wifiWasConnected) {
    wifiWasConnected = true;
    Serial.printf("\n[WIFI SUKSES] IP: %s | Sinyal: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else if (!isWifiConnected) {
    wifiWasConnected = false;
    // Coba sambung ulang otomatis setiap 7 detik jika terputus/gagal
    if (now - lastWifiRetry >= 7000) {
      lastWifiRetry = now;
      Serial.printf("[WIFI] Sedang mencoba menyambung ke '%s'...\n", WifiSsid);
      WiFi.disconnect();
      WiFi.begin(WifiSsid, WifiPassword);
    }
  }

  // Hubungkan ke MQTT jika Wi-Fi sudah tersambung
  if (isWifiConnected && (now - lastMqttAttempt >= 5000)) {
    lastMqttAttempt = now;
    time_t nowSec = time(nullptr);
    if (nowSec > 1700000000) {
      if (mqttClient == nullptr) {
        Serial.printf("[NTP] Jam Internet Sinkron (%ld). Memulai TLS MQTT...\n", (long)nowSec);
        startMqtt();
      } else if (!mqttConnected) {
        Serial.println(F("[EMQX CLOUD] Mencoba menghubungkan ulang ke broker TLS..."));
        esp_mqtt_client_reconnect(mqttClient);
      }
    } else {
      Serial.println(F("[NTP] Menunggu jam internet sinkron untuk TLS..."));
    }
  }

  // 4. Periode Pengambilan Sample & Transmisi ke Database (Tiap 1 Detik)
  if (now - lastSampleTime >= SAMPLE_MS) {
    unsigned long sampleSec = (now - lastSampleTime);
    lastSampleTime = now;

    // Hitung kecepatan angin dari pulsa anemometer
    noInterrupts();
    unsigned long p = pulseCounter;
    pulseCounter = 0;
    interrupts();

    float sSec = (float)sampleSec / 1000.0f;
    liveData.rpm = ((float)p / (float)MAGNETS_PER_REV) * (60.0f / sSec);
    liveData.windMps = ((2.0f * 3.14159265f * CUP_RADIUS_M * liveData.rpm) / 60.0f) * K_AERO;
    liveData.windKmh = liveData.windMps * 3.6f;

    // Baca arah angin & derajat
    liveData.windDeg = readWindDirectionDegrees();
    const char* card = getWindCardinal(liveData.windDeg);
    strncpy(liveData.windDir, card, sizeof(liveData.windDir) - 1);
    liveData.windDir[sizeof(liveData.windDir) - 1] = '\0';

    // Baca koordinat GPS
    if (gps.location.isValid()) {
      liveData.gpsFix  = true;
      liveData.gpsLat  = (float)gps.location.lat();
      liveData.gpsLon  = (float)gps.location.lng();
      liveData.gpsSats = (uint8_t)gps.satellites.value();
    } else {
      liveData.gpsFix  = false;
      liveData.gpsLat  = -7.76211f;
      liveData.gpsLon  = 110.40928f;
      liveData.gpsSats = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
    }

    // Tentukan status bahaya
    if (liveData.windKmh >= SPEED_WARN_MAX) {
      liveData.statusCode = 2; // BAHAYA
      currentState = STATE_WIND_DANGER;
    } else if (liveData.windKmh >= SPEED_SAFE_MAX) {
      liveData.statusCode = 1; // WASPADA
      currentState = STATE_WIND_WARNING;
    } else {
      liveData.statusCode = 0; // AMAN
      currentState = STATE_NORMAL_SAFE;
    }

    if (currentState == STATE_NORMAL_SAFE) {
      setBuzzerState(false); // Langsung putus arus buzzer ke 0V (senyap total) tanpa tunda
      if (previousState != STATE_NORMAL_SAFE) {
        globalMuted = false;
        muteStartTime = 0;
      }
    }
    previousState = currentState;

    // Publish data ke Cloud Database via MQTT TLS
    publishTelemetryToDatabase();

    const char* stTxt = (currentState == STATE_WIND_DANGER)  ? "BAHAYA" :
                        (currentState == STATE_WIND_WARNING) ? "WASPADA" : "AMAN";

    Serial.printf("[NODE 1 -> CLOUD DB:%s] Angin: %4.1f km/h | Arah: %5.1f* (%-2s) [%s] | Status: %-7s | Mute: %s\n",
                  mqttConnected ? "TERKIRIM" : "OFFLINE",
                  liveData.windKmh, liveData.windDeg, liveData.windDir,
                  lastArahSource,
                  stTxt, globalMuted ? "YA" : "TIDAK");
  }

  // 5. Update alarm lokal
  updateActuators();
}
