import { execFileSync } from "node:child_process";

function aws(args) {
  return JSON.parse(execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8" }));
}
const identity = aws(["sts", "get-caller-identity"]);
if (!process.env.AWS_ACCOUNT_ID || identity.Account !== process.env.AWS_ACCOUNT_ID) {
  throw new Error("Set AWS_ACCOUNT_ID to the approved setup account; current identity must match.");
}
const region = process.env.AWS_REGION;
if (!region) throw new Error("Set AWS_REGION explicitly.");
if (!identity.Arn.includes(":user/")) throw new Error("Setup requires the approved IAM user identity for local role trust.");
const parameters = [`LocalPrincipalArn=${identity.Arn}`, `GitHubRepository=${process.env.GITHUB_REPOSITORY ?? "CteNerd/candy-map"}`];
if (process.argv.includes("--tighten")) {
  const hosting = aws(["cloudformation", "describe-stacks", "--stack-name", "CandyMapHosting"]).Stacks[0];
  const backend = aws(["cloudformation", "describe-stacks", "--stack-name", "CandyMapStack"]).Stacks[0];
  const resources = aws(["cloudformation", "list-stack-resources", "--stack-name", "CandyMapHosting"]).StackResourceSummaries;
  const oac = resources.find((resource) => resource.ResourceType === "AWS::CloudFront::OriginAccessControl");
  const output = (stack, name) => {
    const value = stack.Outputs.find((item) => item.OutputKey === name)?.OutputValue;
    if (!value) throw new Error(`Missing output: ${name}`);
    return value;
  };
  if (!oac?.PhysicalResourceId) throw new Error("Missing CloudFront origin access control.");
  parameters.push(`ApiId=${new URL(output(backend, "ApiUrl")).hostname.split(".")[0]}`,
    `UserPoolId=${output(backend, "UserPoolId")}`,
    `DistributionId=${output(hosting, "DistributionId")}`,
    `OriginAccessControlId=${oac.PhysicalResourceId}`);
}
execFileSync("npm", ["run", "cdk", "--", "synth", "--app",
  "npx ts-node --prefer-ts-exts bin/deployment.ts", "--output", "cdk.deployment.out", "--quiet"], {
  cwd: "infrastructure",
  stdio: "inherit",
  env: { ...process.env, CDK_DEFAULT_ACCOUNT: identity.Account, CDK_DEFAULT_REGION: region },
});
execFileSync("aws", ["cloudformation", "deploy", "--stack-name", "CandyMapDeployment",
  "--template-file", "infrastructure/cdk.deployment.out/CandyMapDeployment.template.json",
  "--capabilities", "CAPABILITY_NAMED_IAM", "--parameter-overrides", ...parameters], { stdio: "inherit" });
console.log("Deployment setup complete. Existing AWS profiles and unrelated resources were not changed.");
