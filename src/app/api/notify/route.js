export const runtime = 'nodejs';

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { botToken, chatId, message, stationId, speed, threshold } = body;

    if (!botToken || !chatId) {
      return Response.json({ error: 'Token Bot Telegram dan Chat ID wajib diisi.' }, { status: 400, headers });
    }

    const text = message || (
      `🚨 *PERINGATAN ANGIN KENCANG BAYU IoT*\n\n` +
      `📍 *Stasiun:* \`${stationId || 'angin-01'}\`\n` +
      `💨 *Kecepatan:* \`${speed} km/jam\` (Batas: ${threshold} km/jam)\n` +
      `⏰ *Waktu:* ${new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
      `_Status: Memerlukan perhatian tim lapangan._`
    );

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      return Response.json({ error: data.description || 'Gagal mengirim ke Telegram.' }, { status: 400, headers });
    }

    return Response.json({ success: true, message: 'Notifikasi Telegram berhasil terkirim!' }, { headers });
  } catch (error) {
    return Response.json({ error: 'Gagal menghubungkan ke server Telegram.' }, { status: 500, headers });
  }
}
