import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationPayload } from '../src/lib/calibration-command.mjs';
test('four direction commands validate session and point before MQTT publishing', () => {
  assert.deepEqual(calibrationPayload({ operation: 'capture', session: 42, point: 3, extra: 'ignored' }), { operation: 'capture', session: 42, point: 3 });
  for (const value of [{operation:'capture',session:1,point:4},{operation:'capture',session:1,point:-1},{operation:'capture',session:1,point:1.1},{operation:'start',session:0},{operation:'save',session:2**32},{operation:'reset',session:1},null]) assert.throws(() => calibrationPayload(value));
  for (const operation of ['start','save','cancel']) assert.deepEqual(calibrationPayload({operation,session:1}),{operation,session:1});
});
