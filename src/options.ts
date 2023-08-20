"use strict";

import { getValueFromEnvVar } from "./parameters"

export class Options {
  KAFKA_BOOTSTRAP_SERVERS: string;
  KAFKA_CLIENT_ID: string;
  KAFKA_TOPIC_OUTPUT: string;
  SASL_SECRET_NAME: string;
  EVENTS_TABLE_NAME: string;
  OFFSETS_TABLE_NAME: string;
}

export async function loadOptions(): Promise<Options> {
  return {
    KAFKA_BOOTSTRAP_SERVERS: await getValueFromEnvVar('KAFKA_BOOTSTRAP_SERVERS'),
    KAFKA_CLIENT_ID: await getValueFromEnvVar('KAFKA_CLIENT_ID'),
    KAFKA_TOPIC_OUTPUT: await getValueFromEnvVar('KAFKA_TOPIC_OUTPUT'),
    SASL_SECRET_NAME: await getValueFromEnvVar('SASL_SECRET_NAME'),
    EVENTS_TABLE_NAME: await getValueFromEnvVar('EVENTS_TABLE_NAME'),
    OFFSETS_TABLE_NAME: await getValueFromEnvVar('OFFSETS_TABLE_NAME'),
  };
}
