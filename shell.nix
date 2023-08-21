with import <nixpkgs> {};

mkShell {

  shellHook = ''
    export AWS_REGION=ap-southeast-2
    export AWS_ENDPOINT_URL=http://localhost:8000

    export AWS_ACCESS_KEY_ID=test
    export AWS_SECRET_ACCESS_KEY=test

    export SCHEMA_REGISTRY_URL=http://localhost:8081
    export KAFKA_BOOTSTRAP_SERVERS=localhost:9092
    export KAFKA_CLIENT_ID="$USER-webhooks"
    export KAFKA_TOPIC_OUTPUT="webhooks-events"
    export SASL_SECRET_NAME="none"

    export KAFKAJS_NO_PARTITIONER_WARNING=1
    '';

  buildInputs = [
    terraform
    yarn
    nodejs-18_x
  ];

}
