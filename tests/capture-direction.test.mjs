import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDirectionSample } from '../src/lib/capture-direction.mjs';
test('capture requires a new stable MQTT window after button press without strict device clock alignment',()=>{
 const r={directionProcessing:'server',directionSensorValid:true,directionSample:{rawDeg:334.25,samples:30,capturedAt:15000}};
 assert.equal(freshDirectionSample(r,10000,13000,12000),334.25);
 assert.equal(freshDirectionSample(r,10000,11000,12000),null);
 assert.equal(freshDirectionSample(r,10000,13000,15000),null);
 assert.equal(freshDirectionSample({...r,directionSensorValid:false},10000,13000,12000),null);
 assert.equal(freshDirectionSample({...r,directionSample:{...r.directionSample,samples:0}},10000,13000,12000),null);
 assert.equal(freshDirectionSample({...r,directionSample:{...r.directionSample,capturedAt:1000}},10000,30000,12000),null);
});
