"use strict";

import { getValueFromEnvVar } from "./parameters"

export interface Options {
  readonly KAFKA_BOOTSTRAP_SERVERS: readonly string[];
  readonly KAFKA_CLIENT_ID: string;
  readonly KAFKA_TOPIC_OUTPUT: string;
  readonly SASL_SECRET_NAME?: string;
  readonly EVENTS_TABLE_NAME: string;
  readonly OFFSETS_TABLE_NAME: string;
}

export async function loadOptions(): Promise<Options> {
  const brokers = await getValueFromEnvVar('KAFKA_BOOTSTRAP_SERVERS');

  return {
    KAFKA_BOOTSTRAP_SERVERS: brokers?.split(",").map((x) => x.trim()),
    KAFKA_CLIENT_ID: await getValueFromEnvVar('KAFKA_CLIENT_ID'),
    KAFKA_TOPIC_OUTPUT: await getValueFromEnvVar('KAFKA_TOPIC_OUTPUT'),
    SASL_SECRET_NAME: await getValueFromEnvVar('SASL_SECRET_NAME'),
    EVENTS_TABLE_NAME: await getValueFromEnvVar('EVENTS_TABLE_NAME'),
    OFFSETS_TABLE_NAME: await getValueFromEnvVar('OFFSETS_TABLE_NAME'),
  };
}
