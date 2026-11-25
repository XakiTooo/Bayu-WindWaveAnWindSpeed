'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { CENTER, format, stateColor } from '@/lib/simulation.mjs';

function icon(station, index, selected, settings) {
  return L.divIcon({
    className: 'wind-marker',
    iconSize: [48, 65],
    iconAnchor: [24, 24],
    html: `<div class="marker-wrap ${index === selected ? 'selected-marker' : ''} ${!station.online ? 'offline-marker' : ''}" style="--state:${stateColor(station, settings)}"><div class="marker-halo"></div><div class="marker-core"><span class="marker-arrow" style="transform:rotate(${station.angle}deg)">↑</span></div><span class="marker-label">${station.online ? format(station.speed) + ' km/jam' : 'Terputus'}<small>${station.id}</small></span></div>`
  });
}

function centerOnStation(map, station, zoom = map.getZoom()) {
  if (!map || !station) return;
  const mobile = map.getSize().x <= 760;
  const offset = mobile ? L.point(0, map.getSize().y * .25) : L.point(-220, 0);
  const center = map.unproject(map.project([station.lat, station.lng], zoom).add(offset), zoom);
  map.setView(center, zoom, { animate: true });
}

export default function WindMap({ stations, selected, settings, onSelect, onClear, focusRequest, fitRequest }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const markerLayerRef = useRef(null);
  const markersMapRef = useRef(new Map());
  const selectRef = useRef(onSelect);
  const clearRef = useRef(onClear);
  const [mapError, setMapError] = useState(false);

  selectRef.current = onSelect;
  clearRef.current = onClear;

  // Initialize Map
  useEffect(() => {
    const map = L.map(container.current, { zoomControl: false, scrollWheelZoom: true }).setView(CENTER, 16);
    mapRef.current = map;
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.on('click', () => clearRef.current?.());

    let loaded = false;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);
    tiles.on('tileload', () => { loaded = true; setMapError(false); });
    tiles.on('tileerror', () => { if (!loaded) setMapError(true); });

    const markerLayer = L.layerGroup().addTo(map);
    markerLayerRef.current = markerLayer;

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      markersMapRef.current.clear();
    };
  }, []);

  // Sync Markers dynamically with stations array
  useEffect(() => {
    if (!mapRef.current || !markerLayerRef.current) return;

    const currentIds = new Set(stations.map((s) => s.id));

    // Remove obsolete markers
    for (const [id, marker] of markersMapRef.current.entries()) {
      if (!currentIds.has(id)) {
        markerLayerRef.current.removeLayer(marker);
        markersMapRef.current.delete(id);
      }
    }

    // Add or update markers
    stations.forEach((station, index) => {
      let marker = markersMapRef.current.get(station.id);
      if (!marker) {
        marker = L.marker([station.lat, station.lng], {
          title: `Pilih ${station.name}`,
          icon: icon(station, index, selected, settings),
          bubblingMouseEvents: false,
        }).addTo(markerLayerRef.current);
        marker.on('click', () => selectRef.current?.(index));
        markersMapRef.current.set(station.id, marker);
      } else {
        marker.setLatLng([station.lat, station.lng]);
        const element = marker.getElement();
        if (element) {
          const wrap = element.querySelector('.marker-wrap');
          if (wrap) {
            wrap.style.setProperty('--state', stateColor(station, settings));
            wrap.classList.toggle('selected-marker', index === selected);
            wrap.classList.toggle('offline-marker', !station.online);
          }
          const arrow = element.querySelector('.marker-arrow');
          if (arrow) arrow.style.transform = `rotate(${station.angle}deg)`;
          const label = element.querySelector('.marker-label');
          if (label) {
            label.innerHTML = `${station.online ? format(station.speed) + ' km/jam' : 'Terputus'}<small>${station.id}</small>`;
          }
        } else {
          marker.setIcon(icon(station, index, selected, settings));
        }
        marker.off('click').on('click', () => selectRef.current?.(index));
      }
      marker.setZIndexOffset(index === selected ? 1000 : 0);
    });
  }, [stations, selected, settings]);

  const lastCenterCoordRef = useRef(null);

  // Center / Focus on selected station (hanya geser kamera saat posisi koordinat GPS berubah atau saat user klik fokus)
  useEffect(() => {
    if (selected !== null && mapRef.current && stations[selected]) {
      const s = stations[selected];
      const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
      if (lastCenterCoordRef.current !== key) {
        lastCenterCoordRef.current = key;
        centerOnStation(mapRef.current, s);
      }
    }
  }, [selected, stations]);

  useEffect(() => {
    if (focusRequest && selected !== null && mapRef.current && stations[selected]) {
      centerOnStation(mapRef.current, stations[selected], 17);
    }
  }, [focusRequest, selected, stations]);

  // Fit bounds when requested or when station count changes
  useEffect(() => {
    if (!mapRef.current || !stations.length) return;
    if (stations.length === 1) {
      centerOnStation(mapRef.current, stations[0], 16);
    } else {
      mapRef.current.fitBounds(stations.map((s) => [s.lat, s.lng]), { padding: [95, 110], maxZoom: 16 });
    }
  }, [fitRequest, stations.length]);

  return (
    <section className="map-stage" aria-label="Peta pemantauan angin">
      <div id="map" ref={container} />
      {mapError && <div className="map-error">Peta belum termuat. Periksa koneksi internet.</div>}
    </section>
  );
}
