"use strict";

import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const secretsClient: SecretsManagerClient = new SecretsManagerClient({});
const ssmClient = new SSMClient({});

export async function getValueFromEnvVar(envVarName: string): Promise<string | undefined> {
  const value = process.env[envVarName];

  if (!value) { return undefined; }

  const ssmParamArnRegex = /^arn:aws:ssm:[a-z0-9-]+:\d{12}:parameter\/(.+)$/;
  const secretsManagerArnRegex = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/;

  if (ssmParamArnRegex.test(value)) {
    const paramName = ssmParamArnRegex.exec(value)![1];
    const response = await ssmClient.send(new GetParameterCommand({ Name: paramName }));
    return response.Parameter?.Value;
  } else if (secretsManagerArnRegex.test(value)) {
    const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: value }));
    return response.SecretString;
  }

  return value;
}
