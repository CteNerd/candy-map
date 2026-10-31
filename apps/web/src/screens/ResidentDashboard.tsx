/**
 * Placeholder for Milestone 3 (Cognito sign-in, claim submission, candy status toggle). Shown so
 * the navigation and information architecture are in place; wiring to real auth/API happens next.
 * See TASKS.md Milestone 3 and README "Known limitations".
 */
export function ResidentDashboard() {
  return (
    <div className="screen">
      <h2>Resident dashboard</h2>
      <div className="banner">
        Sign-in with Cognito, address claim submission, and the available/low/finished toggle are
        implemented in Milestone 3. This screen is a placeholder for the information architecture.
      </div>
      <div className="card" aria-disabled="true">
        <div className="field">
          <label htmlFor="address">Your address</label>
          <input id="address" placeholder="123 Example St" disabled />
        </div>
        <button className="btn" disabled>
          Claim this house (requires sign-in)
        </button>
      </div>
    </div>
  );
}
