export const firmwareRoles = {
  sender: { folder: 'BAYU_Pengirim_Web', label: 'Pengirim luar' },
  receiver: { folder: 'BAYU_Penerima_Web', label: 'Penerima dalam' },
};

function configurationValue(value, fallback, maxLength) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Nilai konfigurasi tidak valid.');
  }
  return value;
}

export function renderFirmware(source, stationId, input, brokerUrl) {
  const broker = new URL(brokerUrl);
  if (broker.protocol !== 'mqtts:' || broker.username || broker.password) throw new Error('Broker tidak valid.');
  const settings = {
    StationId: stationId,
    WifiSsid: configurationValue(input.wifiSsid, 'YOUR_2_4_GHZ_WIFI', 32),
    WifiPassword: configurationValue(input.wifiPassword, 'YOUR_WIFI_PASSWORD', 128),
    MqttUsername: configurationValue(input.mqttUsername, 'YOUR_MQTT_USERNAME', 256),
    MqttPassword: configurationValue(input.mqttPassword, 'YOUR_MQTT_PASSWORD', 256),
    brokerUrl: broker.href,
  };
  let result = source;
  for (const [key, value] of Object.entries(settings)) {
    const pattern = new RegExp('constexpr char ' + key + '\\[\\]\\s*=\\s*"[^"\\n]*";', 'g');
    if ((result.match(pattern) || []).length !== 1) throw new Error('Template firmware tidak sesuai.');
    result = result.replace(pattern, () => `constexpr char ${key}[] = ${JSON.stringify(value)};`);
  }
  return result;
}

export function renderConnectionExample(source, stationId, input, brokerUrl) {
  const config = renderFirmware(source, stationId, input, brokerUrl);
  const values = ['StationId', 'WifiSsid', 'WifiPassword', 'MqttUsername', 'MqttPassword']
    .map((name) => config.split('\n').find((line) => line.startsWith('constexpr char ' + name + '[')))
    .join('\n');
  const cert = config.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
  if (!cert) throw new Error('Sertifikat broker tidak tersedia.');
  const broker = new URL(brokerUrl);
  return `// BAYU MQTT TLS: contoh integrasi perangkat, bukan firmware sensor.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>

${values}
constexpr char BrokerHost[] = ${JSON.stringify(broker.hostname)};
constexpr uint16_t BrokerPort = ${Number(broker.port || 8883)};
constexpr char RootCA[] = R"PEM(${cert})PEM";

WiFiClientSecure tls;
PubSubClient mqtt(tls);
String clientId;
String topic;
unsigned long nextRetry = 0;

// Panggil dengan hasil pengukuran sendiri: km/jam dan arah 0 sampai <360 derajat.
bool publishWind(float speedKmh, float directionDeg) {
  if (!mqtt.connected() || !isfinite(speedKmh) || speedKmh < 0 ||
      !isfinite(directionDeg) || directionDeg < 0 || directionDeg >= 360) return false;
  JsonDocument payload;
  payload["stationId"] = StationId;
  payload["windSpeedKmh"] = speedKmh;
  payload["windDirectionDeg"] = directionDeg;
  char message[192];
  if (measureJson(payload) >= sizeof(message)) return false;
  serializeJson(payload, message, sizeof(message));
  return mqtt.publish(topic.c_str(), message, false);
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WifiSsid, WifiPassword);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  tls.setCACert(RootCA);
  mqtt.setServer(BrokerHost, BrokerPort);
  mqtt.setBufferSize(512);
  clientId = String("bayu-") + StationId + "-" + WiFi.macAddress();
  clientId.replace(":", "");
  topic = String("bayu/stations/") + StationId + "/telemetry";
}

void loop() {
  if (WiFi.status() != WL_CONNECTED || time(nullptr) < 1700000000) return;
  if (!mqtt.connected()) {
    if ((long)(millis() - nextRetry) < 0) return;
    nextRetry = millis() + 5000;
    if (mqtt.connect(clientId.c_str(), MqttUsername, MqttPassword)) {
      Serial.println("MQTT terhubung");
    } else {
      Serial.printf("MQTT belum terhubung (status %d)\\n", mqtt.state());
    }
    return;
  }
  mqtt.loop();
  // Tambahkan pembacaan sensor dan jadwal pengirimanmu di sini.
  // Panggil publishWind(kecepatanKmh, arahDerajat) saat pengukuran baru tersedia.
}
`;
}
