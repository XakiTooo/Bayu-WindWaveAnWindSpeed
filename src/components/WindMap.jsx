'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { CENTER, format, stateColor } from '@/lib/simulation.mjs';

function icon(station, index, selected, settings) {
  return L.divIcon({ className: 'wind-marker', iconSize: [48, 65], iconAnchor: [24, 24], html: `<div class="marker-wrap ${index === selected ? 'selected-marker' : ''} ${!station.online ? 'offline-marker' : ''}" style="--state:${stateColor(station, settings)}"><div class="marker-halo"></div><div class="marker-core"><span class="marker-arrow" style="transform:rotate(${station.angle}deg)">↑</span></div><span class="marker-label">${station.online ? format(station.speed) + ' km/jam' : 'Terputus'}<small>${station.id}</small></span></div>` });
}

function centerOnStation(map, station, zoom = map.getZoom()) {
  const mobile = map.getSize().x <= 760;
  const offset = mobile ? L.point(0, map.getSize().y * .25) : L.point(-185, 0);
  const center = map.unproject(map.project([station.lat, station.lng], zoom).add(offset), zoom);
  map.setView(center, zoom, { animate: true });
}

export default function WindMap({ stations, selected, settings, onSelect, onClear, focusRequest, fitRequest }) {
  const container = useRef(null), mapRef = useRef(null), markerRefs = useRef([]);
  const selectRef = useRef(onSelect), clearRef = useRef(onClear);
  const [mapError, setMapError] = useState(false);
  selectRef.current = onSelect;
  clearRef.current = onClear;

  useEffect(() => {
    const map = L.map(container.current, { zoomControl: false, scrollWheelZoom: true }).setView(CENTER, 16);
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.on('click', () => clearRef.current?.());
    let loaded = false;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }).addTo(map);
    tiles.on('tileload', () => { loaded = true; setMapError(false); });
    tiles.on('tileerror', () => { if (!loaded) setMapError(true); });
    markerRefs.current = stations.map((station, index) => L.marker([station.lat, station.lng], { title: `Pilih ${station.name}`, icon: icon(station, index, selected, settings), bubblingMouseEvents: false }).addTo(map).on('click', () => selectRef.current(index)));
    map.fitBounds(stations.map((s) => [s.lat, s.lng]), { padding: [95, 110], maxZoom: 16 });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; markerRefs.current = []; };
    // Coordinates are fixed for this demo; readings update independently below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markerRefs.current.forEach((marker, index) => {
      const element = marker.getElement();
      if (!element) return;
      const station = stations[index], wrap = element.querySelector('.marker-wrap');
      wrap.style.setProperty('--state', stateColor(station, settings));
      wrap.classList.toggle('selected-marker', index === selected);
      wrap.classList.toggle('offline-marker', !station.online);
      element.querySelector('.marker-arrow').style.transform = `rotate(${station.angle}deg)`;
      element.querySelector('.marker-label').innerHTML = `${station.online ? format(station.speed) + ' km/jam' : 'Terputus'}<small>${station.id}</small>`;
      marker.setZIndexOffset(index === selected ? 1000 : 0);
    });
  }, [stations, selected, settings]);

  useEffect(() => {
    if (selected !== null && mapRef.current) centerOnStation(mapRef.current, stations[selected]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useEffect(() => {
    if (focusRequest && selected !== null && mapRef.current) centerOnStation(mapRef.current, stations[selected], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);
  useEffect(() => {
    if (fitRequest && mapRef.current) mapRef.current.fitBounds(stations.map((s) => [s.lat, s.lng]), { padding: [95, 110], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  return <section className="map-stage" aria-label="Peta pemantauan angin"><div id="map" ref={container} />{mapError && <div className="map-error">Peta belum termuat. Periksa koneksi internet.</div>}</section>;
}
