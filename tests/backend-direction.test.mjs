import test from 'node:test';
import assert from 'node:assert/strict';
import { correctRawDirection, validateDirectionPoints } from '../src/lib/direction-calibration.mjs';
import { applyWebConfiguration, defaultStationSettings } from '../src/lib/station-registry.mjs';
import { validReading } from '../src/lib/telemetry.mjs';
const calibration={points:[10,100,180,240]};
test('backend maps each measured interval independently, including distorted west and north wrap',()=>{
 for(const [raw,want] of [[10,0],[100,90],[180,180],[240,270],[210,225],[305,315],[0,353.076923]]) assert.ok(Math.abs(correctRawDirection(raw,calibration)-want)<.0001);
 assert.equal(correctRawDirection(280,{points:[10,280,190,100]}),90);
 assert.throws(()=>validateDirectionPoints([0,180,90,270]));
 assert.throws(()=>validateDirectionPoints([0,0,180,270]));
});
test('raw sensor survives ingest validation and correction is never applied twice',()=>{
 const input={stationId:'bayu-test',windSpeedKmh:10,windDirectionDeg:12,rawWindDirectionDeg:305,directionProcessing:'server',directionSensorValid:true,directionSample:{rawDeg:305,samples:30,capturedAt:5000},receivedAt:6000};
 const reading=validReading('bayu-test',input);
 assert.equal(reading.rawWindDirectionDeg,305);
 const settings={...defaultStationSettings,directionOffsetDeg:20};
 const first=applyWebConfiguration(reading,settings,calibration);
 const second=applyWebConfiguration(validReading('bayu-test',{...first,stationId:'bayu-test'}),settings,calibration);
 assert.equal(first.windDirectionDeg,335);assert.equal(second.windDirectionDeg,335);
 assert.equal(first.rawWindDirectionDeg,305);
 assert.equal(applyWebConfiguration({...reading,directionProcessing:undefined,windDirectionDeg:15},settings,calibration).windDirectionDeg,35);
});
