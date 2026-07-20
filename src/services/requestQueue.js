import { JsonStore } from '../utils/jsonStore.js';

const store = new JsonStore('requests.json', { items: [], lastByUser: {} });

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
