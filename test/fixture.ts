"use strict";

import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DescribeStreamCommand, GetRecordsCommand, GetRecordsCommandOutput, GetShardIteratorCommand, Shard, ShardIteratorType, _Record } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBRecord } from "aws-lambda";

import * as UUID from 'uuid'

import { Options } from "../src/options";
import * as EventStore from "../src/eventstore";
import * as Kafka from "../src/kafka";

import * as _ from "lodash"
import { Env } from "../src/handler";

// eslint-disable-next-line functional/no-mixed-types
export interface Fixture extends Env {
  readonly fixtureId: string;
  readonly eventStore: EventStore.EventStoreEnv;
  readonly kafka: Kafka.KafkaEnv;

  readonly getAllStreamRecords: () => Promise<readonly DynamoDBRecord[]>
}

interface ShardPosition {
  readonly shard: Shard;
  readonly nextIterator: string;
}

interface StreamRecords {
  readonly position: ShardPosition;
  readonly records: readonly DynamoDBRecord[]
}

export async function createFixture(): Promise<Fixture> {
  const id = UUID.v4();

  const options: Options = {
    EVENTS_TABLE_NAME: `events-${id}`,
    OFFSETS_TABLE_NAME: `offsets-${id}`,
    KAFKA_BOOTSTRAP_SERVERS: (process.env.KAFKA_BOOTSTRAP_SERVERS || "localhost:9092").split(",").map((x) => x.trim()),
    KAFKA_CLIENT_ID: `fixture-${id}`,
    KAFKA_TOPIC_OUTPUT: `events-${id}`,
  }

  const kafka = await Kafka.createKafkaEnv(options);
  const eventStore = await createEventStore(options);

  const streamArn = await getDynamoDbStreamArn(eventStore);
  const consumeStream = getDynamoDbStreamConsumer(eventStore, streamArn);

  return {
    fixtureId: id,
    eventStore: eventStore,
    kafka: kafka,
    getAllStreamRecords: consumeStream
  };
}

async function createEventsTable(client: DynamoDBClient, tableName: string) {
  const params = {
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'version', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'version', AttributeType: 'N' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 500,
      WriteCapacityUnits: 500,
    },
    StreamSpecification: {
      StreamEnabled: true,
      StreamViewType: 'NEW_IMAGE', // Choose the desired stream view type
    },
  };

  const command = new CreateTableCommand(params);
  await client.send(command);
}

async function createOffsetsTable(client: DynamoDBClient, tableName: string) {
  const params = {
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 500,
      WriteCapacityUnits: 500,
    },
  };

  const command = new CreateTableCommand(params);
  await client.send(command);
}

async function createEventStore(options: Options): Promise<EventStore.EventStoreEnv> {
  const env = EventStore.createEventStoreEnv(options);

  await createEventsTable(env.client, env.eventsTableName);
  await createOffsetsTable(env.client, env.offsetsTableName);

  return env;
}

/**
 * Retrieves the DynamoDB stream ARN for the given EventStore environment.
 *
 * @param {EventStore.EventStoreEnv} env - The EventStore environment.
 * @return {Promise<string>} - The ARN of the latest stream associated with the DynamoDB table.
 */
async function getDynamoDbStreamArn(env: EventStore.EventStoreEnv): Promise<string> {
  const table = await env.client.send(new DescribeTableCommand({ TableName: env.eventsTableName }));
  return table.Table?.LatestStreamArn;
}

/**
 * Returns a function that consumes all the available records from the DynamoDB stream and returns them.
 * Each call to the function will return the next batch of records which became available since the last call.
 *
 * @param {EventStore.EventStoreEnv} env - The event store environment.
 * @param {string} streamArn - The ARN of the DynamoDB stream.
 * @return {Function} - The function that consumes the stream and returns the records.
 */
function getDynamoDbStreamConsumer(env: EventStore.EventStoreEnv, streamArn: string) {
  // eslint-disable-next-line functional/no-let
  let lastPosition: ShardPosition = undefined;

  return async () => {
    const position = await getNextPosition(env, streamArn, lastPosition);
    const result = await consumeShardIterator(env.client, position.shard, position.nextIterator);
    lastPosition = result.position;
    return result.records;
  }
}

/**
 * Retrieves the next position in the stream to consume.
 * WARNING: This is a part of testing code. This function assumes that there is only one sibling shard in the stream.
 *
 * @param {EventStore.EventStoreEnv} env - The environment for the event store.
 * @param {string} streamArn - The Amazon Resource Name (ARN) of the stream.
 * @param {ShardPosition} last - The last known position in the stream.
 * @return {Promise<ShardPosition>} - A promise that resolves to the next position in the stream.
 */
async function getNextPosition(env: EventStore.EventStoreEnv, streamArn: string, last: ShardPosition): Promise<ShardPosition> {
  if (last?.nextIterator) return last;

  const stream = await env.client.send(new DescribeStreamCommand({ StreamArn: streamArn, ExclusiveStartShardId: last?.shard.ShardId }));
  const shard = _.first(stream.StreamDescription.Shards || []);
  const shardIterator = await env.client.send(new GetShardIteratorCommand({ ShardId: shard.ShardId, ShardIteratorType: ShardIteratorType.TRIM_HORIZON, StreamArn: streamArn }));
  return { shard, nextIterator: shardIterator.ShardIterator }
}

/**
 * Consumes a shard iterator to retrieve all the available stream records.
 * The next iterator in StreamPosition may or may not be empty.
 *
 * @param {DynamoDBClient} client - The DynamoDB client to use for API calls.
 * @param {Shard} shard - The shard object representing the shard to consume.
 * @param {string} iterator - The shard iterator to consume.
 * @return {Promise<StreamRecords>} A promise that resolves to an object containing the position and records.
 */
async function consumeShardIterator(client: DynamoDBClient, shard: Shard, iterator: string): Promise<StreamRecords> {
  async function step(last: GetRecordsCommandOutput | undefined) {
    const iter = last?.NextShardIterator || iterator;
    const stepResult = await client.send(new GetRecordsCommand({ ShardIterator: iter }));
    return (stepResult.Records.length == 0) ? undefined : stepResult;
  }

  const results = await unfold<GetRecordsCommandOutput>(step);
  const records = _.flatMap(results, x => x.Records.map(x => x as unknown as DynamoDBRecord));
  const nextIterator = _.last(results)?.NextShardIterator;
  return {
    position: {
      shard,
      nextIterator
    },
    records
  };
}

/**
 * Unfolds the values returned by the given step until the step produces a defined value.
 * Returns an array of those values.
 *
 * @param {function} step - A function that takes the last value as input and returns the next value,
 *                          or undefined if there are no more values.
 * @returns {Promise<readonly T[]>} - A promise that resolves to an array of values returned by the step function.
 */
async function unfold<T>(step: (last: T | undefined) => Promise<T> | undefined): Promise<readonly T[]> {
  // eslint-disable-next-line functional/no-let
  let last = undefined;
  const results = []

  // eslint-disable-next-line functional/no-loop-statements,no-constant-condition
  while (true) {
    last = await step(last);
    if (last === undefined) return results;
    // eslint-disable-next-line functional/immutable-data
    results.push(last);
  }
}
