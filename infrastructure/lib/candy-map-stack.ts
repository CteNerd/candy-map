import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";

const API_HANDLERS_DIR = path.join(__dirname, "..", "..", "services", "api", "src", "handlers");

export interface CandyMapStackProps extends cdk.StackProps {
  /** CORS origin allowed to call the public API. Defaults to "*" for the POC — restrict for prod. */
  allowedOrigin: string;
}

export class CandyMapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CandyMapStackProps) {
    super(scope, id, props);

    // --- Data store -------------------------------------------------------
    // Single-table design — see services/api/src/lib/table.ts for the full key schema.
    const table = new dynamodb.Table(this, "CandyMapTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY, // POC only — switch to RETAIN before real data exists.
    });
    table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    // --- Lambda functions (public read path — Milestone 2) ----------------
    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      ALLOWED_ORIGIN: props.allowedOrigin,
    };

    const bundling: nodejs.BundlingOptions = {
      format: nodejs.OutputFormat.ESM,
      target: "node22",
      // Keep the AWS SDK pinned to our package.json version rather than whatever the Lambda
      // runtime happens to ship, for reproducible builds.
      externalModules: [],
    };

    const getNeighborhoodsFn = new nodejs.NodejsFunction(this, "GetNeighborhoodsFn", {
      entry: path.join(API_HANDLERS_DIR, "getNeighborhoods.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: commonEnvironment,
      bundling,
    });

    const getNeighborhoodHousesFn = new nodejs.NodejsFunction(this, "GetNeighborhoodHousesFn", {
      entry: path.join(API_HANDLERS_DIR, "getNeighborhoodHouses.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: commonEnvironment,
      bundling,
    });

    // Least-privilege: each function only gets the DynamoDB actions it actually performs.
    table.grant(getNeighborhoodsFn, "dynamodb:Scan");
    table.grant(getNeighborhoodHousesFn, "dynamodb:Query", "dynamodb:GetItem");

    // --- Public HTTP API ----------------------------------------------------
    const httpApi = new apigw.HttpApi(this, "CandyMapHttpApi", {
      description: "Candy Map public API",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PATCH],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    httpApi.addRoutes({
      path: "/neighborhoods",
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("GetNeighborhoodsIntegration", getNeighborhoodsFn),
    });

    httpApi.addRoutes({
      path: "/neighborhoods/{id}/houses",
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "GetNeighborhoodHousesIntegration",
        getNeighborhoodHousesFn,
      ),
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
  }
}
