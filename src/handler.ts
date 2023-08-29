"use strict";

import { Message } from "kafkajs";
// import { Logger } from "@aws-lambda-powertools/logger";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBStreamEvent } from "aws-lambda";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import _ from "lodash";

import * as EventStore from "./eventstore"
import { Key } from "./eventstore"

import * as Kafka from "./kafka";

export interface Env {
  readonly eventStore: EventStore.EventStoreEnv;
  readonly kafka: Kafka.KafkaEnv;
}

export const createHandler = async (env: Env) => {
  return async (event: DynamoDBStreamEvent) => {
    const uniqIds = (keys: readonly Key[]) => Array.from(new Set(keys.map(x => x.id)));

    const [keysToDispatch, otherKeys] = _.chain(event.Records)
      .map(x => unmarshall(x.dynamodb.Keys as Record<string, AttributeValue>) as Key)
      .partition(x => x.version === -1001) // these represent "changes" - keys that were updated.
      .value()
      .map(uniqIds);

    // if there is a change key for a given aggregate, we'll dispatch all the events for it anyway,
    // no need to record changes again.
    const keysToRecordChanges = _.differenceBy(otherKeys, keysToDispatch);

    await EventStore.registerChanges(env.eventStore, keysToRecordChanges);
    await dispatchAll(env, keysToDispatch);
  }
}

async function dispatchAll(env: Env, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const offsets = await EventStore.queryOffsets(env.eventStore, keys);

  const allDispatches =
    keys
      .map(x => offsets[x] || { id: x, version: 0 })
      .map(x => dispatchEventsFor(env, x));

  await Promise.all(allDispatches);
}

function buildHeadersForDispatch(event: EventStore.EventRecord) {
  var headers = _.cloneDeepWith(event.headers, value => {
    return !_.isPlainObject(value) ? _.toString(value) : undefined;
  });

  var staticHeaders = {
    messageId: event.eventId.toString(),
    messageType: event.eventType.toString(),
    streamType: event.streamType.toString(),
    streamId: event.streamId.toString(),
    version: event.version.toString(),
    timestamp: event.timestamp.toString()
  }

  return { ...headers, ...staticHeaders };
}

async function dispatchEventsFor(env: Env, lastCommitted: Key): Promise<void> {
  return await EventStore.processEvents(env.eventStore, lastCommitted, async (events) => {
    const lastVersion = events[events.length - 1].version;

    const messages: readonly Message[] = events.map(x => ({
      key: x.streamId,
      value: Buffer.from(x.data),
      headers: buildHeadersForDispatch(x)
    }));

    await Kafka.publish(env.kafka, messages);

    const offset = { ...lastCommitted, version: lastVersion };
    await EventStore.commitOffset(env.eventStore, offset);
  });
}


