import { execFileSync } from "node:child_process";

const { AWS_PROFILE: profile, AWS_ACCOUNT_ID: account, AWS_REGION: region,
  COGNITO_USER_POOL_ID: userPoolId, REVIEWER_EMAIL: email } = process.env;
if (!profile || !account || !region || !userPoolId || !email) {
  throw new Error("Set AWS_PROFILE, AWS_ACCOUNT_ID, AWS_REGION, COGNITO_USER_POOL_ID, and REVIEWER_EMAIL for the confirmed account.");
}
if (!/^[^\s"\\]+@[^\s"\\]+$/.test(email)) throw new Error("REVIEWER_EMAIL must be a valid email address.");

function aws(args) {
  const output = execFileSync("aws", [...args, "--region", region, "--output", "json", "--no-cli-pager"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output ? JSON.parse(output) : undefined;
}

const identity = aws(["sts", "get-caller-identity"]);
if (identity.Account !== account) throw new Error("AWS account does not match the approved setup account.");
const stack = aws(["cloudformation", "describe-stacks", "--stack-name", "CandyMapStack"]).Stacks?.[0];
const deployedPoolId = stack?.Outputs?.find((output) => output.OutputKey === "UserPoolId")?.OutputValue;
if (deployedPoolId !== userPoolId) throw new Error("User pool does not match CandyMapStack.");

const users = aws(["cognito-idp", "list-users", "--user-pool-id", userPoolId, "--filter", `email = "${email}"`]).Users ?? [];
const matched = users.filter((user) =>
  user.Enabled && user.UserStatus === "CONFIRMED"
  && user.Attributes?.some((attribute) => attribute.Name === "email" && attribute.Value === email)
  && user.Attributes?.some((attribute) => attribute.Name === "email_verified" && attribute.Value === "true"));
if (users.length !== 1 || matched.length !== 1 || !matched[0].Username) {
  throw new Error("Expected exactly one enabled, confirmed app account with the verified email.");
}
const groupName = "privacy-reviewers";
aws(["cognito-idp", "get-group", "--user-pool-id", userPoolId, "--group-name", groupName]);
if (!process.argv.includes("--assign")) {
  console.log("Confirmed exactly one matching verified app account and the deployed reviewer group. Re-run with --assign to grant reviewer membership.");
} else {
  aws(["cognito-idp", "admin-add-user-to-group", "--user-pool-id", userPoolId,
    "--username", matched[0].Username, "--group-name", groupName]);
  const groups = aws(["cognito-idp", "admin-list-groups-for-user", "--user-pool-id", userPoolId,
    "--username", matched[0].Username]).Groups ?? [];
  if (!groups.some((group) => group.GroupName === groupName)) throw new Error("Reviewer membership verification failed.");
  console.log("Reviewer membership assigned and verified for the confirmed account. Sign out and back in to refresh the app token.");
}
