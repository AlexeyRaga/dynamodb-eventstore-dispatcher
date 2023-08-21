# ddb-eventstore-dispatcher

The **ddb-eventstore-dispatcher** project provides an AWS Lambda function designed to address event order preservation
challenges when dispatching events from a DynamoDB-based event store into Kafka. This solution ensures that events
maintain their intended order per aggregate, a critical aspect often undermined by the intricacies of DynamoDB streams.

## Problem Statement

When utilizing DynamoDB streams with an aggregate ID as the partition key and event version as the sort key, the
inherent distribution of events across sibling shards can lead to out-of-order event handling. Even though events are
written sequentially, they may end up in different shards, causing potential disruptions to the intended chronological
sequence of events for a given aggregate.

## Solution Overview

The **ddb-eventstore-dispatcher** resolves this issue by introducing an approach to event dispatching that hinges
on the Lambda architecture via changes tracking.

1. **Changes Tracking**: For each batch of events triggered by the DynamoDB stream, the Lambda function identifies the
   aggregate IDs that have been updated. Subsequently, a "change" record is written for each of these aggregates. The
   "change" record has the same partition key (aggregate ID) but carries a special fixed version number (-1001). While
   the original event versions are incrementing (starting from 0), the version number for these "change"
   record remains fixed.

2. **Enforcing Order**: By enforcing a consistent version (-1001) for the "change" records, the Lambda function
   guarantees that all "change" events in dynamodb stream for a particular aggregate will be directed to a single
   sibling shard. This ensures that there is no concurrency issues when dispatching events for multiple aggregates in
   parallel.

3. **Event Dispatch and Offset Tracking**: When the dispatcher Lambda encounters a "change" event from the dynamodb
   stream, it identifies the aggregate it pertains to and retrieves the events for that aggregate from the DynamoDB
   event store. It starts reading events from the last dispatched event's version for that aggregate (referred to as the
   "offset"). These events are subsequently dispatched to Kafka, ensuring their intended chronological order. Once all
   events are dispatched, the offset is updated in the "offsets" table within DynamoDB.

## Diagram

```mermaidjs
sequenceDiagram
  participant Stream as DynamoDB Stream
  participant Handler as Lambda Handler
  participant Events as Events Table
  participant Offsets as Offsets Table
  participant Kafka as Kafka Topic

  Stream ->> Handler: handle(streamEvent[])
  note over Handler,Offsets: Actioned on unique event per aggregate

  alt Got change marker {aggregateId, version: -1001}
    Handler ->> Offsets: readOffset(aggregateId)
    activate Offsets
    Offsets -->> Handler: offset
    deactivate Offsets

    Handler ->> Events: readEventsSince(offset)
    activate Events
    Events -->> Handler: events
    deactivate Events

    Handler ->> Kafka: publish(events)

  else Got regular {aggregateId, version}
    Handler ->> Events: write(aggregateId, version: -1001)
  end
```

## EventStore table in DynamoDB

```javascript
{
  "id": "S",          // partition Key, usually 'streamType:streamId'
  "streamType": "S",  // usually an aggregate type
  "streamId": "S",    // usually an aggregate ID, usually UUID
  "eventId": "S",     // unique event ID (usually UUID)
  "version": "N",     // event number for a
  "data": "B",        // event payload, serialised
  "timestamp": "N",   // a timestamp when the event occured
  "eventType": "S",   // type of the event
  "headers":          // a list of headers
  {
    "M":
    {
        // what caused the event, usually UUID for a command or another event
        "causationId": "S",

        // a.k.a 'correlationId'
        "conversationId": "S"
    }
  },
}
```

## How to Use

To effectively utilize the **ddb-eventstore-dispatcher** Lambda function, ensure that you configure the following
environment variables appropriately in your AWS environment. These environment variables play a crucial role in enabling
seamless event dispatching from a DynamoDB-based event store to Kafka while maintaining order and integrity.

1. **KAFKA_BOOTSTRAP_SERVERS**: Set this variable to a comma-separated list of Kafka brokers. Each broker's address
   should be provided, separated by commas. For example:

    ```
    KAFKA_BOOTSTRAP_SERVERS = broker1.example.com:9092,broker2.example.com:9092
    ```

2. **KAFKA_CLIENT_ID**: This variable should be set to a unique identifier for the Kafka client that interacts with the
   brokers. You can provide a value that represents your application or purpose.

3. **KAFKA_TOPIC_OUTPUT**: Specify the Kafka topic to which the generated events will be dispatched. This topic should
   be configured to receive the events from the Lambda function.

4. **SASL_SECRET_NAME**: Set this variable to the name of the Secret in AWS Secrets Manager that contains the SASL
   credentials required for authentication with Kafka. The Lambda function will retrieve these credentials from the
   specified Secret.

5. **EVENTS_TABLE_NAME**: Provide the name of the DynamoDB table where your events are stored. The Lambda function will
   read events from this table for dispatching.

6. **OFFSETS_TABLE_NAME**: Specify the name of the DynamoDB table where offsets for event processing are tracked. This
   table will store the latest event offsets, ensuring event order and consistency.

Please note that the values of these environment variables should be configured according to your specific environment
and requirements. Ensure that your Lambda function has the necessary permissions to access the AWS Secrets Manager,
DynamoDB tables, and Kafka brokers.

Once you've correctly configured these environment variables, deploy the **ddb-eventstore-dispatcher** Lambda function
and associate it with the appropriate DynamoDB stream for event triggering. The Lambda function will automatically
generate "change" events, dispatch them to the specified Kafka topic, and maintain event offsets in the designated
DynamoDB offsets table.

Feel free to modify and adapt the Lambda function's behavior to best fit your use case while leveraging the provided
environment variables for configuration.

### Example Lambda Configuration

Here's an example of how you might set the environment variables when configuring the Lambda function using the AWS
Management Console:

- **KAFKA_BOOTSTRAP_SERVERS**: broker1.example.com:9092,broker2.example.com:9092
- **KAFKA_CLIENT_ID**: YourAppEventDispatcher
- **KAFKA_TOPIC_OUTPUT**: YourKafkaTopic
- **SASL_SECRET_NAME**: YourKafkaCredentialsSecret
- **EVENTS_TABLE_NAME**: YourEventsTable
- **OFFSETS_TABLE_NAME**: YourOffsetsTable

These environment variables will allow the Lambda function to interact with your Kafka cluster and DynamoDB tables
effectively.

Remember to secure your environment variables and credentials to ensure the privacy and security of your application's
data and interactions.

