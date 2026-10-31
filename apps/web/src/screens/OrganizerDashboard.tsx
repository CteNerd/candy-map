/**
 * Placeholder for Milestones 3-4 (organizer claim approval, duplicate-neighborhood review queue,
 * community report moderation). See TASKS.md Milestones 3-4 and README "Known limitations".
 */
export function OrganizerDashboard() {
  return (
    <div className="screen">
      <h2>Organizer dashboard</h2>
      <div className="banner">
        Claim approval, duplicate-neighborhood overlap review, and community-report moderation are
        implemented in Milestones 3-4. This screen is a placeholder for the information
        architecture.
      </div>
      <div className="card">
        <strong>Pending claims</strong>
        <p className="muted">None yet — organizer approval ships in Milestone 3.</p>
      </div>
      <div className="card">
        <strong>Overlap review queue</strong>
        <p className="muted">None yet — duplicate-neighborhood review ships in Milestone 4.</p>
      </div>
    </div>
  );
}
