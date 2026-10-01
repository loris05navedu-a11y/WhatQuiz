import type { AckResult, PlayerView } from '../../../shared/types';

type Listener = (...args: unknown[]) => void;

const ASSET_TIMEOUT_MS = 60_000;
type Ack = (result: AckResult<object>) => void;

interface Link {
  send(event: string, payload: unknown, ack?: Ack): void;
  close(): void;
}

/**
 * Remplaçant de la connexion Socket.IO en mode sans serveur, avec la même interface pour les écrans de jeu :
 * - partie hébergée par cet onglet (professeur, tests) → branchement direct sur le hub ;
 * - sinon (élève) → liaison pair-à-pair vers l'appareil du professeur.
 * Le code du hub et de PeerJS n'est chargé qu'à la première partie.
 */
export class StandaloneSocket {
  private readonly listeners = new Map<string, Set<Listener>>();
  private link: Link | null = null;
  private closed = false;
  private releaseAssets: (() => void) | null = null;

  constructor(private readonly code: string) {
    void this.open();
  }

  on(event: string, listener: Listener): this {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    const ack = typeof args[args.length - 1] === 'function' ? (args.pop() as Ack) : undefined;
    this.link?.send(event, args[0], ack);
    return this;
  }

  disconnect(): this {
    this.closed = true;
    this.releaseAssets?.();
    this.link?.close();
    this.link = null;
    return this;
  }

  private fire(event: string, ...args: unknown[]): void {
    if (this.closed) return;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  private async open(): Promise<void> {
    const { hub } = await import('./hub');
    if (this.closed) return;
    if (hub.hasRoom(this.code)) {
      const { currentUser } = await import('./db');
      const user = await currentUser();
      if (this.closed) return;
      const client = hub.connect(user, (event, payload) => queueMicrotask(() => this.fire(event, payload)));
      this.link = {
        send: (event, payload, ack) => hub.handle(client, event, payload, ack && ((result) => queueMicrotask(() => ack(result)))),
        close: () => hub.disconnect(client),
      };
      queueMicrotask(() => this.fire('connect'));
      return;
    }
    const [{ PeerLink }, { recordPlayedGame }, { setRemoteAssetFetcher }] = await Promise.all([import('./peer'), import('./api'), import('../lib/media')]);
    if (this.closed) return;
    const link = new PeerLink(this.code, {
      onOpen: () => this.fire('connect'),
      onClose: () => this.fire('disconnect'),
      onEvent: (event, payload) => {
        this.fire(event, payload);
        if (event === 'game:state') void recordPlayedGame(payload as PlayerView);
      },
    });
    this.link = link;
    // Les fichiers des questions (images, sons, vidéos) sont demandés au professeur, une seule fois chacun.
    const fetchAsset = (id: string) =>
      new Promise<Blob | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ASSET_TIMEOUT_MS);
        link.send('asset:get', { id }, (result) => {
          clearTimeout(timer);
          const data = result.ok ? (result as { data?: unknown }).data : null;
          if (typeof data !== 'string') return resolve(null);
          fetch(data)
            .then((response) => response.blob())
            .then(resolve, () => resolve(null));
        });
      });
    setRemoteAssetFetcher(fetchAsset);
    this.releaseAssets = () => setRemoteAssetFetcher(null);
  }
}
