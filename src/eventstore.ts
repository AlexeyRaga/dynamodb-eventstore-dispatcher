"use strict";

import { unmarshall } from "@aws-sdk/util-dynamodb";
import { BatchGetItemCommand, BatchWriteItemCommand, DynamoDBClient, QueryCommand, QueryCommandInput, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import * as _ from "lodash"


const ddbClient = new DynamoDBClient({});

export interface EventRecord {
  id: string;
  version: number;
  eventId: string;
  eventType: string;
  streamId: string;
  streamType: string;
  timestamp: number;
  // headers: AttributeValue[]
  data: Uint8Array;
}

export interface Key {
  id: string;
  version: number;
}

export async function queryOffsets(offsetsTableName: string, keyValues: string[]): Promise<Record<string, Key>> {
  const keys = keyValues.map(k => ({ id: { S: k } }));
  const request = {
    RequestItems: {
      [offsetsTableName]: { Keys: keys, ProjectionExpression: 'id, version' },
    }
  };

  const command = new BatchGetItemCommand(request);
  const result = await ddbClient.send(command);

  const offsets = _.chain(result.Responses)
    .get(offsetsTableName, [])
    .map(x => unmarshall(x) as Key)
    .keyBy(x => x.id)
    .value();

  return offsets;
}

export async function commitOffset(offsetsTableName: string, offset: Key) {
  const params = {
    TableName: offsetsTableName,
    Key: { "id": { S: offset.id } },
    UpdateExpression: "set version = :version",
    ExpressionAttributeValues: { ":version": { N: offset.version.toString() } }
  };

  await ddbClient.send(new UpdateItemCommand(params));
}

export async function registerChanges(eventsTableName: string, keys: string[]) {
  const putRequests = keys.map(k => ({
    PutRequest: {
      Item: { id: { S: k }, version: { N: "-1001" } }
    }
  }));

  const params = { RequestItems: { [eventsTableName]: putRequests } };
  const command = new BatchWriteItemCommand(params);
  await ddbClient.send(command);
}

export async function processEvents(
  eventsTableName: string,
  after: Key,
  handleBatch: (batch: EventRecord[]) => Promise<void>): Promise<void> {
  const eventsQuery = {
    TableName: eventsTableName,
    KeyConditionExpression: "id = :streamId and version > :version",
    ExpressionAttributeValues: {
      ":streamId": { S: after.id },
      ":version": { N: after.version.toString() }
    }
  };

  await paginate<EventRecord>(eventsQuery, async (events): Promise<void> => {
    if (events.length === 0) return;
    handleBatch(events);
  });
}

async function paginate<T>(
  params: QueryCommandInput,
  processPage: (page: T[]) => Promise<void>): Promise<void> {
  let lastEvaluatedKey = undefined;

  do {
    const command = new QueryCommand({ ...params, ExclusiveStartKey: lastEvaluatedKey });
    const response = await ddbClient.send(command);

    const items = (response.Items || []).map(x => unmarshall(x) as T)

    await processPage(items);

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}
