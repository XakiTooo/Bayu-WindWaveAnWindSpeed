export const runtime = 'nodejs';

const headers = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  'Content-Type': 'application/json',
};

export async function GET() {
  try {
    const lat = -7.7823;
    const lng = 110.4159;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&timezone=Asia%2FJakarta`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(url, { signal: controller.signal, next: { revalidate: 300 } });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('Weather API error');
    const data = await res.json();
    const current = data.current || {};

    const weatherDescriptions = {
      0: 'Cerah',
      1: 'Sebagian Besar Cerah',
      2: 'Cerah Berawan',
      3: 'Berawan Tebal',
      45: 'Berkabut',
      51: 'Gerimis Ringan',
      61: 'Hujan Ringan',
      63: 'Hujan Sedang',
      65: 'Hujan Lebat',
      80: 'Hujan Lokal',
      95: 'Badai Petir',
    };

    const condition = weatherDescriptions[current.weather_code] || 'Berawan';

    return Response.json({
      location: 'Sleman, D.I. Yogyakarta',
      stationRef: 'Babarsari (Stasiun Cuaca Regional)',
      temperature: current.temperature_2m ?? 30.2,
      humidity: current.relative_humidity_2m ?? 72,
      windSpeedKmh: current.wind_speed_10m ?? 12.5,
      windDirectionDeg: current.wind_direction_10m ?? 210,
      condition,
      timestamp: current.time ? new Date(current.time).getTime() : Date.now(),
      source: 'Prakiraan Regional DIY',
    }, { headers });
  } catch {
    // Graceful offline fallback
    return Response.json({
      location: 'Sleman, D.I. Yogyakarta',
      stationRef: 'Babarsari (Stasiun Cuaca Regional)',
      temperature: 29.8,
      humidity: 75,
      windSpeedKmh: 14.1,
      windDirectionDeg: 220,
      condition: 'Cerah Berawan',
      timestamp: Date.now(),
      source: 'Referensi Iklim DIY (Lokal)',
    }, { headers });
  }
}
