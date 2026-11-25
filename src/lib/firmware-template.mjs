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
