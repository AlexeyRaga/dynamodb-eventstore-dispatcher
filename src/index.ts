"use strict";

import { Options, loadOptions } from "./options"
import { Env, createHandler } from "./handler"
import * as EventStore from "./eventstore"
import * as Kafka from "./kafka";

async function makeEnv(options: Options): Promise<Env> {
  const eventStore = EventStore.createEventStoreEnv(options);
  const kafka = await Kafka.createKafkaEnv(options);
  return {
    eventStore: eventStore,
    kafka: kafka
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
  const options = await loadOptions();
  const env = await makeEnv(options);

  // eslint-disable-next-line functional/immutable-data
  exports.handler = createHandler(env);
})();

