import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";

const API_HANDLERS_DIR = path.join(__dirname, "..", "..", "services", "api", "src", "handlers");

export interface CandyMapStackProps extends cdk.StackProps {
  /** CORS origin allowed to call the public API. Defaults to "*" for the POC — restrict for prod. */
  allowedOrigin: string;
  /**
   * Globally-unique Cognito Hosted UI domain prefix. Must be changed before a real deployment —
   * Cognito domain prefixes are unique across *all* AWS accounts in a region.
   */
  cognitoDomainPrefix?: string;
}

export class CandyMapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CandyMapStackProps) {
    super(scope, id, props);

    // --- Data store -------------------------------------------------------
    // Single-table design — see services/api/src/lib/table.ts for the full key schema.
    const table = new dynamodb.Table(this, "CandyMapTable", {
      tableName: "candy-map-data",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    // --- Authentication -----------------------------------------------------
    const userPool = new cognito.UserPool(this, "CandyMapUserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 8, requireLowercase: true, requireUppercase: true, requireDigits: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userPoolName: "candy-map-residents",
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, "PrivacyReviewersGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "privacy-reviewers",
      description: "Manually assigned reviewers for property privacy requests and disputed authority.",
    });

    // Cognito rejects "*" as a callback URL, so the wildcard POC default only gets a localhost
    // callback — set a real `allowedOrigin` context value to get a working hosted-UI redirect.
    const callbackUrls = [
      ...(props.allowedOrigin === "*" ? [] : [`${props.allowedOrigin}/auth/callback`]),
      "http://localhost:5173/auth/callback",
    ];
    const logoutUrls = [...(props.allowedOrigin === "*" ? [] : [props.allowedOrigin]), "http://localhost:5173"];

    const userPoolClient = new cognito.UserPoolClient(this, "CandyMapUserPoolClient", {
      userPool,
      generateSecret: false, // public SPA client — no secret can be kept confidential in a browser.
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls,
        logoutUrls,
      },
    });

    const userPoolDomain = userPool.addDomain("CandyMapUserPoolDomain", {
      cognitoDomain: { domainPrefix: props.cognitoDomainPrefix ?? "candy-map-poc" },
    });

    const authorizer = new authorizers.HttpUserPoolAuthorizer("CandyMapAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    // --- Lambda functions ---------------------------------------------------
    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      ALLOWED_ORIGIN: props.allowedOrigin,
    };

    const bundling: nodejs.BundlingOptions = {
      format: nodejs.OutputFormat.CJS,
      target: "node22",
      // Keep the AWS SDK pinned to our package.json version rather than whatever the Lambda
      // runtime happens to ship, for reproducible builds.
      externalModules: [],
    };

    const makeFn = (name: string, entryFile: string) => {
      const functionName = `candy-map-${name}`;
      const role = new iam.Role(this, `${name}Role`, {
        roleName: functionName,
        path: "/candy-map/runtime/",
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyArn(
          this, `${name}Boundary`,
          `arn:${this.partition}:iam::${this.account}:policy/candy-map-runtime-boundary`,
        ),
      });
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/${functionName}:*`],
      }));
      return new nodejs.NodejsFunction(this, name, {
        functionName,
        role,
        entry: path.join(API_HANDLERS_DIR, entryFile),
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: commonEnvironment,
        bundling,
      });
    };

    // Public read path (Milestone 2)
    const getNeighborhoodsFn = makeFn("GetNeighborhoodsFn", "getNeighborhoods.ts");
    const getNeighborhoodHousesFn = makeFn("GetNeighborhoodHousesFn", "getNeighborhoodHouses.ts");

    // Authenticated write path (Milestone 3)
    const createNeighborhoodFn = makeFn("CreateNeighborhoodFn", "createNeighborhood.ts");
    const resolveHouseFn = makeFn("ResolveHouseFn", "resolveHouse.ts");
    const submitClaimFn = makeFn("SubmitClaimFn", "submitClaim.ts");
    const toggleCandyStatusFn = makeFn("ToggleCandyStatusFn", "toggleCandyStatus.ts");
    const updateEventParticipationFn = makeFn("UpdateEventParticipationFn", "updateEventParticipation.ts");
    const getMyClaimsFn = makeFn("GetMyClaimsFn", "getMyClaims.ts");
    const approveClaimFn = makeFn("ApproveClaimFn", "approveClaim.ts");

    // Authenticated write path (Milestone 4)
    const reportHouseFn = makeFn("ReportHouseFn", "reportHouse.ts");

    // Least-privilege: each function only gets the DynamoDB actions it actually performs.
    table.grant(getNeighborhoodsFn, "dynamodb:Scan");
    table.grant(getNeighborhoodHousesFn, "dynamodb:Query", "dynamodb:GetItem");
    // PutItem (spatial creation lock) + Scan (overlap candidate search) were added in Milestone 4.
    table.grant(createNeighborhoodFn, "dynamodb:PutItem", "dynamodb:Scan");
    table.grant(resolveHouseFn, "dynamodb:GetItem", "dynamodb:PutItem");
    table.grant(submitClaimFn, "dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem");
    table.grant(toggleCandyStatusFn, "dynamodb:GetItem", "dynamodb:PutItem");
    table.grant(updateEventParticipationFn, "dynamodb:GetItem", "dynamodb:PutItem");
    table.grant(getMyClaimsFn, "dynamodb:Query", "dynamodb:GetItem");
    table.grant(approveClaimFn, "dynamodb:GetItem", "dynamodb:PutItem");
    table.grant(reportHouseFn, "dynamodb:GetItem", "dynamodb:PutItem");

    // --- HTTP API -------------------------------------------------------
    const httpApi = new apigw.HttpApi(this, "CandyMapHttpApi", {
      description: "Candy Map public + authenticated API",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PATCH],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    // POC-scale API Gateway throttle (plan: "add API throttling"). The L2 HttpApi/HttpStage
    // constructs don't expose default route throttling, so this drops to the L1 CfnStage —
    // per-user/per-house limiting (the more important defense) still comes from the
    // DynamoDB-backed rate limiter in each write handler.
    const cfnDefaultStage = httpApi.defaultStage!.node.defaultChild as apigw.CfnStage;
    cfnDefaultStage.defaultRouteSettings = { throttlingBurstLimit: 40, throttlingRateLimit: 20 };
    cdk.Tags.of(httpApi.defaultStage!).add("Name", "candy-map-api");

    // Public routes — no authorizer.
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

    // Authenticated routes — every write checks authorization again inside the handler itself;
    // this authorizer only proves *who* the caller is, not what they're allowed to do.
    httpApi.addRoutes({
      path: "/neighborhoods",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("CreateNeighborhoodIntegration", createNeighborhoodFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/houses/resolve",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("ResolveHouseIntegration", resolveHouseFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/houses/claims",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("SubmitClaimIntegration", submitClaimFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/houses/{id}/candy",
      methods: [apigw.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration("ToggleCandyStatusIntegration", toggleCandyStatusFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/houses/{id}/events/{eventId}",
      methods: [apigw.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration("UpdateEventParticipationIntegration", updateEventParticipationFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/me/claims",
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("GetMyClaimsIntegration", getMyClaimsFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/admin/claims/{id}/approve",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("ApproveClaimIntegration", approveClaimFn),
      authorizer,
    });
    httpApi.addRoutes({
      path: "/houses/{id}/reports",
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("ReportHouseIntegration", reportHouseFn),
      authorizer,
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "CognitoHostedUiDomain", {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
    });
  }
}
