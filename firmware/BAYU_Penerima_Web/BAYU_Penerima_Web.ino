// BAYU: menerima telemetri dan status alarm dari pengirim yang dikonfigurasi web.
/*
 * BAYU_Penerima_Web
 * LCD, LED dan buzzer mengikuti telemetri serta status alarm dari pengirim.
 * Koneksi MQTT TLS ke EMQX. ID, Wi-Fi dan kredensial di config.h.
 */

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_random.h>
#include <mqtt_client.h>
#include <ArduinoJson.h>
#include <atomic>
#include <cmath>
#include <ctime>
// ===== KONFIGURASI ALAT: EDIT DI BAGIAN INI =====
constexpr char StationId[] = "YOUR_STATION_ID";
constexpr char WifiSsid[] = "YOUR_2_4_GHZ_WIFI";
constexpr char WifiPassword[] = "YOUR_WIFI_PASSWORD";
constexpr char MqttUsername[] = "YOUR_MQTT_USERNAME";
constexpr char MqttPassword[] = "YOUR_MQTT_PASSWORD";
constexpr char brokerUrl[] = "mqtts://g916bd01.ala.us-east-1.emqxsl.com:8883";
// ===== AKHIR KONFIGURASI ALAT =====

// ========================== 1. KONFIGURASI WI-FI & EMQX CLOUD ================
// Ganti SSID & Password sesuai Wi-Fi tempat Node 2 berada (BISA BEDA DENGAN NODE 1!)


// Topik MQTT Cloud Database
const String TopicTelemetryValue = String("bayu/stations/") + StationId + "/telemetry";
const char* TopicTelemetry = TopicTelemetryValue.c_str();
const String TopicCommandValue = String("bayu/stations/") + StationId + "/cmd";
const char* TopicCommand = TopicCommandValue.c_str();

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
#define PIN_BUZZER_1        18    // GPIO 18: Buzzer Utama
#define PIN_BUZZER_2        19    // GPIO 19: Buzzer Tambahan
#define PIN_RGB_RED         25    // GPIO 25: LED RGB Merah
#define PIN_RGB_GREEN       26    // GPIO 26: LED RGB Hijau
#define PIN_RGB_BLUE        27    // GPIO 27: LED RGB Biru
#define PIN_BUTTON          13    // GPIO 13: Push Button Mute

#define I2C_SDA             21    // GPIO 21: Bus I2C Data LCD 16x2
#define I2C_SCL             22    // GPIO 22: Bus I2C Clock LCD 16x2

// Ambang Batas Pengujian
const float SPEED_SAFE_MAX  = 5.0f;   // < 5.0 km/h -> AMAN (Hijau solid, Buzzer mati total)
const float SPEED_WARN_MAX  = 15.0f;  // 5.0 - 15.0 km/h -> WASPADA (Kuning, Beep pelan)
                                      // >= 15.0 km/h -> BAHAYA (Merah kedip, Alarm cepat)

// ========================== 3. STATE TELEMETRI & VARIABEL =====================
struct TelemetryState {
  float speedKmh     = 0.0f;
  float speedMps     = 0.0f;
  float directionDeg = 0.0f;
  char  cardinal[5]  = "U";
  uint8_t statusCode = 0; // 0=AMAN, 1=WASPADA, 2=BAHAYA
  float gpsLat       = 0.0f;
  float gpsLon       = 0.0f;
  uint8_t gpsSats    = 0;
  bool gpsFix        = false;
  bool isMuted       = false;
  uint32_t packetId  = 0;
  uint32_t lastReceivedAt = 0;
} telemetry;

LiquidCrystal_I2C lcd(0x27, 16, 2);
bool lcdAvailable       = false;
bool isCommonAnode      = false;       // false=Cathode GND, true=Anode 3.3V
bool isBuzzerActiveLow  = false;       // false = Active-HIGH (0V/LOW=Mati, 3.3V/HIGH=Bunyi)
bool hardMute           = false;       // Toggle lewat Serial 'x' (Paksa senyap total)
uint32_t muteStartTime  = 0;           // Waktu tombol mute ditekan
const uint32_t MUTE_SNOOZE_MS = 300000UL; // 5 Menit (5 * 60 * 1000 ms)

esp_mqtt_client_handle_t mqttClient = nullptr;
std::atomic<bool> mqttConnected{false};

