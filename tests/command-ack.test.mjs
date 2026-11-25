import test from 'node:test';
import assert from 'node:assert/strict';
import { recordCommandAck } from '../src/lib/command-ack.mjs';

test('mute waits for distinct sender and receiver acknowledgements with matching nonce', () => {
  const devices = new Set();
  const ack = { cmd: 'buzzer_mute', nonce: 12, status: 'applied', device: 'sender' };
  assert.equal(recordCommandAck(devices, { ...ack, nonce: 11 }, 'buzzer_mute', 12), false);
  assert.equal(devices.size, 0);
  assert.equal(recordCommandAck(devices, ack, 'buzzer_mute', 12), false);
  assert.equal(recordCommandAck(devices, ack, 'buzzer_mute', 12), false);
  assert.equal(recordCommandAck(devices, { ...ack, device: 'receiver' }, 'buzzer_mute', 12), true);
});
test('unmute cannot succeed with a legacy or unrelated acknowledgement', () => {
  const devices = new Set();
  assert.equal(recordCommandAck(devices, {cmd:'buzzer_unmute', nonce:1, status:'applied'}, 'buzzer_unmute',1),false);
  assert.equal(recordCommandAck(devices, {cmd:'buzzer_mute',nonce:1,status:'applied',device:'sender'},'buzzer_unmute',1),false);
  assert.equal(recordCommandAck(new Set(), {cmd:'request_telemetry',nonce:1,status:'applied'},'request_telemetry',1),true);
});
