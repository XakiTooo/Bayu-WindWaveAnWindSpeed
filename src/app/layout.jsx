import 'leaflet/dist/leaflet.css';
import './maps.css';

export const metadata = {
  title: 'BAYU — Pemantauan Angin',
  description: 'Dashboard pemantauan stasiun angin BAYU dengan mode sensor IoT langsung dan mode simulasi.',
};

export default function RootLayout({ children }) {
  return <html lang="id"><body>{children}</body></html>;
}
