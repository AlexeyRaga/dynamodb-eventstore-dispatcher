"use strict";

import { Kafka, Mechanism, Producer, ProducerRecord, SASLOptions } from "kafkajs";
import { Logger } from "@aws-lambda-powertools/logger";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBStreamEvent } from "aws-lambda";
import { AttributeValue, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import * as _ from "lodash"

import { Options } from "./options"

import * as EventStore from "./eventstore"
import { Key, EventRecord } from "./eventstore"

export const handler = (options: Options) => async (event: DynamoDBStreamEvent, context) => {
  const uniqIds = (keys: Key[]) => Array.from(new Set(keys.map(x => x.id)));

  const [changeKeys, recordKeys] = _.chain(event.Records)
    .map(x => unmarshall(x.dynamodb.Keys as Record<string, AttributeValue>) as Key)
    .partition(x => x.version === -1001) // these represent "changes" - keys that were updated.
    .value()
    .map(uniqIds)

  await EventStore.registerChanges(options.EVENTS_TABLE_NAME, recordKeys);
  await dispatchAll(options.EVENTS_TABLE_NAME, options.OFFSETS_TABLE_NAME, changeKeys);
}

async function dispatchAll(eventsTableName: string, offsetsTableName: string, keys: string[]): Promise<void> {
  const offsets = await EventStore.queryOffsets(offsetsTableName, keys);

  const allDispatches: Promise<void>[] =
    keys
      .map(x => offsets[x] || { id: x, version: 0 })
      .map(x => dispatchEventsFor(eventsTableName, offsetsTableName, x));

  await Promise.all(allDispatches);
}

async function dispatchEventsFor(eventsTableName: string, offsetsTableName: string, lastCommitted: Key) {
  EventStore.processEvents(eventsTableName, lastCommitted, async (events) => {
    const lastVersion = events[events.length - 1].version;

    events.forEach(console.log);

    const offset = { ...lastCommitted, version: lastVersion };
    await EventStore.commitOffset(offsetsTableName, offset);
  });
}

