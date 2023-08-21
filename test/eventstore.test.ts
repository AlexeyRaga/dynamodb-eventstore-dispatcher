"use strict";

import * as EventStore from "../src/eventstore"
import * as _ from "lodash"
import fc from 'fast-check';

import { ensureNewStreamId, writeEventsToDynamoDb } from './helpers'
import * as Fixture from "./fixture"
import * as Gen from "./generators"

describe('Eventstore tests', () => {
  /* eslint-disable functional/no-let */
  let fixture: Fixture.Fixture;

  beforeAll(async () => {
    fc.configureGlobal({ numRuns: 10 });
    fixture = await Fixture.createFixture();
    console.log(fixture.fixtureId);
  });

  afterAll(async () => {
    fc.resetConfigureGlobal();
    fixture.eventStore.client.destroy();
    await fixture.kafka.producer.disconnect();
  });

  it('should persist offset and retrieve it', async () => {
    await fc.assert(
      fc.asyncProperty(Gen.key, async key => {
        await EventStore.commitOffset(fixture.eventStore, key);
        const offsets = await EventStore.queryOffsets(fixture.eventStore, [key.id]);
        expect(offsets).toEqual({ [key.id]: key });
      })
    );
  });

  it('should register changes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.uuid(), { maxLength: 5 }), async (keys) => {
        await EventStore.registerChanges(fixture.eventStore, keys);
      })
    );
  });

  it('should process no events for IDs that have no events', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (id) => {
        const handleBatchCallback = jest.fn(async (batch) => expect(batch).toHaveLength(0));
        await EventStore.processEvents(fixture.eventStore, { id: id, version: 0 }, handleBatchCallback);
        expect(handleBatchCallback).toHaveBeenCalledTimes(0);
      })
    );
  });

  it('should process all events where events exist', async () => {
    await fc.assert(
      fc.asyncProperty(Gen.events({ minLength: 1, maxLength: 5 }), async (evts) => {
        const events = ensureNewStreamId(evts);
        const handleBatchCallback = jest.fn(async (batch) => expect(batch).toHaveLength(events.length));
        await writeEventsToDynamoDb(fixture.eventStore, events);

        const key = { id: events[0].id, version: 0 };
        await EventStore.processEvents(fixture.eventStore, key, handleBatchCallback);
        expect(handleBatchCallback).toHaveBeenCalledTimes(1);
      })
    );
  });

  it('should process events only after specified version', async () => {
    await fc.assert(
      fc.asyncProperty(Gen.events({ minLength: 3, maxLength: 7 }), fc.nat({ max: 3 }), async (evts, lastCommitted) => {
        const events = ensureNewStreamId(evts);
        const expected = _.drop(events, lastCommitted);
        const handleBatchCallback = jest.fn(async (batch) => expect(batch).toEqual(expected));

        await writeEventsToDynamoDb(fixture.eventStore, events);

        const key = { id: events[0].id, version: lastCommitted };
        await EventStore.processEvents(fixture.eventStore, key, handleBatchCallback);
        expect(handleBatchCallback).toHaveBeenCalledTimes(expected.length === 0 ? 0 : 1);
      })
    );
  });

});

