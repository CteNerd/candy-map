import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CandyMapStack } from "../lib/candy-map-stack";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let synthesized: Template | undefined;

function synthesize() {
  if (synthesized) return synthesized;
  const app = new cdk.App();
  const stack = new CandyMapStack(app, "TestStack", {
    allowedOrigin: "https://example.com",
    cognitoDomainPrefix: "candy-map-test",
    env: { account: "123456789012", region: "us-east-1" },
  });
  synthesized = Template.fromStack(stack);
  return synthesized;
}

describe("CandyMapStack", { timeout: 20_000 }, () => {
  it("loads every bundled Lambda handler in Node without dynamic-require initialization errors", () => {
    const app = new cdk.App();
    new CandyMapStack(app, "BundleTest", {
      allowedOrigin: "https://example.com", cognitoDomainPrefix: "candy-map-bundle-test",
      env: { account: "123456789012", region: "us-east-1" },
    });
    app.synth();
    const bundles = readdirSync(app.outdir)
      .filter((entry) => entry.startsWith("asset."))
      .map((entry) => join(app.outdir, entry, "index.js"))
      .filter((entry) => existsSync(entry));
    expect(bundles).toHaveLength(10);
    const result = spawnSync(process.execPath, ["-e",
      "for (const file of process.argv.slice(1)) { if (typeof require(file).handler !== 'function') throw new Error('Missing handler: ' + file); }",
      ...bundles], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  }, 20_000);
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
    template.hasResource("AWS::DynamoDB::Table", { DeletionPolicy: "Retain" });
    template.hasResourceProperties("AWS::DynamoDB::Table", { DeletionProtectionEnabled: true });
  });

  it("creates a Cognito user pool, client, and hosted-UI domain", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 1);
    template.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["code"],
    });
    template.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
    template.hasResourceProperties("AWS::Cognito::UserPool", { DeletionProtection: "ACTIVE" });
  });

  it("defines a dedicated privacy-reviewer group without automatically assigning users", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::Cognito::UserPoolGroup", 1);
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", {
      GroupName: "privacy-reviewers",
    });
    template.resourceCountIs("AWS::Cognito::UserPoolUserToGroupAttachment", 0);
  });

  it("creates one Lambda function per public + authenticated handler (10 total)", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::Lambda::Function", 10);
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
      "PATCH /houses/{id}/events/{eventId}",
      "GET /me/claims",
      "POST /admin/claims/{id}/approve",
      "POST /houses/{id}/reports",
    ];
    for (const routeKey of expectedRouteKeys) {
      template.hasResourceProperties("AWS::ApiGatewayV2::Route", { RouteKey: routeKey });
    }
    template.resourceCountIs("AWS::ApiGatewayV2::Route", expectedRouteKeys.length);
  });

  it("throttles the default API stage", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingBurstLimit: 40, ThrottlingRateLimit: 20 },
    });
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
    // DynamoDB authorizes transaction components via PutItem, not a TransactWriteItems IAM action.
    expect(allActions).not.toContain("dynamodb:TransactWriteItems");
    // Nothing in this stack ever deletes data.
    expect(allActions).not.toContain("dynamodb:DeleteItem");
  });
});
