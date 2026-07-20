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

  /** Número de peticiones en cola */
  size() {
    return store.read().items.length;
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

  /**
   * Elimina una petición por su ID.
   * Devuelve el item eliminado o null si no se encontró.
   */
  remove(id) {
    const data = store.read();
    const idx = data.items.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const [removed] = data.items.splice(idx, 1);
    store.write(data);
    return removed;
  }

  /**
   * Devuelve los segundos restantes de cooldown para un usuario.
   * Retorna 0 si ya puede pedir.
   */
  cooldownRemaining(userId, cooldownSeconds) {
    const data = store.read();
    const last = data.lastByUser[userId] || 0;
    const elapsed = (Date.now() - last) / 1000;
    const remaining = cooldownSeconds - elapsed;
    return remaining > 0 ? Math.ceil(remaining) : 0;
  }

  canRequest(userId, cooldownSeconds) {
    return this.cooldownRemaining(userId, cooldownSeconds) === 0;
  }
}
