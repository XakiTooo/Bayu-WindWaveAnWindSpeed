export async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    throw new Error(`Server mengembalikan respons kosong atau tidak valid (HTTP ${response.status}). Periksa Runtime Logs deployment Vercel.`);
  }
  if (!data || typeof data !== 'object') throw new Error('Format respons server tidak valid.');
  return data;
}
