import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CandyMapStack } from "../lib/candy-map-stack";

function synthesize() {
  const app = new cdk.App();
  const stack = new CandyMapStack(app, "TestStack", {
    allowedOrigin: "https://example.com",
    cognitoDomainPrefix: "candy-map-test",
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

  it("creates a Cognito user pool, client, and hosted-UI domain", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
    template.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["code"],
    });
  });

  it("creates one Lambda function per public + authenticated handler (8 total)", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::Lambda::Function", 8);
  });

  it("creates an HTTP API with the public and authenticated routes", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    const expectedRouteKeys = [
      "GET /neighborhoods",
      "GET /neighborhoods/{id}/houses",
      "POST /neighborhoods",
      "POST /houses/resolve",
      "POST /houses/claims",
      "PATCH /houses/{id}/candy",
      "GET /me/claims",
      "POST /admin/claims/{id}/approve",
    ];
    for (const routeKey of expectedRouteKeys) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: routeKey });
    }
    template.resourceCountIs("AWS::ApiGatewayV2::Route", expectedRouteKeys.length);
  });

  it("attaches a JWT authorizer to every authenticated route and no public route", () => {
    const template = synthesize();
    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    const publicRouteKeys = new Set(["GET /neighborhoods", "GET /neighborhoods/{id}/houses"]);

    for (const route of Object.values(routes) as Array<{ Properties: { RouteKey: string; AuthorizationType?: string } }>) {
      const isPublic = publicRouteKeys.has(route.Properties.RouteKey);
      if (isPublic) {
        expect(route.Properties.AuthorizationType ?? "NONE").toBe("NONE");
      } else {
        expect(route.Properties.AuthorizationType).toBe("JWT");
      }
    }
  });

  it("scopes each function's IAM policy to only the DynamoDB actions it needs", () => {
    const template = synthesize();
    const policies = template.findResources("AWS::IAM::Policy");
    const allActions = Object.values(policies).flatMap((policy) => {
      const statements = (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[] }> } } })
        .Properties.PolicyDocument.Statement;
      return statements.flatMap((statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]));
    });

    // The read-only Milestone 2 functions' Scan/Query/GetItem grants must still be present...
    expect(allActions).toContain("dynamodb:Scan");
    expect(allActions).toContain("dynamodb:Query");
    expect(allActions).toContain("dynamodb:GetItem");
    // ...alongside the write actions Milestone 3 legitimately needs.
    expect(allActions).toContain("dynamodb:PutItem");
    expect(allActions).toContain("dynamodb:TransactWriteItems");
    // Nothing in this stack ever deletes data.
    expect(allActions).not.toContain("dynamodb:DeleteItem");
  });
});
