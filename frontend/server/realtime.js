import { EventEmitter } from 'events';

export const realtimeEvents = new EventEmitter();

export function emitDataChanged(source = 'server') {
  realtimeEvents.emit('data_changed', { source, timestamp: new Date().toISOString() });
}
