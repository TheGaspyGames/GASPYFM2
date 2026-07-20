import { io } from 'socket.io-client';
import { env } from '../config/env.js';
import { JsonStore } from '../utils/jsonStore.js';
import { logger } from '../services/logger.js';

const tokenStore = new JsonStore('ytm-token.json', { token: '' });

export class YtmClient {
  constructor() {
    this.token = tokenStore.read().token || '';
    this.state = null;
    this.socket = null;
  }

  async requestCode() {
    const res = await fetch(`${env.ytmApiBase}/auth/requestcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: env.ytmAppId,
        appName: env.ytmAppName,
        appVersion: env.ytmAppVersion
      })
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`requestcode -> ${res.status} :: ${text}`);
    const data = JSON.parse(text);
    if (!data?.code) throw new Error('requestcode no devolvió code');
    return data.code;
  }

  async requestToken(code) {
    const res = await fetch(`${env.ytmApiBase}/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: env.ytmAppId,
        code
      })
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`request -> ${res.status} :: ${text}`);
    const data = JSON.parse(text);
    if (!data?.token) throw new Error('request no devolvió token');
    return data.token;
  }

  async ensureAuth() {
    if (this.token) return this.token;

    const code = await this.requestCode();
    logger.info(`Autoriza este código en YTMDesktop: ${code}`);

    const deadline = Date.now() + 30000;
    let lastErr = null;

    while (Date.now() < deadline) {
      try {
        const token = await this.requestToken(code);
        this.token = token;
        tokenStore.write({ token: this.token });
        logger.info('Token YTMDesktop guardado');
        return this.token;
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        if (!msg.includes('401') && !msg.includes('UNAUTHORIZED') && !msg.includes('timeout')) {
          throw e;
        }
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    throw new Error(`No se pudo autorizar YTMDesktop a tiempo. Último error: ${lastErr?.message || lastErr || 'desconocido'}`);
  }

  async request(path, options = {}) {
    await this.ensureAuth();

    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers.Authorization = this.token;

    const res = await fetch(`${env.ytmApiBase}${path}`, { ...options, headers });
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`YTM ${path} -> ${res.status} ${res.statusText} :: ${text.slice(0, 300)}`);
    }

    if (!text) return null;

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return JSON.parse(text);
    return text;
  }

  async getState() {
    await this.ensureAuth();
    this.state = await this.request('/state', { method: 'GET' });
    return this.state;
  }

  async command(command, data) {
    await this.ensureAuth();
    return this.request('/command', {
      method: 'POST',
      body: JSON.stringify(
        data === undefined ? { command } : { command, data }
      )
    });
  }

  async connectRealtime(onState) {
    await this.ensureAuth();

    const apiUrl = new URL(env.ytmApiBase);
    const origin = `${apiUrl.protocol}//${apiUrl.host}`;

    this.socket = io(`${origin}/api/v1/realtime`, {
      transports: ['websocket'],
      auth: { token: this.token }
    });

    this.socket.on('connect', () => logger.info('Realtime YTM conectado'));
    this.socket.on('state-update', (state) => {
      this.state = state;
      onState?.(state);
    });
    this.socket.on('connect_error', (err) => {
      logger.error('Realtime YTM error', err.message);
    });
  }
}