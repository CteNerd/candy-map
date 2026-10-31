import type { APIGatewayProxyEventV2 } from "aws-lambda";

/**
 * Reads the Cognito `sub` claim injected by the HTTP API's native JWT authorizer
 * (`event.requestContext.authorizer.jwt.claims`). Verification itself happens at API Gateway,
 * *before* the Lambda is invoked — see infrastructure/lib/candy-map-stack.ts's HttpJwtAuthorizer.
 * Returns null if the event has no verified claims (should not happen on an authorizer-protected
 * route, but handlers must not assume it and must treat a missing user id as unauthenticated).
 */
export function getAuthenticatedUserId(event: APIGatewayProxyEventV2): string | null {
  const claims = (
    event.requestContext as unknown as {
      authorizer?: { jwt?: { claims?: Record<string, string> } };
    }
  ).authorizer?.jwt?.claims;
  return claims?.sub ?? null;
}
