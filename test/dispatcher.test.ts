"use strict";

import * as EventStore from "../src/eventstore"
import * as _ from "lodash"
import fc from 'fast-check';
import * as UUID from 'uuid'

import { ensureNewStreamId, writeEventsToDynamoDb } from './helpers'
import * as Fixture from "./fixture"
import * as Gen from "./generators"
import * as Handler from "../src/handler"

import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { AttributeValue, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";

describe('Dispatcher tests', () => {
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

  it('should process all events for a simple scenario', async () => {
    const handler = await Handler.createHandler(fixture);

    await fc.assert(
      fc.asyncProperty(Gen.events({ minLength: 1, maxLength: 5 }), async (evts) => {
        const events = ensureNewStreamId(evts);

        // presume that an aggregate writes some events
        await writeEventsToDynamoDb(fixture.eventStore, events);

        // get notifications from the DDB stream to forward them to the lambda handler
        // we expect one DDB Stream record per written event
        const streamEvents = await fixture.getAllStreamRecords();
        expect(streamEvents).toHaveLength(events.length);

        // invoke the lambda handler to assess behaviour
        await handler({ Records: [...streamEvents] });

        // we should get one DDB Stream record per aggregate that signifies a change
        const receivedEvents = await fixture.getAllStreamRecords();
        const receivedKeys = receivedEvents.map(x => unmarshall(x.dynamodb.NewImage as Record<string, AttributeValue>) as EventStore.Key);

        // one aggregate ID has been updated, so one record is expected
        // the change record should have an expected aggregate ID
        // and a version set to a specific number "-1001"
        expect(receivedKeys).toHaveLength(1);
        expect(receivedKeys[0].id).toEqual(events[0].id);
        expect(receivedKeys[0].version).toEqual(-1001);

        // the change record is delivered to the lambda handler
        // this should trigger all the new events for that aggregate to be dispatched
        // and the offsets to be committed
        await handler({ Records: [...receivedEvents] });

        // check if the offsets were committed
        const allOffsets = await EventStore.queryOffsets(fixture.eventStore, receivedKeys.map(x => x.id));
        const offset = allOffsets[receivedKeys[0].id];
        expect(offset).toEqual({ id: receivedKeys[0].id, version: evts.length });
      })
    );
  });
});
