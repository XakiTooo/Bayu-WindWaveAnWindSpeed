import http from 'node:http';
import { fileURLToPath } from 'node:url';

process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const PORT = 3001;
const SHARE_KEY = process.env.BAYU_TELEMETRY_SHARE_KEY;
if (!SHARE_KEY) throw new Error('BAYU_TELEMETRY_SHARE_KEY belum diatur di .env.local');
const UPSTREAM_URL = new URL('https://bayu-windwave-and-windspeed.vercel.app/api/check-data');
UPSTREAM_URL.searchParams.set('key', SHARE_KEY);

// Cache telemetri terkini
let lastTelemetry = null;
let historyLog = [];

async function fetchLatestData() {
  try {
    const res = await fetch(UPSTREAM_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) {
        // Cek apakah data baru
        if (!lastTelemetry || lastTelemetry.receivedAt !== data.receivedAt) {
          historyLog.unshift({
            time: new Date().toLocaleTimeString('id-ID'),
            speed: data.windSpeedKmh,
            deg: data.windDirectionDeg,
            status: data.status,
            age: data.ageSeconds
          });
          if (historyLog.length > 30) historyLog.pop();
        }
        lastTelemetry = data;
      }
    }
  } catch (err) {
    // Abaikan error jaringan sementara
  }
}

// Polling data cloud tiap 1 detik
setInterval(fetchLatestData, 1000);
fetchLatestData();

const HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AeroSense & Bayu — Live Telemetry Inspector</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #131b2e;
      --border: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --cyan: #06b6d4;
      --green: #10b981;
      --amber: #f59e0b;
      --red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
      min-height: 100vh;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .title h1 { font-size: 24px; font-weight: 700; color: var(--cyan); }
    .title p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 14px;
    }
    .badge-online { background: rgba(16, 185, 129, 0.2); color: var(--green); border: 1px solid var(--green); }
    .badge-stale { background: rgba(245, 158, 11, 0.2); color: var(--amber); border: 1px solid var(--amber); }
    .badge-waiting { background: rgba(239, 68, 68, 0.2); color: var(--red); border: 1px solid var(--red); }
    .pulse-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 10px currentColor;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .card-label { font-size: 13px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .card-val { font-size: 40px; font-weight: 800; margin: 12px 0 6px 0; color: #fff; font-variant-numeric: tabular-nums; }
    .card-sub { font-size: 13px; color: var(--text-muted); }

    .compass-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .compass {
      width: 140px; height: 140px;
      border-radius: 50%;
      border: 3px solid var(--border);
      position: relative;
      margin: 12px 0;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle, #1a243d 0%, #0d1322 100%);
    }
    .compass-needle {
      width: 4px; height: 110px;
      position: absolute;
      transform-origin: center center;
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .compass-needle::before {
      content: '';
      position: absolute; top: 0; left: -4px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 25px solid var(--red);
    }
    .compass-needle::after {
      content: '';
      position: absolute; bottom: 0; left: -4px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 25px solid #cbd5e1;
    }
    .compass-labels {
      position: absolute; width: 100%; height: 100%;
      font-size: 11px; font-weight: bold; color: var(--text-muted);
    }
    .compass-labels .n { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); color: var(--red); }
    .compass-labels .s { position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); }
    .compass-labels .e { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }
    .compass-labels .w { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); }

    .table-container {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .table-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      display: flex; justify-content: space-between; align-items: center;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { background: #0f1626; color: var(--text-muted); padding: 12px 20px; font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #e2e8f0; font-family: monospace; }
    tr:hover { background: rgba(255,255,255,0.02); }

    .raw-box {
      margin-top: 20px;
      background: #080c14;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 12px;
      color: #38bdf8;
      overflow-x: auto;
      max-height: 160px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">
      <h1>📡 AeroSense & Bayu — Live Telemetry Inspector</h1>
      <p>Port Khusus Pemantauan Paket Data Real-Time ESP32 IoT (Port 3001)</p>
    </div>
    <div id="statusBadge" class="badge badge-waiting">
      <span class="pulse-dot"></span>
      <span id="statusText">Menghubungkan ke Cloud...</span>
    </div>
  </div>

  <div class="grid">
    <!-- Kecepatan Angin -->
    <div class="card">
      <div class="card-label">Kecepatan Angin (Wind Speed)</div>
      <div class="card-val"><span id="speedVal">0.0</span> <span style="font-size: 18px; color: var(--text-muted);">km/h</span></div>
      <div class="card-sub"><span id="speedMps">0.0</span> m/s | Anemometer Pulsa GPIO 4</div>
    </div>

    <!-- Arah Angin & Kompas -->
    <div class="card compass-box">
      <div class="card-label" style="width: 100%;">Arah Angin (Wind Direction)</div>
      <div class="compass">
        <div class="compass-labels">
          <span class="n">U</span>
          <span class="e">T</span>
          <span class="s">S</span>
          <span class="w">B</span>
        </div>
        <div id="needle" class="compass-needle"></div>
      </div>
      <div style="font-size: 18px; font-weight: 700;">
        <span id="degVal">0.0</span>° (<span id="cardinalVal">--</span>)
      </div>
      <div class="card-sub">Sensor AS5600 0x36 / ADC34</div>
    </div>

    <!-- Umur Paket / Latensi -->
    <div class="card">
      <div class="card-label">Umur Data / Latensi Paket</div>
      <div class="card-val" id="ageVal" style="color: var(--cyan);">--</div>
      <div class="card-sub" id="lastTimeSub">Menunggu paket data dari ESP32...</div>
    </div>

    <!-- Info Stasiun & GPS -->
    <div class="card">
      <div class="card-label">Identitas Alat & Protokol</div>
      <div style="margin: 14px 0; font-size: 14px; line-height: 1.8;">
        <div><b>Stasiun ID:</b> <span id="stationIdVal" style="color: var(--cyan);">angin-01</span></div>
        <div><b>Jalur Data:</b> <span style="color: var(--green);">EMQX Cloud MQTTS (TLS 8883)</span></div>
        <div><b>Sinkronisasi:</b> <span id="syncStatus">Real-time Stream</span></div>
      </div>
      <div class="card-sub">Dashboard Utama: <a href="http://localhost:3000" target="_blank" style="color: var(--cyan); text-decoration: none;">http://localhost:3000 ↗</a></div>
    </div>
  </div>

  <!-- Tabel Riwayat Paket Masuk -->
  <div class="table-container">
    <div class="table-header">
      <span>📥 Riwayat Paket Telemetri Masuk Real-Time</span>
      <span style="font-size: 12px; color: var(--text-muted);">Otomatis Diperbarui Tiap 1 Detik</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Waktu Masuk</th>
          <th>Kecepatan</th>
          <th>Arah / Derajat</th>
          <th>Status Cloud</th>
          <th>Umur Paket</th>
        </tr>
      </thead>
      <tbody id="tableBody">
        <tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 24px;">Menunggu data telemetri pertama dari alat...</td></tr>
      </tbody>
    </table>
  </div>

  <div class="raw-box" id="rawJson">// Menunggu raw JSON dari server...</div>

  <script>
    function degToCardinal(deg) {
      if (deg < 0) deg += 360;
      if (deg >= 360) deg -= 360;
      if (deg >= 337.5 || deg < 22.5) return 'U';
      if (deg >= 22.5 && deg < 67.5) return 'TL';
      if (deg >= 67.5 && deg < 112.5) return 'T';
      if (deg >= 112.5 && deg < 157.5) return 'TG';
      if (deg >= 157.5 && deg < 202.5) return 'S';
      if (deg >= 202.5 && deg < 247.5) return 'BD';
      if (deg >= 247.5 && deg < 292.5) return 'B';
      if (deg >= 292.5 && deg < 337.5) return 'BL';
      return '--';
    }

    async function updateMonitor() {
      try {
        const res = await fetch('/api/data');
        if (!res.ok) return;
        const json = await res.json();
        const data = json.telemetry;
        const history = json.history || [];

        if (data) {
          const isFresh = data.ageSeconds <= 5;
          const isOnline = data.ageSeconds <= 30;

          // Status Badge
          const badge = document.getElementById('statusBadge');
          const badgeText = document.getElementById('statusText');
          if (isFresh) {
            badge.className = 'badge badge-online';
            badgeText.textContent = 'LIVE ONLINE (Data Mengalir Tiap Detik!)';
          } else if (isOnline) {
            badge.className = 'badge badge-online';
            badgeText.textContent = 'ONLINE (Sinyal Normal)';
          } else {
            badge.className = 'badge badge-stale';
            badgeText.textContent = 'MENUNGGU ALAT DICOLOK (Data Stale: ' + data.ageSeconds + 's)';
          }

          // Nilai
          document.getElementById('speedVal').textContent = Number(data.windSpeedKmh || 0).toFixed(1);
          document.getElementById('speedMps').textContent = (Number(data.windSpeedKmh || 0) / 3.6).toFixed(2);

          const deg = Number(data.windDirectionDeg || 0);
          document.getElementById('degVal').textContent = deg.toFixed(1);
          document.getElementById('cardinalVal').textContent = degToCardinal(deg);
          document.getElementById('needle').style.transform = 'rotate(' + deg + 'deg)';

          // Umur paket
          const ageEl = document.getElementById('ageVal');
          if (data.ageSeconds <= 2) {
            ageEl.textContent = data.ageSeconds + ' detik (Fresh)';
            ageEl.style.color = '#10b981';
          } else if (data.ageSeconds <= 30) {
            ageEl.textContent = data.ageSeconds + ' detik';
            ageEl.style.color = '#06b6d4';
          } else {
            ageEl.textContent = data.ageSeconds + ' detik lalu';
            ageEl.style.color = '#f59e0b';
          }

          document.getElementById('lastTimeSub').textContent = 'Pukul: ' + (data.receivedAtIso ? new Date(data.receivedAtIso).toLocaleTimeString('id-ID') : '--');
          document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);

          // Update Tabel History
          if (history.length > 0) {
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = history.map(item => \`
              <tr>
                <td>\${item.time}</td>
                <td style="color: #38bdf8; font-weight: bold;">\${Number(item.speed).toFixed(1)} km/h</td>
                <td>\${Number(item.deg).toFixed(1)}° (\${degToCardinal(item.deg)})</td>
                <td><span style="color: \${item.age <= 5 ? '#10b981' : '#f59e0b'}">● \${item.status}</span></td>
                <td>\${item.age}s lalu</td>
              </tr>
            \`).join('');
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    setInterval(updateMonitor, 1000);
    updateMonitor();
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ telemetry: lastTelemetry, history: historyLog }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[LIVE INSPECTOR] Server aktif di http://localhost:${PORT}`);
});
