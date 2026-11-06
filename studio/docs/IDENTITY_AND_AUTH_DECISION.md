# Studio identity and authorization decision

Status: Neon Managed Auth provisioned on the isolated Studio database; host integration and owner login remain pending.

## Decision

Use Neon Managed Auth (Better Auth) as the candidate identity provider for the
Studio control plane, subject to an explicit owner-approved enablement step.
Keep Studio organization membership, project scope, and action permissions in
the dedicated `studio` application schema.

Neon Auth answers **who signed in**. Studio authorization answers **what that
identity may do**. Do not treat a valid JWT, a Neon Auth organization role, or
the legacy Office audit token as permission to access a Studio project.

## Evidence checked

Read-only inspection of the existing Neon `ai-office` project found:

- AWS platform, region `aws-eu-central-1` (Frankfurt).
- Project-level allowed IP list is empty.
- No Neon Auth enablement or configuration was performed during this review.

These characteristics are compatible with the documented Managed Auth
availability requirements checked for this decision. Re-check current Neon
requirements immediately before enablement.

## Integration contract

1. The host verifies a Neon Auth bearer JWT using the branch's published JWKS
   and validates signature, issuer, expiry, and expected audience where
   applicable.
2. Only verified claims may populate `request.auth.actor.id`; use the stable
   identity-provider subject, never a request-body actor ID.
3. The existing Studio PostgreSQL access-control adapter resolves active
   organization membership and project permissions for every operation.
4. Keep custom Studio roles (`owner`, `admin`, `member`, `observer`) in
   `studio.organization_memberships`. Neon Auth's Managed Organization
   feature is partial/beta and does not replace this application's permission
   model.
5. Keep the legacy `OFFICE_AUDIT_TOKEN` separate. It is not a user identity
   and must not authorize Studio owner operations.

## Not authorized / not done

- Neon Auth (Managed Better Auth) is provisioned on project `universal-ai-studio`, branch `main`, database `studio_db`.
- Email/password sign-in is enabled; public sign-up is disabled and email verification is required (OTP).
- No owner user, password, session, social OAuth credential, or trusted origin has been created.
- No Render environment variables or deployments have been changed.
- No login UI or bearer-token verifier has been wired into the legacy server.

## Enablement checklist

Before exposing the Studio host:

- Add the exact branch Auth URL and JWKS URL to the host's secret configuration without exposing values in logs or source control.
- Configure a trusted origin only after the dedicated Studio app URL exists.
- Create the owner account through a controlled operator flow; do not re-enable public sign-up.
- Implement and test bearer-token verification and protected API requests.
- Provision the first Studio organization and owner membership through a
  controlled operator-only bootstrap, not a public first-user-wins endpoint.
- Apply Studio migrations only to the explicitly selected dedicated database
  or isolated schema after owner approval.
- Verify sign-up/sign-in/session restoration, invalid-token rejection,
  cross-organization denial, and owner-only approval/execution.

## References

- Neon Auth skill: Managed Better Auth, AWS-only availability, JWKS verification.
- `studio/governance/postgres-access-control.js`: application authorization.
- `studio/storage/migrations/006_organizations_and_memberships.sql`:
  application organization membership schema.
