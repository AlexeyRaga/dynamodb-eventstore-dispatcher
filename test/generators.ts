"use strict";

import * as EventStore from "../src/eventstore"
import fc from 'fast-check';
import { v4 as uuid } from 'uuid';

export const key: fc.Arbitrary<EventStore.Key> = fc.record({ id: fc.uuid().noShrink(), version: fc.nat() });

export function event(key: AggregateKey, version: number): fc.Arbitrary<EventStore.EventRecord> {
  return fc.record({
    id: fc.constant(`${key.type}:${key.id}`),
    version: fc.constant(version),
    eventId: fc.uuid().noShrink(),
    eventType: fc.string({ maxLength: 50 }),
    streamId: fc.constant(key.id),
    streamType: fc.constant(key.type),
    timestamp: fc.nat(),
    data: fc.uint8Array({ maxLength: 256 }),
    headers: fc.object({ key: fc.string({ minLength: 1 }), values: [fc.string()], maxDepth: 0 }).map(x => x as Record<string, string>),
  });
}

export interface AggregateKey {
  readonly id: string;
  readonly type: string;
}

export function aggregateKey(id?: string): fc.Arbitrary<AggregateKey> {
  return fc.record({
    id: id ? fc.constant(id) : fc.uuid().noShrink(),
    type: fc.string({ minLength: 1, maxLength: 25 })
  }).noShrink();
}

export interface EventsArrayConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly startVersion?: number;
  readonly aggregateKey?: AggregateKey;
}

export function events(constraints?: EventsArrayConstraints): fc.Arbitrary<readonly EventStore.EventRecord[]> {
  const minLength = constraints?.minLength ?? 10;
  const maxLength = constraints?.maxLength ?? 10;
  const startVersion = constraints?.startVersion ?? 1;
  const aggKey = constraints?.aggregateKey
    ? fc.constant(constraints?.aggregateKey)
    : aggregateKey(uuid());

  return aggKey
    .chain((key) => fc.array(event(key, 0), { minLength: minLength, maxLength: maxLength }))
    .map(xs => xs.map((x, i) => ({ ...x, version: startVersion + i })));
}
