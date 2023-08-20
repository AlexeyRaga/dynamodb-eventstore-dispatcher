"use strict";

import * as _ from "lodash"

import { loadOptions } from "./options"
import { handler } from "./handler"

(async () => {
  const options = await loadOptions();
  exports.handler = handler(options);
})();

