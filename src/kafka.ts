"use strict";

import { Kafka, Mechanism, Message, Producer, ProducerRecord, RecordMetadata, SASLOptions } from "kafkajs";
import { Options } from "./options";

export interface KafkaEnv {
  readonly producer: Producer;
  readonly outputTopicName: string;
}

export async function createKafkaEnv(options: Options): Promise<KafkaEnv> {
  const producer = await createKafkaProducer(options);
  return {
    producer: producer,
    outputTopicName: options.KAFKA_TOPIC_OUTPUT
  }
}

async function createKafkaProducer(options: Options): Promise<Producer> {
  const params = {
    clientId: options.KAFKA_CLIENT_ID,
    brokers: [...options.KAFKA_BOOTSTRAP_SERVERS]
  }

  const sasl = options.SASL_SECRET_NAME
    ? {
      ssl: true,
      sasl: {
        mechanism: "SCRAM-SHA-512",
        username: options.SASL_SECRET_NAME,
        password: options.SASL_SECRET_NAME,
      } as SASLOptions | Mechanism
    }
    : {};

  const kafka = new Kafka({ ...sasl, ...params });

  const producer: Producer = kafka.producer();
  await producer.connect();

  return producer;
}

export async function publish(env: KafkaEnv, messages: readonly Message[]): Promise<readonly RecordMetadata[]> {
  const record: ProducerRecord = {
    topic: env.outputTopicName,
    messages: [...messages]
  };
  return await env.producer.send(record);
}
