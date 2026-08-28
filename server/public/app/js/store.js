const KEY = 'rch.settings.v1';

export function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function get(key, fallback = null) {
  const s = loadAll();
  return key in s ? s[key] : fallback;
}

export function set(key, value) {
  const s = loadAll();
  s[key] = value;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function remove(key) {
  const s = loadAll();
  delete s[key];
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}