with import <nixpkgs> {};

mkShell {

  shellHook = ''
    export HOSTED_REGION=ap-southeast-2
    export SCHEMA_REGISTRY_URL=http://localhost:8081
    export KAFKA_BOOTSTRAP_SERVERS=localhost:9092
    export KAFKA_CLIENT_ID="$USER-webhooks"
    export KAFKA_TOPIC_OUTPUT="webhooks-events"
    export SASL_SECRET_NAME="none"
    '';

  buildInputs = [
    terraform
    yarn
    nodejs-18_x
  ];

}
