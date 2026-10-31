import { execFileSync } from "node:child_process";

if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
  process.env.AWS_PROFILE = "candy-map";
}
function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: "inherit", ...options });
}

function outputs(stack) {
  const result = JSON.parse(run("aws", [
    "cloudformation", "describe-stacks", "--stack-name", stack, "--output", "json",
  ], { stdio: ["ignore", "pipe", "inherit"] }));
  return Object.fromEntries(result.Stacks[0].Outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
}

const identity = JSON.parse(run("aws", ["sts", "get-caller-identity", "--output", "json"],
  { stdio: ["ignore", "pipe", "inherit"] }));
if (!/^arn:aws:sts::\d+:assumed-role\/candy-map-(local|github)-deploy\//.test(identity.Arn)) {
  throw new Error("Deploy using the candy-map local profile or the GitHub OIDC role, not administrator credentials.");
}
if (process.env.AWS_ACCOUNT_ID && process.env.AWS_ACCOUNT_ID !== identity.Account) {
  throw new Error("Deployment identity does not match AWS_ACCOUNT_ID.");
}

run("npm", ["run", "build", "--workspace", "packages/shared"]);
run("npm", ["run", "cdk", "--", "deploy", "--all", "--require-approval", "never"], { cwd: "infrastructure" });
const backend = outputs("CandyMapStack");
const hosting = outputs("CandyMapHosting");
for (const key of ["ApiUrl", "CognitoHostedUiDomain", "UserPoolClientId"]) {
  if (!backend[key]) throw new Error(`Missing backend output: ${key}`);
}
for (const key of ["WebUrl", "WebBucketName", "DistributionId"]) {
  if (!hosting[key]) throw new Error(`Missing hosting output: ${key}`);
}
run("npm", ["run", "build", "--workspace", "apps/web"], {
  env: {
    ...process.env,
    VITE_API_BASE_URL: backend.ApiUrl,
    VITE_COGNITO_DOMAIN: backend.CognitoHostedUiDomain,
    VITE_COGNITO_CLIENT_ID: backend.UserPoolClientId,
  },
});
// Keep previous hashed assets so already-open tabs still work during a release.
run("aws", ["s3", "sync", "apps/web/dist/assets/", `s3://${hosting.WebBucketName}/assets/`,
  "--cache-control", "public,max-age=31536000,immutable"]);
run("aws", ["s3", "sync", "apps/web/dist/", `s3://${hosting.WebBucketName}/`,
  "--exclude", "assets/*", "--exclude", "index.html", "--cache-control", "no-cache"]);
run("aws", ["s3", "cp", "apps/web/dist/index.html", `s3://${hosting.WebBucketName}/index.html`,
  "--cache-control", "no-cache", "--content-type", "text/html"]);
const invalidation = JSON.parse(run("aws", ["cloudfront", "create-invalidation",
  "--distribution-id", hosting.DistributionId, "--paths", "/*", "--output", "json"],
{ stdio: ["ignore", "pipe", "inherit"] }));
run("aws", ["cloudfront", "wait", "invalidation-completed",
  "--distribution-id", hosting.DistributionId, "--id", invalidation.Invalidation.Id]);
const web = await fetch(hosting.WebUrl, { signal: AbortSignal.timeout(10_000) });
if (!web.ok || !(await web.text()).includes('<div id="root">')) throw new Error("Deployed web smoke check failed");
const api = await fetch(`${backend.ApiUrl}/neighborhoods?lat=37.7765&lon=-122.428`, {
  headers: { Origin: hosting.WebUrl }, signal: AbortSignal.timeout(10_000),
});
if (!api.ok || !Array.isArray(await api.json())) throw new Error("Deployed API smoke check failed");
if (api.headers.get("access-control-allow-origin") !== hosting.WebUrl) throw new Error("Deployed CORS origin does not match hosting");
const callback = await fetch(`${hosting.WebUrl}/auth/callback`, { signal: AbortSignal.timeout(10_000) });
if (!callback.ok || !(await callback.text()).includes('<div id="root">')) throw new Error("SPA callback route smoke check failed");
const protectedRoute = await fetch(`${backend.ApiUrl}/me/claims`, { signal: AbortSignal.timeout(10_000) });
if (protectedRoute.status !== 401) throw new Error("Protected API must reject unsigned requests");
console.log(`Deployed and verified: ${hosting.WebUrl}`);
