/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/api/telemetry/ingest': ['./worker/emqxsl-ca.crt'],
    '/api/command': ['./worker/emqxsl-ca.crt'],
    '/api/stations/*/firmware': [
      './firmware/BAYU_Pengirim_Web/BAYU_Pengirim_Web.ino',
      './firmware/BAYU_Penerima_Web/BAYU_Penerima_Web.ino',
    ],
  },
  outputFileTracingExcludes: {
    '/api/stations/*/firmware': [
      './firmware/local/**/*',
      './firmware/**/config.h',
      './firmware/01_Pengirim_Luar/**/*',
      './firmware/02_Penerima_Dalam/**/*',
      './firmware/AeroSense_Sensor_Pengirim/**/*',
      './firmware/AeroSense_ESP_Penerima/**/*',
    ],
  },
};
export default nextConfig;
