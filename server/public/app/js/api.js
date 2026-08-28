export async function api(path, method = 'GET', body = null) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const pairRequest = (deviceId, name) =>
  api('/api/pair/request', 'POST', { deviceId, name });

export const pairConfirm = (pairingId, code) =>
  api('/api/pair/confirm', 'POST', { pairingId, code });