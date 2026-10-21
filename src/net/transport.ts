import type { HostCallbacks, LinkMode } from './host';
import type { RejectReason } from '../game/types';
import type { Signal } from './signal';

/** Both transports feed the same authoritative game and binary protocol. */
export interface HostTransport {
  readonly cb: HostCallbacks;
  readonly signal?: Signal;
  start(): Promise<void>;
  close(): void;
  sendJson(cid: string, message: object): void;
  broadcastJson(message: object): void;
  broadcastFast(data: Uint8Array): void;
  linkOf(cid: string): LinkMode | undefined;
  drop(cid: string): void;
  kick(cid: string, reason: RejectReason): void;
}

export type HostTransportFactory = (room: string, callbacks: HostCallbacks) => HostTransport;
