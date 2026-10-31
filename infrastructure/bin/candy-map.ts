#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CandyMapStack } from "../lib/candy-map-stack";
import { HostingStack } from "../lib/hosting-stack";

const app = new cdk.App();

const allowedOrigin = app.node.tryGetContext("allowedOrigin") as string | undefined;
const cognitoDomainPrefix = app.node.tryGetContext("cognitoDomainPrefix") as string | undefined;

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
const synthesizer = () => new cdk.DefaultStackSynthesizer({
  qualifier: "candymap",
  fileAssetsBucketName: "candy-map-assets-${AWS::AccountId}-${AWS::Region}",
  fileAssetPublishingRoleArn: "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/candy-map/deployment/candy-map-cdk-deploy",
  deployRoleArn: "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/candy-map/deployment/candy-map-cdk-deploy",
  useLookupRoleForStackOperations: false,
  cloudFormationExecutionRole: "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/candy-map/deployment/candy-map-cloudformation",
});
const hosting = new HostingStack(app, "CandyMapHosting", { env, synthesizer: synthesizer() });

new CandyMapStack(app, "CandyMapStack", {
  description: "Candy Map POC: public map, neighborhood/house duplicate prevention APIs.",
  allowedOrigin: allowedOrigin ?? hosting.origin,
  cognitoDomainPrefix: cognitoDomainPrefix ?? `candy-map-${env.account}-${env.region}`,
  env,
  synthesizer: synthesizer(),
});
cdk.Tags.of(app).add("Project", "candy-map");
