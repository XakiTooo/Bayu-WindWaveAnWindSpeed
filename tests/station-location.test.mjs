import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStationLocation } from '../src/lib/station-registry.mjs';
test('fallback coordinates reject missing, coerced and out-of-range values',()=>{
 for(const value of [null,{lat:null,lng:110},{lat:'',lng:110},{lat:91,lng:110},{lat:-7,lng:181},{lat:NaN,lng:110}])assert.throws(()=>validateStationLocation(value));
 assert.deepEqual(validateStationLocation({lat:-7.78,lng:110.41}),{lat:-7.78,lng:110.41});
 assert.deepEqual(validateStationLocation({lat:0,lng:0}),{lat:0,lng:0});
});
