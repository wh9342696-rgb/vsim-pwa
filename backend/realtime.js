import { EventEmitter } from 'events';

export const realtimeEvents = new EventEmitter();

export function emitDataChanged(source = 'server', details = {}) {
  realtimeEvents.emit('data_changed', { source, ...details, timestamp: new Date().toISOString() });
}