// ========================== 4. HELPER MATA ANGIN & STATUS ====================
const char* degToCardinal(float deg) {
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

// ========================== 5. KONTROL LED & BUZZER ==========================
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

  if (active && !telemetry.isMuted && !hardMute) {
    // Mode AKTIF BUNYI
    if (isBuzzerActiveLow) {
      digitalWrite(PIN_BUZZER_1, LOW);
      digitalWrite(PIN_BUZZER_2, LOW);
    } else {
      digitalWrite(PIN_BUZZER_1, HIGH);
      digitalWrite(PIN_BUZZER_2, HIGH);
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
      tone(PIN_BUZZER_1, 2400);
#endif
    }
  } else {
    // Mode SENYAP / MATI TOTAL
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

void updateAlarms() {
  uint32_t now = millis();
  bool timedOut = (telemetry.lastReceivedAt == 0) || (now - telemetry.lastReceivedAt > 5000);

  if (timedOut) {
    // Sinyal belum masuk: LED Biru kedip pelan (Watchdog standby), Buzzer OFF
    bool blink = (now / 500) % 2;
    setRGB(false, false, blink);
    setBuzzerState(false);
    return;
  }

  uint8_t code = telemetry.statusCode;

  // 1. Kondisi NORMAL (AMAN / kecepatan < 5 km/h):
  if (code == 0) {
    setRGB(false, true, false); // Hijau solid
    setBuzzerState(false);      // Buzzer DIEM / MATI TOTAL (0V)
    telemetry.isMuted = false;  // Reset status mute otomatis saat reda
    muteStartTime = 0;
    return;
  }

  // 2. Kondisi ABNORMAL (WASPADA atau BAHAYA):
  // Cek apakah sedang di-mute dan apakah sudah lewat 5 menit:
  if (telemetry.isMuted) {
    if (now - muteStartTime >= MUTE_SNOOZE_MS) {
      telemetry.isMuted = false; // 5 menit lewat & masih abnormal -> BUNYI LAGI!
      muteStartTime = 0;
      Serial.println(F("\n[SNOOZE EXPIRED NODE 2] Sudah 5 menit & kondisi masih abnormal! Buzzer berbunyi lagi!\n"));
    }
  }

  if (code == 2) {
    // BAHAYA: Merah kedip cepat
    bool blinkFast = (now / 150) % 2;
    setRGB(blinkFast, false, false);
    setBuzzerState(blinkFast);
  } else if (code == 1) {
    // WASPADA: Kuning (Merah + Hijau)
    setRGB(true, true, false);
    bool beep = (now / 500) % 2;
    setBuzzerState(beep);
  }
}

// ========================== 6. TAMPILAN LCD 16x2 ============================
void updateLcd() {
  if (!lcdAvailable) return;
  uint32_t now = millis();
  bool timedOut = (telemetry.lastReceivedAt == 0) || (now - telemetry.lastReceivedAt > 5000);

  if (timedOut) {
    lcd.setCursor(0, 0);
    lcd.print("Menunggu Cloud..");
    lcd.setCursor(0, 1);
    char buf[17];
    snprintf(buf, sizeof(buf), "W:%-2s M:%-3s BedaWF",
             WiFi.status() == WL_CONNECTED ? "OK" : "..",
             mqttConnected ? "OK" : "..");
    lcd.print(buf);
    return;
  }

  // Baris 1: Kecepatan & Status (misal: "W:14.7km [AMAN] " atau "W:14.7km [MUTE5m]")
  lcd.setCursor(0, 0);
  char line1[17];
  const char* stDisplay = telemetry.isMuted ? "MUTE5m" : statusToStr(telemetry.statusCode);
  snprintf(line1, sizeof(line1), "W:%4.1fkm [%-6s]",
           telemetry.speedKmh, stDisplay);
  lcd.print(line1);

  // Baris 2: Sudut, Arah, Sinyal MQTT & Satelit GPS (misal: "192* S  |M:OK S:8")
  lcd.setCursor(0, 1);
  char line2[17];
  snprintf(line2, sizeof(line2), "%3.0f* %-2s |M:%-2s S:%d",
           telemetry.directionDeg, telemetry.cardinal,
           mqttConnected ? "OK" : "..", telemetry.gpsSats);
  lcd.print(line2);
}

// ========================== 7. MQTT EVENT & SUBSCRIPTION =====================
bool pendingMuteSync = false;
bool requestedMute = false;
uint32_t lastMutePublish = 0;
uint32_t muteRequestStarted = 0;

void publishMuteCommand(bool muteVal) {
  if (!pendingMuteSync || requestedMute != muteVal) muteRequestStarted = millis();
  pendingMuteSync = true;
  requestedMute = muteVal;
  lastMutePublish = millis();
  if (!mqttConnected || mqttClient == nullptr) return;
  char payload[64];
  snprintf(payload, sizeof(payload), "{\"cmd\":\"mute\",\"is_muted\":%s}", muteVal ? "true" : "false");
  esp_mqtt_client_publish(mqttClient, TopicCommand, payload, 0, 1, 0);
  Serial.printf("[MQTT CLOUD] Mengirim sinkronisasi MUTE = %s ke Node 1 via Cloud\n", muteVal ? "ON" : "OFF");
}

void mqttEventCallback(void *, esp_event_base_t, int32_t eventId, void *eventData) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)eventData;

  if (eventId == MQTT_EVENT_CONNECTED) {
    mqttConnected = true;
    Serial.println(F("[EMQX CLOUD] Node 2 Terhubung ke Broker TLS (Port 8883) Sukses!"));
    // Berlangganan topik telemetri dari Node 1 dan topik perintah Mute
    esp_mqtt_client_subscribe(mqttClient, TopicTelemetry, 1);
    esp_mqtt_client_subscribe(mqttClient, TopicCommand, 1);
    Serial.println(F("[EMQX CLOUD] Berhasil subscribe ke Telemetri & Command!"));
  } else if (eventId == MQTT_EVENT_DISCONNECTED || eventId == MQTT_EVENT_ERROR) {
    mqttConnected = false;
    Serial.println(F("[EMQX CLOUD] Terputus. Menjadwalkan coba ulang..."));
  } else if (eventId == MQTT_EVENT_DATA) {
    // Tolak fragmen agar perintah tidak dibaca sebagian.
    if (event->current_data_offset != 0 || event->data_len != event->total_data_len) return;
    // Tangani data masuk
    if (event->data_len > 0) {
      char topicBuffer[128];
      int topicLen = (event->topic_len < (int)sizeof(topicBuffer) - 1) ? event->topic_len : (sizeof(topicBuffer) - 1);
      memcpy(topicBuffer, event->topic, topicLen);
      topicBuffer[topicLen] = '\0';

      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, event->data, event->data_len);
      if (err) {
        Serial.printf("[JSON ERROR] Gagal parse payload MQTT: %s\n", err.c_str());
        return;
      }

      // 1. Jika pesan dari topik telemetri:
      if (strcmp(topicBuffer, TopicTelemetry) == 0) {
        if (doc.containsKey("speed_kmh")) {
          telemetry.speedKmh = doc["speed_kmh"];
        } else if (doc.containsKey("windSpeedKmh")) {
          telemetry.speedKmh = doc["windSpeedKmh"];
        }

        if (doc.containsKey("speed_mps")) {
          telemetry.speedMps = doc["speed_mps"];
        } else {
          telemetry.speedMps = telemetry.speedKmh / 3.6f;
        }

        if (doc.containsKey("direction_deg")) {
          telemetry.directionDeg = doc["direction_deg"];
        } else if (doc.containsKey("windDirectionDeg")) {
          telemetry.directionDeg = doc["windDirectionDeg"];
        }

        if (doc.containsKey("cardinal")) {
          strncpy(telemetry.cardinal, doc["cardinal"] | "--", sizeof(telemetry.cardinal));
        } else {
          strncpy(telemetry.cardinal, degToCardinal(telemetry.directionDeg), sizeof(telemetry.cardinal));
        }

        if (doc.containsKey("status_code")) {
          telemetry.statusCode = doc["status_code"];
        } else {
          telemetry.statusCode = (telemetry.speedKmh >= SPEED_WARN_MAX) ? 2 : ((telemetry.speedKmh >= SPEED_SAFE_MAX) ? 1 : 0);
        }

        if (doc.containsKey("gps")) {
          telemetry.gpsLat = doc["gps"]["lat"] | 0.0f;
          telemetry.gpsLon = doc["gps"]["lon"] | 0.0f;
          telemetry.gpsSats = doc["gps"]["sats"] | 0;
          telemetry.gpsFix = doc["gps"]["fix"] | false;
        }

        if (doc.containsKey("packet_id")) {
          telemetry.packetId = doc["packet_id"];
        }

        // Pengirim menjadi sumber status bersama. Jangan timpa permintaan tombol
        // dengan telemetri lama sebelum pengirim mengonfirmasi nilai yang diminta.
        if (doc["is_muted"].is<bool>()) {
          bool cloudMute = doc["is_muted"].as<bool>();
          if (pendingMuteSync && cloudMute == requestedMute) pendingMuteSync = false;
          if (!pendingMuteSync) {
            if (cloudMute && !telemetry.isMuted) muteStartTime = millis();
            telemetry.isMuted = cloudMute;
            if (!cloudMute) muteStartTime = 0;
            if (cloudMute) setBuzzerState(false);
          }
        }

        telemetry.lastReceivedAt = millis();

        Serial.printf("[MQTT TELEMETRI DITERIMA] Kecepatan: %4.1f km/h | Sudut: %5.1f* (%s) | Status: %s | Sat: %d\n",
                      telemetry.speedKmh, telemetry.directionDeg, telemetry.cardinal,
                      statusToStr(telemetry.statusCode), telemetry.gpsSats);
      }
      // 2. Jika pesan dari topik command (Mute Remote):
      else if (strcmp(topicBuffer, TopicCommand) == 0) {
        const char *command = doc["cmd"] | "";
        bool webMute = strcmp(command, "buzzer_mute") == 0;
        bool webUnmute = strcmp(command, "buzzer_unmute") == 0;
        if (webMute || webUnmute || (strcmp(command, "mute") == 0 && doc["is_muted"].is<bool>())) {
          bool remoteMute = webMute || (!webUnmute && doc["is_muted"].as<bool>());
          if (webMute || webUnmute) pendingMuteSync = false;
          bool previouslyMuted = telemetry.isMuted;
          telemetry.isMuted = remoteMute;
          if (remoteMute) {
            if (!previouslyMuted || webMute) muteStartTime = millis();
            setBuzzerState(false);
            Serial.println(F("[SYNC MUTE DARI CLOUD] Mute diaktifkan selama 5 menit!"));
          } else {
            muteStartTime = 0;
          }
          uint32_t nonce = doc["nonce"] | 0U;
          if ((webMute || webUnmute) && nonce != 0) {
            JsonDocument ack;
            ack["cmd"] = command; ack["nonce"] = nonce;
            ack["status"] = "applied"; ack["device"] = "receiver";
            String payload; serializeJson(ack, payload);
            String topic = String("bayu/stations/") + StationId + "/ack";
            esp_mqtt_client_publish(mqttClient, topic.c_str(), payload.c_str(), 0, 1, 0);
          }
        }
      }
    }
  }
}

