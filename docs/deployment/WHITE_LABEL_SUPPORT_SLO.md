# White-label support and SLO worksheet

Complete this worksheet for the entity operating and supporting a particular deployment.
It intentionally contains no service-level or support commitments. The repository provides
application health endpoints and structured process logs, but it does not establish a
corporate uptime, latency, support-hours, response-time, or certification commitment
(`app/api/health/route.ts`, `lib/logger.ts`, `SECURITY.md`).

## Status: verified versus assumed

**Verified in this repository:** `GET /api/health` provides a health response; application
logs are structured process output; the public security policy describes vulnerability
reporting for the Astrid project. Those facts do not create an SLA or support entitlement
for a white-label deployment.

**Assumptions to resolve:** who operates the service, which support channel they monitor,
which hours and response objectives they can staff, which events are covered, what
maintenance window applies, and what service measurements they can produce. Fill this in
and approve it before sharing as a customer-facing commitment.

## Service owner and scope

| Field | Deployment value |
|---|---|
| Service / deployment name | `[operator to fill]` |
| Service owner and backup owner | `[named roles, not personal secrets]` |
| Covered environment(s) and regions | `[operator to fill]` |
| Included clients and integrations | `[link to the completed compatibility matrix]` |
| Exclusions and customer responsibilities | `[operator to fill]` |
| Support channel and monitored contact | TODO(Jon): decision |
| Support coverage days and hours, including time zone | TODO(Jon): decision |
| Severity definitions and response targets | TODO(Jon): decision |
| Escalation and security-incident contact | `[operator to fill]` |

## SLO definition

For each objective, define the service boundary, measurement source, eligible requests,
measurement window, exclusions, reporting owner, and review cadence before choosing a
threshold.

| Objective | Measurement definition | Target |
|---|---|---|
| Availability | `[health and user-facing checks; define numerator, denominator, window]` | TODO(Jon): decision |
| API latency | `[routes, percentile, region, measurement window]` | TODO(Jon): decision |
| Error rate | `[included status codes and eligible request classes]` | TODO(Jon): decision |
| Maintenance and change notice | `[planned maintenance scope and notice method]` | TODO(Jon): decision |
| Recovery objective | `[link to approved RPO/RTO in the DR worksheet]` | `[approved values or explicitly no commitment]` |

The health endpoint is a probe, not by itself an availability SLO or proof that a user
workflow succeeds (`app/api/health/route.ts`). Validate the measurement method against
real client paths and the deployment's hosting, database, and storage telemetry.

## Incident and change process

- **Detection:** `[monitoring source, owner, alert destination, and after-hours behavior]`
- **Triage:** `[severity definitions, decision owner, and incident record location]`
- **Customer communication:** `[who communicates, through which channel, and when]`
- **Security reports:** `[private channel and responder role; do not direct people to a
  public issue]`
- **Recovery:** `[link to the tested deployment-specific backup and DR procedure]`
- **Changes:** `[release approval, maintenance window, compatibility matrix, and rollback
  authority]`
- **Post-incident review:** `[owner, distribution, and retention policy]`

## Publication check

- [ ] The service owner approved every target, exclusion, response objective, and support
  statement.
- [ ] Each target has a measurement definition and an owner who reviews it.
- [ ] The listed contacts are monitored and do not expose credentials or internal URLs.
- [ ] The DR and compatibility records match the release currently offered.
- [ ] No certification, support entitlement, or uptime promise is implied without separate
  evidence and approval.
