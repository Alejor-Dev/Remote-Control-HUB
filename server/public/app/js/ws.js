export class Transport {
  constructor({ url, token, onOpen, onMessage, onClose }) {
    this.url = url;
    this.token = token;
    this.onOpenCallback = onOpen;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.ws = null;
    this.closedByUser = false;
    this.ready = false;
    this.queue = [];
    this.retry = 0;
  }

  start() {
    this.closedByUser = false;
    this.ready = false;
    this.#connect();
  }

  #connect() {
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', token: this.token }));
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.ready = true;
        try {
          this.onOpenCallback?.(m);
        } catch {}
        this.#flush();
      } else {
        this.onMessage?.(m);
      }
    };

    ws.onclose = () => {
      this.ready = false;
      this.ws = null;
      this.onClose?.();
      if (!this.closedByUser) this.#scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }

  #scheduleReconnect() {
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.retry, 4));
    this.retry += 1;
    setTimeout(() => {
      if (!this.closedByUser) this.#connect();
    }, delay);
  }

  #flush() {
    while (this.queue.length) this.send(this.queue.shift());
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch {}
    } else if (this.queue.length < 500) {
      this.queue.push(obj);
    }
  }

  sendAudio(buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(buffer);
      } catch {}
    }
  }

  stop() {
    this.closedByUser = true;
    this.ready = false;
    try {
      this.ws?.close();
    } catch {}
  }
}