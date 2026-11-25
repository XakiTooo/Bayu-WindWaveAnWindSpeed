import { join } from 'node:path';
import mqtt from 'mqtt';
import { readFileSync } from 'node:fs';
export function publishProcessedDirection(stationId, reading) {
  return new Promise((resolve,reject) => {
    const {MQTT_URL,MQTT_USERNAME,MQTT_PASSWORD,MQTT_CA_PEM,MQTT_CA_FILE}=process.env;
    if (!MQTT_URL || !MQTT_USERNAME || !MQTT_PASSWORD || new URL(MQTT_URL).protocol !== 'mqtts:') return reject(new Error('MQTT configuration unavailable'));
    const ca=MQTT_CA_PEM || (MQTT_CA_FILE ? readFileSync(MQTT_CA_FILE) : readFileSync(join(process.cwd(),'worker','emqxsl-ca.crt')));
    const client=mqtt.connect(MQTT_URL,{username:MQTT_USERNAME,password:MQTT_PASSWORD,ca,rejectUnauthorized:true,reconnectPeriod:0,connectTimeout:5000});
    let settled=false;
    const timer=setTimeout(()=>finish(new Error('Direction delivery timeout')),7000);
    function finish(error){if(settled)return;settled=true;clearTimeout(timer);client.end(true);error?reject(error):resolve();}
    client.on('error',finish);
    client.on('connect',()=>client.publish(`bayu/stations/${stationId}/processed`,JSON.stringify({windDirectionDeg:reading.windDirectionDeg,receivedAt:reading.receivedAt}),{qos:1,retain:false},finish));
  });
}
