import mqtt from 'mqtt';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export function freshDirectionSample(reading, started, now, baseline) {
  const sample=reading?.directionSample;
  if(reading?.directionProcessing!=='server' || reading.directionSensorValid!==true || now-started<2500 || !sample || sample.samples<30
    || !Number.isFinite(sample.rawDeg) || sample.rawDeg<0 || sample.rawDeg>=360 || !Number.isSafeInteger(sample.capturedAt)
    || sample.capturedAt===baseline || Math.abs(now-sample.capturedAt)>15000) return null;
  return sample.rawDeg;
}
export function captureDirectionFromMqtt(stationId) {
  return new Promise((resolve,reject)=>{
    const {MQTT_URL,MQTT_USERNAME,MQTT_PASSWORD,MQTT_CA_PEM,MQTT_CA_FILE}=process.env;
    if(!MQTT_URL || !MQTT_USERNAME || !MQTT_PASSWORD || new URL(MQTT_URL).protocol!=='mqtts:') return reject(failure('Konfigurasi MQTT backend belum lengkap.',503));
    const ca=MQTT_CA_PEM || (MQTT_CA_FILE ? readFileSync(MQTT_CA_FILE) : readFileSync(join(process.cwd(),'worker','emqxsl-ca.crt')));
    const client=mqtt.connect(MQTT_URL,{username:MQTT_USERNAME,password:MQTT_PASSWORD,ca,rejectUnauthorized:true,reconnectPeriod:0,connectTimeout:5000});
    const started=Date.now();let settled=false, baseline, sawMessage=false;
    const topic=`bayu/stations/${stationId}/telemetry`;
    const timer=setTimeout(()=>finish(failure(sawMessage?'Belum mendapat sampel baru yang stabil. Tahan sayap lalu rekam kembali.':'Tidak ada telemetri MQTT dari pengirim. Periksa ID stasiun, koneksi, dan izin subscribe backend.',504)),14000);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);client.end(true);error?reject(error):resolve(value);}
    client.on('error',()=>finish(failure('Backend tidak dapat terhubung ke MQTT. Periksa konfigurasi dan izin akses.',503)));
    client.on('connect',()=>client.subscribe(topic,{qos:1},(error,granted)=>{
      if(error || !granted?.length || granted.some(g=>g.qos===128)) finish(failure('Backend tidak diizinkan membaca topik telemetri stasiun.',503));
    }));
    client.on('message',(received,payload,packet)=>{
      if(received!==topic || packet.retain || payload.length>4096) return;
      let reading;try{reading=JSON.parse(payload.toString('utf8'));}catch{return;}
      if(reading.stationId!==stationId)return;
      sawMessage=true;
      if(reading.directionProcessing!=='server')return finish(failure('Pengirim masih memakai firmware lama. Upload firmware pengirim mode backend.'));
      if(reading.directionSensorValid===false)return finish(failure('AS5600 I²C atau magnet belum terbaca. Periksa Serial Monitor pengirim.'));
      if(baseline===undefined)baseline=reading.directionSample?.capturedAt ?? 0;
      const raw=freshDirectionSample(reading,started,Date.now(),baseline);
      if(raw!==null)finish(null,raw);
    });
  });
}
function failure(message,status=422){const error=new Error(message);error.calibrationError=true;error.status=status;return error;}
