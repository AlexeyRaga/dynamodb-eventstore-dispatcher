"use strict";

import { unmarshall } from "@aws-sdk/util-dynamodb";
import { BatchGetItemCommand, BatchWriteItemCommand, DynamoDBClient, QueryCommand, QueryCommandInput, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import * as _ from "lodash"
import { Options } from "./options";

export interface EventStoreEnv {
  readonly client: DynamoDBClient;
  readonly eventsTableName: string;
  readonly offsetsTableName: string;
}

export interface EventRecord {
  readonly id: string;
  readonly version: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly streamId: string;
  readonly streamType: string;
  readonly timestamp: number;
  readonly headers: Record<string, string>;
  readonly data: Uint8Array;
}

export interface Key {
  readonly id: string;
  readonly version: number;
}

export function createEventStoreEnv(options: Options): EventStoreEnv {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL,
  });

  return {
    client: client,
    eventsTableName: options.EVENTS_TABLE_NAME,
    offsetsTableName: options.OFFSETS_TABLE_NAME
  }
}

export async function queryOffsets(env: EventStoreEnv, keyValues: readonly string[]): Promise<Record<string, Key>> {
  const keys = keyValues.map(k => ({ id: { S: k } }));
  const request = {
    RequestItems: {
      [env.offsetsTableName]: { Keys: keys, ProjectionExpression: 'id, version' },
    }
  };

  const result = await env.client.send(new BatchGetItemCommand(request));

  return _.chain(result.Responses)
    .get(env.offsetsTableName, [])
    .map(x => unmarshall(x) as Key)
    .keyBy(x => x.id)
    .value();
}

export async function commitOffset(env: EventStoreEnv, offset: Key): Promise<void> {
  const params = {
    TableName: env.offsetsTableName,
    Key: { "id": { S: offset.id } },
    UpdateExpression: "set version = :version",
    ExpressionAttributeValues: { ":version": { N: offset.version.toString() } }
  };

  await env.client.send(new UpdateItemCommand(params));
}

export async function registerChanges(env: EventStoreEnv, keys: readonly string[]) {
  if (!keys || keys.length === 0) return;
  const putRequests = keys.map(k => ({
    PutRequest: {
      Item: { id: { S: k }, version: { N: "-1001" } }
    }
  }));

  const params = { RequestItems: { [env.eventsTableName]: putRequests } };
  const command = new BatchWriteItemCommand(params);
  await env.client.send(command);
}

export async function processEvents(
  env: EventStoreEnv,
  after: Key,
  handleBatch: (batch: readonly EventRecord[]) => Promise<void>): Promise<void> {
  const eventsQuery = {
    TableName: env.eventsTableName,
    KeyConditionExpression: "id = :id and version > :version",
    ExpressionAttributeValues: {
      ":id": { S: after.id },
      ":version": { N: after.version.toString() }
    }
  };

  await paginate<EventRecord>(env.client, eventsQuery, async (events): Promise<void> => {
    if (events.length === 0) return;
    await handleBatch(events);
  });
}

async function paginate<T>(
  client: DynamoDBClient,
  params: QueryCommandInput,
  processPage: (page: readonly T[]) => Promise<void>): Promise<void> {

  // eslint-disable-next-line functional/no-let
  let lastEvaluatedKey = undefined;

  // eslint-disable-next-line functional/no-loop-statements
  do {
    const command = new QueryCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey });
    const response = await client.send(command);

    const items = (response.Items || []).map(x => unmarshall(x) as T)

    await processPage(items);

    // eslint-disable-next-line functional/no-expression-statements
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}
