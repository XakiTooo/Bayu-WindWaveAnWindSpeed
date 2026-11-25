import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { firmwareRoles, renderFirmware } from '../src/lib/firmware-template.mjs';

for (const [role, firmware] of Object.entries(firmwareRoles)) {
  test(`${role} generates a full standalone MQTT sketch with safe quoted configuration`, async () => {
    const source = await readFile(`firmware/${firmware.folder}/${firmware.folder}.ino`, 'utf8');
    const result = renderFirmware(source, 'bayu-qa-01', { wifiSsid: 'Lab "A"', wifiPassword: 'test\\password' }, 'mqtts://example.com:8883');
    assert.ok(result.includes('constexpr char StationId[] = "bayu-qa-01";'));
    assert.ok(result.includes('constexpr char WifiSsid[] = "Lab \\"A\\"";'));
    assert.ok(result.includes('void setup()'));
    assert.ok(result.includes('void loop()'));
    assert.ok(result.includes('esp_mqtt_client_start'));
    assert.ok(!result.includes('#include "config.h"'));
    assert.throws(() => renderFirmware(source, 'bayu-qa-01', { wifiSsid: 'bad\nnetwork' }, 'mqtts://example.com:8883'));
    assert.throws(() => renderFirmware(source, 'bayu-qa-01', {}, 'mqtt://example.com:1883'));
  });
}
