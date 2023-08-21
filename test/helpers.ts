"use strict";

import * as EventStore from "../src/eventstore"
import * as _ from "lodash"
import * as UUID from 'uuid'
import { BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";


/*
 * A helper function to rewrite generated events stream IDs to a new truly random one.
 * It needs to be done because when the test fails, during te shrinking process
 * previously generated IDs will be re-used. But it doesn't work because we will already have
 * events for these IDs in DynamoDB.
 * Setting IDs to be new every time, even when shrinking, helps.
 */
export function ensureNewStreamId(events: readonly EventStore.EventRecord[]): readonly EventStore.EventRecord[] {
  const streamId = UUID.v4();
  return events.map(x => ({ ...x, streamId, id: `${x.streamType}:${streamId}` }));
}

export async function writeEventsToDynamoDb(env: EventStore.EventStoreEnv, events: readonly EventStore.EventRecord[]): Promise<void> {
  const params = {
    RequestItems: {
      [env.eventsTableName]: events.map(x => ({ PutRequest: { Item: marshall(x) } }))
    }
  };
  const command = new BatchWriteItemCommand(params);
  await env.client.send(command);
}
