'use client';
import { useState } from 'react';
import { readApiResponse } from '@/lib/api-response.mjs';
export default function StationSettings({station,canManage,warningThreshold,setWarningThreshold,threshold,setThreshold,directionOffset,setDirectionOffset,soundAlert,onSound,onSave,saving,pendingCommand,onApply,onSetup,onLocationSaved,onDelete,deleting}) {
 const [location,setLocation]=useState({lat:station.fallbackLat ?? station.lat,lng:station.fallbackLng ?? station.lng});
 const [locationBusy,setLocationBusy]=useState(false),[message,setMessage]=useState('');
 const saved=station.settings || {warningKmh:5,dangerKmh:15,directionOffsetDeg:0};
 const dirty=Number(warningThreshold)!==saved.warningKmh || Number(threshold)!==saved.dangerKmh || Number(directionOffset)!==saved.directionOffsetDeg;
 async function saveLocation(event){
  event.preventDefault();if(locationBusy)return;setLocationBusy(true);setMessage('');
  try{const response=await fetch('/api/stations/'+station.id.toLowerCase(),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'location',lat:Number(location.lat),lng:Number(location.lng)})});const data=await readApiResponse(response);if(!response.ok)throw new Error(data.error);onLocationSaved(data.location);setMessage('Koordinat cadangan tersimpan.');}
  catch(error){setMessage(error.message || 'Lokasi belum tersimpan.');}finally{setLocationBusy(false);}
 }
 function locate(){
  if(!navigator.geolocation){setMessage('Lokasi browser tidak tersedia.');return;}
  setLocationBusy(true);setMessage('Mencari lokasi perangkat…');
  navigator.geolocation.getCurrentPosition(({coords})=>{setLocation({lat:Number(coords.latitude.toFixed(6)),lng:Number(coords.longitude.toFixed(6))});setLocationBusy(false);setMessage('Lokasi perangkat terisi. Tekan Simpan lokasi untuk menggunakan koordinat ini.');},()=>{setLocationBusy(false);setMessage('Lokasi tidak dapat dibaca. Isi koordinat secara manual.');},{enableHighAccuracy:true,timeout:10000});
 }
 return <section className="station-settings" aria-labelledby="station-settings-title">
  <header className="settings-intro"><h2 id="station-settings-title">Pengaturan stasiun</h2><p>Atur alarm dan arah untuk <strong>{station.name}</strong>. Setiap stasiun menyimpan pengaturannya sendiri.</p></header>
  {!canManage && <p className="settings-access">Hanya pemilik stasiun yang dapat mengubah pengaturan.</p>}
  <form onSubmit={onSave}>
   <fieldset className="settings-group" disabled={!canManage || saving}><legend>01 · Peringatan angin</legend><p>Dua batas ini membagi kecepatan menjadi normal, waspada, dan bahaya.</p>
    <div className="settings-field-pair"><label>Mulai waspada<span className="input-unit"><input type="number" min="0" max="199" step="0.1" required value={warningThreshold} onChange={e=>setWarningThreshold(e.target.value)}/><span>km/jam</span></span></label><label>Mulai bahaya<span className="input-unit"><input type="number" min="0.1" max="200" step="0.1" required value={threshold} onChange={e=>setThreshold(e.target.value)}/><span>km/jam</span></span></label></div>
    <div className="settings-ranges"><span>Normal <b>&lt; {warningThreshold}</b></span><span>Waspada <b>{warningThreshold}–{threshold}</b></span><span>Bahaya <b>≥ {threshold}</b></span></div>
    <p className="field-help">Batas bahaya harus lebih tinggi dari batas waspada. Satuan seluruh rentang adalah km/jam.</p>
   </fieldset>
   <fieldset className="settings-group" disabled={!canManage || saving}><legend>02 · Arah angin</legend><label>Koreksi tambahan<span className="input-unit"><input type="number" min="-360" max="360" step="0.1" value={directionOffset} onChange={e=>setDirectionOffset(e.target.value)}/><span>derajat</span></span></label><p className="field-help">Biarkan 0° jika kalibrasi empat arah sudah benar. Nilai +90° memutar hasil 90° searah jarum jam. Koreksi berlaku pada dashboard dan arah yang dikirim backend ke alat.</p><p className="settings-crosslink">Untuk merekam Utara, Timur, Selatan, dan Barat, buka tab <strong>Kontrol alat → Kalibrasi empat arah</strong>.</p></fieldset>
   <div className="settings-save-area"><button type="submit" className="primary-button" disabled={!canManage || saving || !dirty}>{saving?'Menyimpan…':'Simpan pengaturan web'}</button><p>{dirty?'Ada perubahan yang belum disimpan.':'Pengaturan web sudah sesuai nilai tersimpan.'}</p></div>
  </form>
  <div className="settings-device-apply"><h3>Samakan alarm pada ESP</h3><p>Setelah menyimpan, kirim batas waspada dan bahaya ke pengirim agar LED dan buzzer mengikuti nilai di atas.</p><button type="button" className="secondary-button" disabled={!canManage || dirty || saving || !!pendingCommand} onClick={onApply}>{pendingCommand==='apply_settings'?'Menunggu konfirmasi ESP…':'Terapkan batas angin ke ESP'}</button>{dirty && <small>Simpan perubahan web terlebih dahulu.</small>}</div>
  <section className="settings-group"><h3>03 · Suara dashboard</h3><div className="settings-switch"><div><label htmlFor="browser-alarm">Bunyikan alarm di browser</label><p>Hanya pada perangkat dan browser ini. Buzzer ESP diatur melalui tab Kontrol alat.</p></div><input id="browser-alarm" type="checkbox" role="switch" checked={soundAlert} onChange={onSound}/></div></section>
  <form onSubmit={saveLocation}><fieldset className="settings-group" disabled={!canManage || locationBusy}><legend>04 · Lokasi cadangan</legend><p>Digunakan ketika GPS alat belum mendapatkan lokasi. Saat GPS aktif, titik peta mengikuti alat.</p><div className="settings-field-pair"><label>Latitude<input type="number" min="-90" max="90" step="any" required value={location.lat} onChange={e=>setLocation({...location,lat:e.target.value})}/></label><label>Longitude<input type="number" min="-180" max="180" step="any" required value={location.lng} onChange={e=>setLocation({...location,lng:e.target.value})}/></label></div><div className="settings-location-actions"><button type="button" className="text-button" onClick={locate}>Gunakan lokasi perangkat ini</button><button type="submit" className="secondary-button">{locationBusy?'Memproses…':'Simpan lokasi'}</button></div>{message && <p role="status" className="field-help">{message}</p>}</fieldset></form>
  <section className="settings-group"><h3>05 · Hubungkan alat</h3><p>Unduh sketch pengirim atau penerima yang sesuai dengan stasiun ini. Lengkapi koneksi Wi-Fi dan MQTT sebelum upload.</p><button className="secondary-button" disabled={!canManage || !station.registered} onClick={onSetup}>Siapkan kode ESP32</button><details className="settings-technical"><summary>Identitas teknis stasiun</summary><p>ID berikut dipakai untuk mencocokkan data alat dengan akun ini. Namanya tidak perlu diubah saat mengatur arah atau alarm.</p><code>{station.id.toLowerCase()}</code></details></section>
  {canManage && station.registered && <section className="settings-group">
    <h3>Hapus stasiun</h3>
    <p>Stasiun hilang dari peta dan penerimaan data dihentikan. Riwayat disimpan sebagai arsip.</p>
    <button type="button" className="secondary-button station-remove-button" disabled={deleting || Boolean(pendingCommand)}
      onClick={onDelete}>{deleting ? 'Menghapus…' : 'Hapus stasiun'}</button>
  </section>}
 </section>;
}
