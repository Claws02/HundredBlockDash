// ============================================================
// STORAGE — tiny, safe localStorage wrapper.
// All keys are namespaced under `hbd_`. Every call is guarded so a
// private-mode / disabled-storage browser degrades gracefully (the
// game still runs, it just won't remember anything).
// ============================================================

const PREFIX = 'hbd_';

export function load(key, fallback = null) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

export function save(key, value) {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
    } catch (e) {
        return false;
    }
}

export function remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
}
