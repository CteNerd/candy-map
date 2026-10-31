import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CandyMapStack } from "../lib/candy-map-stack";

function synthesize() {
  const app = new cdk.App();
  const stack = new CandyMapStack(app, "TestStack", {
    allowedOrigin: "https://example.com",
    env: { account: "123456789012", region: "us-east-1" },
  });
  return Template.fromStack(stack);
}

describe("CandyMapStack", () => {
  it("creates a single DynamoDB table with pk/sk and a gsi1 index", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "gsi1",
          KeySchema: [
            { AttributeName: "gsi1pk", KeyType: "HASH" },
            { AttributeName: "gsi1sk", KeyType: "RANGE" },
          ],
        },
      ],
    });
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
  });

  it("creates exactly two Lambda functions for the Milestone 2 public read path", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  it("creates an HTTP API with GET /neighborhoods and GET /neighborhoods/{id}/houses routes", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /neighborhoods",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /neighborhoods/{id}/houses",
    });
  });

  it("scopes IAM policies to the specific DynamoDB actions each function needs", () => {
    const template = synthesize();
    const policies = template.findResources("AWS::IAM::Policy");
    const actions = Object.values(policies).flatMap((policy) => {
      const statements = (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[] }> } } })
        .Properties.PolicyDocument.Statement;
      return statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
    });

    expect(actions).toContain("dynamodb:Scan");
    expect(actions).toContain("dynamodb:Query");
    expect(actions).toContain("dynamodb:GetItem");
    // Nothing in this stack should be granted blanket write access on this read-only milestone.
    expect(actions).not.toContain("dynamodb:PutItem");
    expect(actions).not.toContain("dynamodb:DeleteItem");
  });
});
