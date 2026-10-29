# Employee agent team

Run a job with a team of named AI employee agents instead of one chat reply. One chief of staff splits the work, specialist bots do their own lanes, and any job that works twice becomes a saved routine.

## Define the team first

- Give every bot a short name, one primary job, and a short description of how it should work.

- Keep each bot focused on one lane. Use a writer bot for writing, a teardown bot for breaking down videos, and similar single job bots for research, inbox, expenses, or operations.

- Name one chief of staff bot. It owns the split, the order, and the handoff between bots. It does not do every lane itself.

- Write the team down before the first job. Record each bot name, its job, its inputs, its deliverable, and the point where it must stop and ask the user.

- Start from the notes already on the computer. Let the bots read those notes first so a new job does not start from zero.

## Run a job through the team

- Give the job as an outcome, not as a chat question. Name the outcome, the sources, the constraints, the deliverable, and the review point where a bot must stop.

- Let the chief of staff split the job and pass each part to the right specialist bot in a shared thread. Do not relay work between bots by hand when the chief of staff can hand it over directly.

- Let the bots work on their own cloud computer. They keep working after the laptop closes because the work lives on that computer, not on the laptop.

- Keep the logins on that cloud computer. Sign in once in its browser for YouTube, Instagram, X, and the other tools the team needs, then reuse those sessions for later jobs.

- Ask the user to take control only for a login, a two factor code, a CAPTCHA, or a sensitive action. Hand control back to the bot after that step so the session stays usable.

- Return to the user for approval on sensitive actions. A bot may draft, research, and prepare, but it stops before it sends, posts, books, or spends without approval.

## Turn repeat work into a reusable routine

- Save a job as a skill when it works two or three times in a row. Record the exact steps, the inputs, the checks, and the deliverable that made those runs work.

- Turn a saved skill into a routine when it should run on a schedule. Run routines in the morning for jobs that repeat daily, and keep the routine name, schedule, and owner in the same place as the skill.

- Test a routine on a small job before it runs unattended. Check the output, the sources it used, and any message or post it prepared, then fix the skill before the next run.

- Keep the skill short and specific. A skill that covers one repeatable job well beats a general skill that covers many jobs badly.

- Review a routine when its tools, logins, or sources change. Update the skill, run it once by hand, and only then put it back on schedule.

## Guard the shared computer

- Treat all bots on one account as sharing one computer. They can see the same files and the same logged in browser sessions, so do not treat them as isolated security zones.

- Give a bot only the tools and logins its lane needs. A research bot does not need a payments session, and a posting bot does not need an inbox it never uses.

- Keep an audit trail for each job. Record which bot did what, which sources it used, and which approvals the user gave.

- Stop a job at the first sign it is doing real work on the wrong target. Check the target, the account, and the deliverable before it continues.

- Never let a bot post, send, or spend from a draft the user has not approved. A prepared draft is not an approval.

## Available connectors

- Use `muse.connector_search` to find other connectors and `muse.skill_search` to find related skills.

- If nothing here fits, look on the web for a maintained API or MCP server and set it up with [Custom Connectors and MCPs](/opt/muse/skills/custom-connector-setup/SKILL.md), or build a custom connector.
