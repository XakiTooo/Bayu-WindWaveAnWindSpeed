import { getFirestore } from 'firebase-admin/firestore';
import { captureDirectionFromMqtt } from './capture-direction.mjs';
import { getDashboardAdminApp } from './firebase-admin.js';
import { canManageStation } from './station-registry.mjs';
import { validateDirectionPoints } from './direction-calibration.mjs';
function fail(message,status=422){const e=new Error(message);e.calibrationError=true;e.status=status;throw e;}
function validDraft(value,user,session){return value && value.ownerId===user.username && value.session===session && Date.now()-value.updatedAt<15*60000;}
export async function runServerCalibration(stationId,user,input){
  const app=getDashboardAdminApp(), db=getFirestore(app);
  const ref=db.doc(`stationRegistry/${stationId}`);
  let raw;
  if(input.operation==='capture'){
    const station=await ref.get();
    if(!canManageStation(user,station.data()) || !validDraft(station.data()?.calibrationDraft,user,input.session))fail('Sesi kalibrasi berakhir. Mulai kembali.');
    raw = await captureDirectionFromMqtt(stationId);
  }
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref), station=snap.data();
    if(!snap.exists || !canManageStation(user,station))fail('Akses stasiun ditolak.',403);
    if(input.operation==='start'){
      tx.update(ref,{calibrationDraft:{session:input.session,ownerId:user.username,points:[null,null,null,null],updatedAt:Date.now()}});
      return {session:input.session};
    }
    const draft=station.calibrationDraft;
    if(!validDraft(draft,user,input.session))fail('Sesi kalibrasi berakhir. Mulai kembali.');
    if(input.operation==='cancel'){tx.update(ref,{calibrationDraft:null});return {session:input.session};}
    if(input.operation==='capture'){
      const points=[...draft.points];points[input.point]=raw;
      tx.update(ref,{calibrationDraft:{...draft,points,updatedAt:Date.now()}});
      return {session:input.session,point:input.point,rawDeg:raw};
    }
    let valid;try{valid=validateDirectionPoints(draft.points);}catch(e){fail(e.message);}
    tx.update(ref,{directionCalibration:{...valid,version:1,updatedAt:Date.now()},calibrationDraft:null,updatedAt:Date.now()});
    return {session:input.session,calibrated:true,points:valid.points};
  });
}
