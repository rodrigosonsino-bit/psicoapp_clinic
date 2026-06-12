import { getSavedApiUrl } from './api';

export interface SocketClientCallbacks {
  onStatusChanged?: (status: any) => void;
  onQrReceived?: (qr: string) => void;
  onDisconnected?: () => void;
  onConnected?: () => void;
}

export class SocketClient {
  private socket: WebSocket | null = null;
  private token: string;
  private callbacks: SocketClientCallbacks;
  private retryCount = 0;
  private maxRetries = 5;
  private isClosedIntentional = false;
  private authTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(token: string, callbacks: SocketClientCallbacks) {
    this.token = token;
    this.callbacks = callbacks;
  }

  connect() {
    this.isClosedIntentional = false;
    const apiUrl = getSavedApiUrl();
    const wsUrl = apiUrl.replace(/^http/, 'ws') + '/socket';
    
    console.log('Connecting to WebSocket:', wsUrl);
    try {
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = () => {
        console.log('WebSocket connection opened. Sending auth handshake...');
        this.retryCount = 0;
        
        // Message-based authentication handshake
        this.socket?.send(JSON.stringify({
          type: 'auth',
          token: this.token
        }));
        
        // Timeout if server doesn't respond or validate
        this.authTimeout = setTimeout(() => {
          console.warn('Auth handshake timeout. Closing socket...');
          this.disconnect();
          this.callbacks.onDisconnected?.();
        }, 5000);
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('WebSocket message received:', message);
          
          if (message.type === 'auth_success') {
            if (this.authTimeout) {
              clearTimeout(this.authTimeout);
              this.authTimeout = null;
            }
            this.callbacks.onConnected?.();
          } else if (message.type === 'whatsapp_status') {
            this.callbacks.onStatusChanged?.(message.data);
          } else if (message.type === 'whatsapp_qr') {
            this.callbacks.onQrReceived?.(message.data);
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      this.socket.onerror = (error) => {
        console.warn('WebSocket error:', error);
      };

      this.socket.onclose = () => {
        console.log('WebSocket closed');
        if (this.authTimeout) {
          clearTimeout(this.authTimeout);
          this.authTimeout = null;
        }

        if (!this.isClosedIntentional) {
          this.handleReconnect();
        }
      };
    } catch (e) {
      console.warn('WebSocket setup failed:', e);
      this.handleReconnect();
    }
  }

  private handleReconnect() {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
      console.log(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})...`);
      setTimeout(() => {
        if (!this.isClosedIntentional) {
          this.connect();
        }
      }, delay);
    } else {
      console.warn('WebSocket reconnection attempts exhausted. Falling back to HTTP Polling...');
      this.callbacks.onDisconnected?.();
    }
  }

  disconnect() {
    this.isClosedIntentional = true;
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