void startMqtt() {
  if (mqttClient != nullptr) return;

  Serial.println(F("[EMQX CLOUD] Inisialisasi koneksi MQTT TLS Node 2..."));
  esp_mqtt_client_config_t config{};
  config.broker.address.uri = brokerUrl;
  config.broker.verification.certificate = BrokerCa;
  config.credentials.username = MqttUsername;
  config.credentials.authentication.password = MqttPassword;
  static String clientId = String("bayu-rx-") + StationId + "-" + WiFi.macAddress();
  config.credentials.client_id = clientId.c_str();
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

// ========================== 8. SETUP =========================================
Preferences prefs;
WebServer wifiSetupServer(80);
String activeWifiSsid;
String activeWifiPassword;
String candidateWifiSsid;
String candidateWifiPassword;
String wifiSetupToken;
char wifiSetupName[32];
char wifiSetupPassword[13];
const char* wifiSetupStatus = "Masukkan jaringan Wi-Fi 2,4 GHz untuk penerima.";
bool wifiSetupOpen = false;
bool wifiSetupKeepOpen = false;
bool wifiCandidatePending = false;
bool wifiCandidateTesting = false;
uint32_t wifiSetupOpenedAt = 0;
uint32_t wifiCandidateStartedAt = 0;
uint32_t wifiOfflineSince = 0;
uint32_t lastWifiRetry = 0;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t WIFI_SETUP_DELAY_MS = 25000;
constexpr uint32_t WIFI_TEST_MS = 20000;
constexpr uint32_t WIFI_SETUP_IDLE_MS = 600000;
constexpr uint32_t WIFI_SETUP_HOLD_MS = 4000;

bool validWifiSettings(const String& ssid, const String& password) {
  return ssid.length() > 0 && ssid.length() <= 32 &&
    (password.isEmpty() || (password.length() >= 8 && password.length() <= 63)) &&
    strlen(ssid.c_str()) == ssid.length() && strlen(password.c_str()) == password.length();
}

void connectWifi(const String& ssid, const String& password) {
  lastWifiRetry = millis();
  if (ssid.isEmpty()) return;
  Serial.printf("[WIFI] Menghubungkan ke '%s'...\n", ssid.c_str());
  WiFi.begin(ssid.c_str(), password.c_str());
}

bool isWifiSetupRequest() {
  if (wifiSetupOpen && wifiSetupServer.client().localIP() == WiFi.softAPIP()) return true;
  wifiSetupServer.send(404, "text/plain", "Not found");
  return false;
}

void showWifiSetupPage() {
  if (!isWifiSetupRequest()) return;
  const bool testing = wifiCandidatePending || wifiCandidateTesting;
  String page = R"HTML(<!doctype html><html lang="id"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup Wi-Fi BAYU</title><style>
body{font:16px system-ui;margin:3rem auto;padding:0 1.25rem;max-width:30rem;color:#163d33}
label{display:block;margin-top:1rem}input,button{box-sizing:border-box;width:100%;padding:.65rem;font:inherit}
button{margin-top:1.25rem;background:#163d33;color:white;border:0;border-radius:.3rem}
</style><h1>Wi-Fi penerima BAYU</h1><p>)HTML";
  page += wifiSetupStatus;
  page += "</p>";
  if (testing) {
    page += "<p><a href='/'>Cek status koneksi</a></p>";
  } else {
    page += "<form method='post' action='/wifi'><input type='hidden' name='token' value='";
    page += wifiSetupToken;
    page += R"HTML('><label>Nama Wi-Fi <input name="ssid" maxlength="32" required></label>
<label>Password Wi-Fi <input name="password" type="password" maxlength="63"></label>
<p>Kosongkan password hanya untuk jaringan terbuka.</p>
<button>Simpan dan hubungkan</button></form>)HTML";
  }
  page += "</html>";
  wifiSetupServer.sendHeader("Cache-Control", "no-store");
  wifiSetupServer.send(200, "text/html; charset=utf-8", page);
}

void submitWifiSetup() {
  if (!isWifiSetupRequest()) return;
  if (wifiSetupServer.arg("token") != wifiSetupToken) {
    wifiSetupServer.send(403, "text/plain", "Buka kembali halaman setup.");
    return;
  }
  if (wifiCandidatePending || wifiCandidateTesting) {
    wifiSetupServer.send(409, "text/plain", "Pengujian masih berjalan.");
    return;
  }
  const String ssid = wifiSetupServer.arg("ssid");
  const String password = wifiSetupServer.arg("password");
  if (!validWifiSettings(ssid, password)) {
    wifiSetupServer.send(400, "text/plain", "Nama Wi-Fi 1-32 byte. Password kosong atau 8-63 byte.");
    return;
  }
  candidateWifiSsid = ssid;
  candidateWifiPassword = password;
  wifiCandidatePending = true;
  wifiSetupStatus = "ESP32 sedang mencoba Wi-Fi baru. Hotspot setup akan ditutup jika berhasil.";
  wifiSetupServer.sendHeader("Location", "/");
  wifiSetupServer.send(303, "text/plain", "");
}

void printWifiSetupAccess() {
  Serial.printf("[SETUP WI-FI] Hotspot: %s | Password: %s | Buka http://%s\n",
    wifiSetupName, wifiSetupPassword, WiFi.softAPIP().toString().c_str());
}

void openWifiSetup(bool requested) {
  wifiSetupKeepOpen = wifiSetupKeepOpen || requested;
  wifiSetupOpenedAt = millis();
  if (wifiSetupOpen) {
    if (requested) printWifiSetupAccess();
    return;
  }
  WiFi.mode(WIFI_AP_STA);
  const uint32_t suffix = static_cast<uint32_t>(ESP.getEfuseMac() & 0xFFFFFF);
  char token[17];
  snprintf(wifiSetupName, sizeof(wifiSetupName), "BAYU-Penerima-%06lX", static_cast<unsigned long>(suffix));
  const String savedSetupPassword = prefs.getString("wifiSetupKey", "");
  if (savedSetupPassword.length() == sizeof(wifiSetupPassword) - 1) {
    savedSetupPassword.toCharArray(wifiSetupPassword, sizeof(wifiSetupPassword));
  } else {
    snprintf(wifiSetupPassword, sizeof(wifiSetupPassword), "%04lX%08lX",
      static_cast<unsigned long>(esp_random() & 0xFFFF), static_cast<unsigned long>(esp_random()));
    if (prefs.putString("wifiSetupKey", wifiSetupPassword) != sizeof(wifiSetupPassword) - 1) {
      Serial.println(F("[SETUP WI-FI] Password hotspot hanya berlaku selama sesi ini."));
    }
  }
  snprintf(token, sizeof(token), "%08lX%08lX",
    static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  if (!WiFi.softAP(wifiSetupName, wifiSetupPassword, 1, false, 2)) {
    WiFi.mode(WIFI_STA);
    Serial.println(F("[SETUP WI-FI] Gagal membuka hotspot."));
    return;
  }
  wifiSetupToken = token;
  wifiSetupStatus = "Masukkan jaringan Wi-Fi 2,4 GHz untuk penerima.";
  wifiSetupServer.begin();
  wifiSetupOpen = true;
  printWifiSetupAccess();
}

void closeWifiSetup() {
  wifiSetupServer.stop();
  WiFi.softAPdisconnect(true);
  wifiSetupOpen = false;
  wifiSetupKeepOpen = false;
  wifiSetupToken = "";
  memset(wifiSetupPassword, 0, sizeof(wifiSetupPassword));
}

void beginWifi() {
  JsonDocument storedWifi;
  if (!deserializeJson(storedWifi, prefs.getString("wifiStation", ""))) {
    activeWifiSsid = storedWifi["ssid"] | "";
    activeWifiPassword = storedWifi["password"] | "";
  }
  if (!validWifiSettings(activeWifiSsid, activeWifiPassword)) {
    activeWifiSsid = strcmp(WifiSsid, "YOUR_2_4_GHZ_WIFI") == 0 ? "" : WifiSsid;
    activeWifiPassword = WifiPassword;
  }
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  wifiSetupServer.on("/", HTTP_GET, showWifiSetupPage);
  wifiSetupServer.on("/wifi", HTTP_POST, submitWifiSetup);
  wifiOfflineSince = millis();
  if (activeWifiSsid.isEmpty()) openWifiSetup(false);
  else connectWifi(activeWifiSsid, activeWifiPassword);
}

bool serviceWifi() {
  if (wifiSetupOpen) wifiSetupServer.handleClient();
  const uint32_t now = millis();
  if (wifiCandidatePending) {
    wifiCandidatePending = false;
    wifiCandidateTesting = true;
    wifiCandidateStartedAt = now;
    WiFi.disconnect(false, false);
    connectWifi(candidateWifiSsid, candidateWifiPassword);
    return false;
  }
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (wifiCandidateTesting) {
    const uint32_t elapsed = now - wifiCandidateStartedAt;
    if (elapsed >= 500 && connected && WiFi.SSID() == candidateWifiSsid) {
      JsonDocument config;
      config["ssid"] = candidateWifiSsid;
      config["password"] = candidateWifiPassword;
      String serialized;
      serializeJson(config, serialized);
      if (prefs.putString("wifiStation", serialized) == serialized.length()) {
        activeWifiSsid = candidateWifiSsid;
        activeWifiPassword = candidateWifiPassword;
        wifiCandidateTesting = false;
        candidateWifiSsid = "";
        candidateWifiPassword = "";
        closeWifiSetup();
        Serial.println(F("[SETUP WI-FI] Jaringan baru tersimpan."));
        return true;
      }
      wifiSetupStatus = "Wi-Fi tersambung, tetapi pengaturan gagal disimpan. Silakan coba lagi.";
    } else if (elapsed < WIFI_TEST_MS) {
      return false;
    } else {
      wifiSetupStatus = "Wi-Fi baru belum tersambung. Periksa nama dan password, lalu coba lagi.";
    }
    wifiCandidateTesting = false;
    candidateWifiSsid = "";
    candidateWifiPassword = "";
    wifiSetupKeepOpen = true;
    WiFi.disconnect(false, false);
    connectWifi(activeWifiSsid, activeWifiPassword);
    return false;
  }
  if (connected) {
    wifiOfflineSince = now;
    if (wifiSetupOpen && (!wifiSetupKeepOpen || now - wifiSetupOpenedAt >= WIFI_SETUP_IDLE_MS)) closeWifiSetup();
    return true;
  }
  if (!wifiSetupOpen && now - wifiOfflineSince >= WIFI_SETUP_DELAY_MS && now - wifiSetupOpenedAt >= WIFI_RETRY_MS) {
    openWifiSetup(false);
  }
  if (!activeWifiSsid.isEmpty() && now - lastWifiRetry >= WIFI_RETRY_MS) {
    WiFi.reconnect();
    lastWifiRetry = now;
  }
  return false;
}

void handleReceiverButton() {
  static int previous = HIGH;
  static int stable = HIGH;
  static uint32_t changedAt = 0;
  static uint32_t pressedAt = 0;
  static bool setupRequested = false;
  const uint32_t now = millis();
  const int reading = digitalRead(PIN_BUTTON);
  if (reading != previous) {
    previous = reading;
    changedAt = now;
  }
  if (reading != stable && now - changedAt >= 50) {
    stable = reading;
    if (stable == LOW) {
      pressedAt = now;
      setupRequested = false;
    } else if (!setupRequested && telemetry.statusCode > 0) {
      telemetry.isMuted = true;
      muteStartTime = now;
      setBuzzerState(false);
      publishMuteCommand(true);
      Serial.println(F("[TOMBOL NODE 2] Alarm disenyapkan selama 5 menit."));
    }
  }
  if (reading == LOW && stable == LOW && !setupRequested && now - pressedAt >= WIFI_SETUP_HOLD_MS) {
    setupRequested = true;
    openWifiSetup(true);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println(F("\n======================================================="));
  Serial.println(F("  AEROSENSE IOT - NODE 2: PENERIMA & DISPLAY DATABASE  "));
  Serial.println(F("======================================================="));

  // Inisialisasi Pin Hardware
  pinMode(PIN_RGB_RED, OUTPUT);
  pinMode(PIN_RGB_GREEN, OUTPUT);
  pinMode(PIN_RGB_BLUE, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER_1, OUTPUT);
  pinMode(PIN_BUZZER_2, OUTPUT);
  setBuzzerState(false); // Pastikan mati senyap saat booting

  // Inisialisasi I2C LCD 16x2 (Auto-detect alamat 0x27 atau 0x3F)
  Wire.begin(I2C_SDA, I2C_SCL);
  uint8_t lcdFoundAddr = 0;
  Wire.beginTransmission(0x27);
  if (Wire.endTransmission() == 0) {
    lcdFoundAddr = 0x27;
  } else {
    Wire.beginTransmission(0x3F);
    if (Wire.endTransmission() == 0) {
      lcdFoundAddr = 0x3F;
    }
  }

  if (lcdFoundAddr != 0) {
    lcdAvailable = true;
    lcd = LiquidCrystal_I2C(lcdFoundAddr, 16, 2);
    lcd.init();
    lcd.backlight();
    lcd.setCursor(0, 0);
    lcd.print("AeroSense Alert");
    lcd.setCursor(0, 1);
    lcd.print("Cloud Ready...");
    Serial.printf("[OK] LCD 16x2 I2C Terdeteksi pada alamat 0x%02X!\n", lcdFoundAddr);
  } else {
    Serial.println(F("[PERINGATAN] LCD 16x2 tidak merespon di 0x27 maupun 0x3F. Periksa kabel SDA/SCL & VCC/GND!"));
  }

  // Tes Startup Visual (LED RGB)
  setRGB(true, false, false); delay(200); // Merah
  setRGB(false, true, false); delay(200); // Hijau
  setRGB(false, false, true); delay(200); // Biru
  setRGB(false, false, false);

  // Inisialisasi Wi-Fi Station
  prefs.begin("bayuReceiver", false);
  beginWifi();

  Serial.println(F("-------------------------------------------------------"));
  Serial.println(F("Panduan Perintah Serial Node 2:"));
  Serial.printf( " 'p' : Balik Polaritas Buzzer (Sekarang: %s)\n", isBuzzerActiveLow ? "ACTIVE-LOW (HIGH=Mati)" : "ACTIVE-HIGH (LOW=Mati)");
  Serial.println(F(" 'x' : Paksa Senyap Buzzer Total (Hard Mute ON/OFF)"));
  Serial.println(F(" 'm' : Mute / Unmute Buzzer (Snooze 5 Menit)"));
  Serial.printf( " 'a' : Balik Polaritas LED RGB (Sekarang: %s)\n", isCommonAnode ? "COMMON ANODE (3.3V)" : "COMMON CATHODE (GND)");
  Serial.println(F(" '1'/'2'/'3' : Tes Manual LED Merah / Hijau / Biru"));
  Serial.println(F(" '4' : Tes Manual Buzzer 1 Detik"));
  Serial.println(F("-------------------------------------------------------"));
  Serial.println(F("=======================================================\n"));
}

// ========================== 9. LOOP UTAMA ====================================
void loop() {
  // QoS 1 saja tidak cukup saat tombol ditekan sebelum MQTT tersambung.
  if (pendingMuteSync && millis() - lastMutePublish >= 2000) {
    if (millis() - muteRequestStarted < MUTE_SNOOZE_MS) publishMuteCommand(requestedMute);
    else pendingMuteSync = false;
  }
  static uint32_t lastLcdUpdate = 0;
  static uint32_t lastMqttAttempt = 0;
  static bool wifiWasConnected = false;
  uint32_t now = millis();

  // 0. Serial Monitor Hardware Diagnostic Commands
  while (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'p' || cmd == 'P') {
      isBuzzerActiveLow = !isBuzzerActiveLow;
      setBuzzerState(false);
      Serial.printf("[BUZZER] Polaritas diubah ke: %s\n",
                    isBuzzerActiveLow ? "ACTIVE-LOW (HIGH=Mati, LOW=Bunyi)" : "ACTIVE-HIGH (LOW=Mati, HIGH=Bunyi)");
    } else if (cmd == 'x' || cmd == 'X') {
      hardMute = !hardMute;
      setBuzzerState(false);
      Serial.printf("[BUZZER] Hard Mute: %s\n", hardMute ? "SENYAP TOTAL (DIPAKSA MATI)" : "NORMAL");
    } else if (cmd == 'a' || cmd == 'A') {
      isCommonAnode = !isCommonAnode;
      Serial.printf("[LED RGB] Mode LED diganti ke: %s\n", isCommonAnode ? "COMMON ANODE (VCC 3.3V)" : "COMMON CATHODE (GND)");
    } else if (cmd == '1' || cmd == 'r' || cmd == 'R') {
      Serial.println(F("[TES] Menyalakan LED MERAH selama 1.5 detik..."));
      setRGB(true, false, false); delay(1500); setRGB(false, false, false);
    } else if (cmd == '2' || cmd == 'g' || cmd == 'G') {
      Serial.println(F("[TES] Menyalakan LED HIJAU selama 1.5 detik..."));
      setRGB(false, true, false); delay(1500); setRGB(false, false, false);
    } else if (cmd == '3' || cmd == 'b' || cmd == 'B') {
      Serial.println(F("[TES] Menyalakan LED BIRU selama 1.5 detik..."));
      setRGB(false, false, true); delay(1500); setRGB(false, false, false);
    } else if (cmd == 'm' || cmd == 'M') {
      telemetry.isMuted = !telemetry.isMuted;
      muteStartTime = telemetry.isMuted ? millis() : 0;
      if (telemetry.isMuted) setBuzzerState(false);
      publishMuteCommand(telemetry.isMuted);
      Serial.printf("[KONTROL MUTE] Status Buzzer: %s\n", telemetry.isMuted ? "SENYAP (5 MENIT)" : "BUNYI (UNMUTED)");
    } else if (cmd == '4' || cmd == 'z' || cmd == 'Z') {
      Serial.println(F("[TES] Membunyikan BUZZER selama 1 detik..."));
      setBuzzerState(true); delay(1000); setBuzzerState(false);
    }
  }

  handleReceiverButton();

  // 2. Update status alarm visual (RGB) dan akustik (Buzzer)
  updateAlarms();

  // 3. Refresh LCD 16x2 setiap 250 ms
  if (now - lastLcdUpdate >= 250) {
    lastLcdUpdate = now;
    updateLcd();
  }

  // 4. Manajemen Wi-Fi & Auto-Connect MQTT dengan Sinkronisasi Jam NTP
  const bool isWifiConnected = serviceWifi();

  if (isWifiConnected && !wifiWasConnected) {
    wifiWasConnected = true;
    Serial.printf("\n[WIFI SUKSES] IP: %s | Sinyal: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    // Sinkronisasi waktu internet (NTP) wajib untuk verifikasi sertifikat SSL TLS
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  } else if (!isWifiConnected) {
    wifiWasConnected = false;

  }

  // Mulai MQTT TLS & Reconnect jika terputus
  if (isWifiConnected && (now - lastMqttAttempt >= 5000)) {
    lastMqttAttempt = now;
    time_t nowSec = time(nullptr);
    if (nowSec > 1700000000) { // Jam internet sinkron
      if (mqttClient == nullptr) {
        Serial.printf("[NTP] Jam Internet Sinkron (%ld). Menghubungkan ke Broker TLS...\n", (long)nowSec);
        startMqtt();
      } else if (!mqttConnected) {
        Serial.println(F("[EMQX CLOUD] Reconnecting ke broker TLS..."));
        esp_mqtt_client_reconnect(mqttClient);
      }
    } else {
      Serial.println(F("[NTP] Menunggu jam internet sinkron untuk TLS..."));
    }
  }

  // 5. Live Heartbeat Monitor
  static uint32_t lastHeartbeat = 0;
  if (now - lastHeartbeat >= 3000) {
    lastHeartbeat = now;
    if (telemetry.lastReceivedAt == 0 || (now - telemetry.lastReceivedAt > 5000)) {
      Serial.printf("[DISPLAY DALAM] WiFi: %s | MQTT: %s | Menunggu data Cloud dari Node 1...\n",
                    isWifiConnected ? "TERHUBUNG" : "DISCONNECTED",
                    mqttConnected ? "CONNECTED (TLS 8883)" : "WAITING...");
    } else {
      Serial.printf("[DISPLAY DALAM] LIVE DATA: %.1f km/h | %4.1f* (%s) | DB: OK | Mute: %s\n",
                    telemetry.speedKmh, telemetry.directionDeg, telemetry.cardinal,
                    telemetry.isMuted ? "ON (5m)" : "OFF");
    }
  }

  delay(10);
}
