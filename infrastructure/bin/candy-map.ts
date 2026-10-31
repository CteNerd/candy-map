#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CandyMapStack } from "../lib/candy-map-stack";

const app = new cdk.App();

const allowedOrigin = app.node.tryGetContext("allowedOrigin") as string | undefined;

new CandyMapStack(app, "CandyMapStack", {
  description: "Candy Map POC: public map, neighborhood/house duplicate prevention APIs.",
  allowedOrigin: allowedOrigin ?? "*",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
