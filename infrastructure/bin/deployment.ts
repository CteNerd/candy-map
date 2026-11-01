#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";

const app = new cdk.App();
const stack = new cdk.Stack(app, "CandyMapDeployment", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
const localPrincipal = new cdk.CfnParameter(stack, "LocalPrincipalArn", { type: "String" });
const repository = new cdk.CfnParameter(stack, "GitHubRepository", { type: "String", default: "CteNerd/candy-map" });
const subjectPrefix = new cdk.CfnParameter(stack, "GitHubSubjectPrefix", { type: "String" });
const apiId = new cdk.CfnParameter(stack, "ApiId", { type: "String", default: "*" });
const poolId = new cdk.CfnParameter(stack, "UserPoolId", { type: "String", default: "*" });
const distributionId = new cdk.CfnParameter(stack, "DistributionId", { type: "String", default: "*" });
const oacId = new cdk.CfnParameter(stack, "OriginAccessControlId", { type: "String", default: "*" });
const arn = (service: string, resource: string, region = stack.region) =>
  `arn:${stack.partition}:${service}:${region}:${stack.account}:${resource}`;
const statement = (actions: string[], resources: string[], conditions?: Record<string, Record<string, string>>) =>
  new iam.PolicyStatement({ actions, resources, conditions });
const tableArn = arn("dynamodb", "table/candy-map-data");
const logsArn = arn("logs", "log-group:/aws/lambda/candy-map-*");
const runtimeRoles = arn("iam", "role/candy-map/runtime/*", "");
const boundary = new iam.ManagedPolicy(stack, "RuntimeBoundary", {
  managedPolicyName: "candy-map-runtime-boundary",
  statements: [
    statement(["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:ConditionCheckItem"], [tableArn, `${tableArn}/index/*`]),
    statement(["ses:SendEmail"], [arn("ses", "identity/*")]),
    statement(["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], [logsArn, `${logsArn}:*`]),
  ],
});
// S3 ARNs omit both account and region.
const webBucket = `arn:${stack.partition}:s3:::candy-map-web-${stack.account}-${stack.region}`;
const assets = new s3.Bucket(stack, "Assets", {
  bucketName: `candy-map-assets-${stack.account}-${stack.region}`,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  versioned: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
new ssm.StringParameter(stack, "BootstrapVersion", { parameterName: "/cdk-bootstrap/candymap/version", stringValue: "6" });

const executionPolicy = new iam.ManagedPolicy(stack, "ExecutionPolicy", {
  managedPolicyName: "candy-map-cloudformation",
  statements: [
    statement(["ssm:GetParameters"], [arn("ssm", "parameter/cdk-bootstrap/candymap/version")]),
    statement(["ssm:GetParameters"], [arn("ssm", "parameter/candy-map/invitations/sender")]),
    statement([
      "dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:UpdateTable", "dynamodb:DeleteTable",
      "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive", "dynamodb:TagResource", "dynamodb:UntagResource",
      "dynamodb:ListTagsOfResource", "dynamodb:DescribeContinuousBackups", "dynamodb:UpdateContinuousBackups",
    ], [tableArn, `${tableArn}/index/*`]),
    statement([
      "lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
      "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:DeleteFunction", "lambda:AddPermission",
      "lambda:RemovePermission", "lambda:GetPolicy", "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags",
      "lambda:GetRuntimeManagementConfig", "lambda:PutRuntimeManagementConfig",
    ], [arn("lambda", "function:candy-map-*")]),
    statement(["iam:CreateRole", "iam:PutRolePermissionsBoundary"], [runtimeRoles],
      { StringEquals: { "iam:PermissionsBoundary": boundary.managedPolicyArn } }),
    statement([
      "iam:GetRole", "iam:DeleteRole", "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
      "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole", "iam:UpdateAssumeRolePolicy",
    ], [runtimeRoles]),
    statement(["iam:PassRole"], [runtimeRoles], { StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" } }),
    statement(["iam:GetPolicy", "iam:GetPolicyVersion"], [boundary.managedPolicyArn]),
    // Missing-role existence checks use a root-path ARN before IAM can resolve the intended path.
    statement(["iam:GetRole", "iam:DeleteRole"], [arn("iam", "role/candy-map-*", "")]),
    statement([
      "s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucketLocation", "s3:GetBucketPolicy", "s3:PutBucketPolicy",
      "s3:DeleteBucketPolicy", "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock",
      "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:GetBucketTagging", "s3:PutBucketTagging",
      "s3:GetBucketVersioning", "s3:PutBucketVersioning", "s3:GetBucketOwnershipControls", "s3:PutBucketOwnershipControls",
      "s3:GetBucketAcl", "s3:ListBucket",
    ], [webBucket]),
    statement(["s3:GetObject", "s3:GetObjectVersion"], [`${assets.bucketArn}/*`]),
    statement(["apigateway:POST"], [`arn:${stack.partition}:apigateway:${stack.region}::/apis`]),
    statement(["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE"], [
      `arn:${stack.partition}:apigateway:${stack.region}::/apis/${apiId.valueAsString}`,
      `arn:${stack.partition}:apigateway:${stack.region}::/apis/${apiId.valueAsString}/*`,
      `arn:${stack.partition}:apigateway:${stack.region}::/tags*`,
    ]),
    statement(["cognito-idp:CreateUserPool"], ["*"]),
    statement([
      "cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool", "cognito-idp:DeleteUserPool",
      "cognito-idp:CreateUserPoolClient", "cognito-idp:UpdateUserPoolClient", "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:DeleteUserPoolClient", "cognito-idp:CreateUserPoolDomain", "cognito-idp:UpdateUserPoolDomain",
      "cognito-idp:DeleteUserPoolDomain", "cognito-idp:TagResource", "cognito-idp:UntagResource", "cognito-idp:ListTagsForResource",
      "cognito-idp:CreateGroup", "cognito-idp:GetGroup", "cognito-idp:UpdateGroup", "cognito-idp:DeleteGroup",
    ], [arn("cognito-idp", `userpool/${poolId.valueAsString}`)]),
    statement(["cognito-idp:DescribeUserPoolDomain"], ["*"]),
    statement(["cloudfront:CreateDistribution", "cloudfront:CreateOriginAccessControl"], ["*"]),
    statement([
      "cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution",
      "cloudfront:DeleteDistribution", "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:ListTagsForResource",
    ], [arn("cloudfront", `distribution/${distributionId.valueAsString}`, "")]),
    statement(["cloudfront:GetOriginAccessControl", "cloudfront:GetOriginAccessControlConfig",
      "cloudfront:UpdateOriginAccessControl", "cloudfront:DeleteOriginAccessControl"],
    [arn("cloudfront", `origin-access-control/${oacId.valueAsString}`, "")]),
  ],
});
const executionRole = new iam.Role(stack, "ExecutionRole", {
  roleName: "candy-map-cloudformation",
  path: "/candy-map/deployment/",
  assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
  managedPolicies: [executionPolicy],
});
const stacks = ["CandyMapHosting", "CandyMapStack"].map((name) => arn("cloudformation", `stack/${name}/*`));
const deploymentPolicy = new iam.ManagedPolicy(stack, "DeploymentPolicy", {
  managedPolicyName: "candy-map-deploy",
  statements: [
    statement(["cloudformation:CreateChangeSet", "cloudformation:ExecuteChangeSet", "cloudformation:DeleteChangeSet",
      "cloudformation:DescribeChangeSet", "cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents",
      "cloudformation:DescribeStackResources", "cloudformation:ListStackResources", "cloudformation:GetTemplate",
      "cloudformation:CreateStack", "cloudformation:UpdateStack"], stacks),
    statement(["cloudformation:GetTemplateSummary", "cloudformation:ValidateTemplate", "cloudformation:ListStacks"], ["*"]),
    statement(["iam:PassRole"], [executionRole.roleArn], { StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } }),
    statement(["ssm:GetParameter"], [arn("ssm", "parameter/cdk-bootstrap/candymap/version")]),
    statement(["s3:ListBucket", "s3:GetBucketLocation"], [assets.bucketArn, webBucket]),
    statement(["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"], [`${assets.bucketArn}/*`, `${webBucket}/*`]),
    statement(["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:GetDistribution"],
      [arn("cloudfront", `distribution/${distributionId.valueAsString}`, "")]),
  ],
});
const localRole = new iam.Role(stack, "LocalRole", {
  roleName: "candy-map-local-deploy",
  path: "/candy-map/deployment/",
  assumedBy: new iam.ArnPrincipal(localPrincipal.valueAsString),
  managedPolicies: [deploymentPolicy],
  maxSessionDuration: cdk.Duration.hours(2),
});
const githubRole = new iam.Role(stack, "GitHubRole", {
  roleName: "candy-map-github-deploy",
  path: "/candy-map/deployment/",
  assumedBy: new iam.FederatedPrincipal(
    arn("iam", "oidc-provider/token.actions.githubusercontent.com", ""),
    { StringEquals: {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": `${subjectPrefix.valueAsString}:environment:production`,
    } },
    "sts:AssumeRoleWithWebIdentity",
  ),
  managedPolicies: [deploymentPolicy],
});
const cdkRole = new iam.Role(stack, "CdkRole", {
  roleName: "candy-map-cdk-deploy",
  path: "/candy-map/deployment/",
  assumedBy: new iam.CompositePrincipal(localRole, githubRole),
  managedPolicies: [deploymentPolicy],
});
for (const role of [localRole, githubRole]) {
  role.addToPolicy(statement(["sts:AssumeRole"], [cdkRole.roleArn]));
}
new cdk.CfnOutput(stack, "LocalDeployRoleArn", { value: localRole.roleArn });
new cdk.CfnOutput(stack, "GitHubDeployRoleArn", { value: githubRole.roleArn });
new cdk.CfnOutput(stack, "ExecutionRoleArn", { value: executionRole.roleArn });
cdk.Tags.of(stack).add("Project", "candy-map");
cdk.Tags.of(stack).add("Repository", repository.valueAsString, { excludeResourceTypes: ["aws:cdk:stack"] });
