import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Reads the Cognito `sub` claim injected by the HTTP API's native JWT authorizer
 * (`event.requestContext.authorizer.jwt.claims`). Verification itself happens at API Gateway,
 * *before* the Lambda is invoked — see infrastructure/lib/candy-map-stack.ts's HttpJwtAuthorizer.
 * Returns null if the event has no verified claims (should not happen on an authorizer-protected
 * route, but handlers must not assume it and must treat a missing user id as unauthenticated).
 */
export function getAuthenticatedUserId(event: APIGatewayProxyEventV2): string | null {
  const sub = getVerifiedClaim(event, "sub");
  return typeof sub === "string" && sub ? sub : null;
}

export function getVerifiedClaim(event: APIGatewayProxyEventV2, name: string): unknown {
  const context = event.requestContext;
  if (!("authorizer" in context) || !context.authorizer || typeof context.authorizer !== "object") return undefined;
  const authorizer = context.authorizer;
  if (!("jwt" in authorizer) || !authorizer.jwt || typeof authorizer.jwt !== "object") return undefined;
  const jwt = authorizer.jwt;
  if (!("claims" in jwt) || !jwt.claims || typeof jwt.claims !== "object") return undefined;
  return name in jwt.claims ? Reflect.get(jwt.claims, name) : undefined;
}
