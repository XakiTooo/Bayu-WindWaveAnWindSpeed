import 'leaflet/dist/leaflet.css';
import './maps.css';

export const metadata = {
  title: 'BAYU — Pemantauan Angin',
  description: 'Dashboard demo stasiun angin IoT di sekitar Kampus Babarsari UPN Yogyakarta. Seluruh pembacaan merupakan data simulasi.',
};

export default function RootLayout({ children }) {
  return <html lang="id"><body>{children}</body></html>;
}
