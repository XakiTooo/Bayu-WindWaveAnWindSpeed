import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { currentUser } from '@/lib/auth-store.mjs';
import { sameOrigin } from '@/lib/admin-session.mjs';
import { getStation, canManageStation, normalizeStationId } from '@/lib/station-registry.mjs';
import { firmwareRoles, renderFirmware } from '@/lib/firmware-template.mjs';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request, context) {
  if (!sameOrigin(request)) return Response.json({ error: 'Asal permintaan tidak valid.' }, { status: 403, headers });
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: 'Masuk untuk menyiapkan kode alat.' }, { status: 401, headers });
    const id = normalizeStationId((await context.params).id);
    if (!id) return Response.json({ error: 'ID stasiun tidak valid.' }, { status: 400, headers });
    if (!canManageStation(user, await getStation(id))) return Response.json({ error: 'Akses stasiun ditolak.' }, { status: 403, headers });
    const input = await request.json();
    const firmware = input && Object.hasOwn(firmwareRoles, input.role) && firmwareRoles[input.role];
    if (!firmware) return Response.json({ error: 'Pilih pengirim atau penerima.' }, { status: 400, headers });
    const filename = firmware.folder + '.ino';
    const source = await readFile(join(process.cwd(), 'firmware', firmware.folder, filename), 'utf8');
    const code = renderFirmware(source, id, input, process.env.MQTT_URL || 'mqtts://g916bd01.ala.us-east-1.emqxsl.com:8883');
    return new Response(code, { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"` } });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error.message?.includes('tidak valid');
    console.error('Firmware preparation failed:', error.code || error.name);
    return Response.json({ error: invalid ? 'Periksa isian jaringan. Karakter kontrol tidak diperbolehkan.' : 'Kode alat belum tersedia. Silakan coba lagi.' }, { status: invalid ? 400 : 503, headers });
  }
}
