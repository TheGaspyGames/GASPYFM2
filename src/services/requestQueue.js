import { JsonStore } from '../utils/jsonStore.js';

const store = new JsonStore('requests.json', { items: [], lastByUser: {} });

// Limpiar entradas de cooldown más antiguas que 24h para no crecer el JSON indefinidamente
const PRUNE_OLDER_THAN_MS = 24 * 60 * 60 * 1000;

function pruneLastByUser(data) {
  const cutoff = Date.now() - PRUNE_OLDER_THAN_MS;
  for (const [userId, ts] of Object.entries(data.lastByUser)) {
    if (ts < cutoff) delete data.lastByUser[userId];
  }
}

export class RequestQueue {
  all() {
    return store.read();
  }

  list() {
    return store.read().items;
  }

  add(item) {
    const data = store.read();
    const id = crypto.randomUUID();
    const withMeta = { id, createdAt: new Date().toISOString(), ...item };
    data.items.push(withMeta);
    data.lastByUser[item.userId] = Date.now();
    pruneLastByUser(data);
    store.write(data);
    return withMeta;
  }

  shift() {
    const data = store.read();
    const item = data.items.shift() || null;
    store.write(data);
    return item;
  }

  canRequest(userId, cooldownSeconds) {
    const data = store.read();
    const last = data.lastByUser[userId] || 0;
    return Date.now() - last >= cooldownSeconds * 1000;
  }
}
