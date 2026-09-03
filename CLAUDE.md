## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:

- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Project

Agent Warrant Protocol is a hackathon prototype for human-authorized AI actions. An AI agent may propose a high-risk DNS change, but it cannot execute the change until a person signs a narrowly scoped, expiring, single-use warrant through Foxit eSign.

Project documentation is the current source of truth:

- `README.md`: product background, value proposition, demo story, and project entry point.
- `docs/REQUIREMENTS.md`: MVP scope, user requirements, acceptance criteria, and delivery plan.
- `docs/ARCHITECTURE.md`: trust boundaries, state machines, data model, APIs, integrations, and threat model.

The TypeScript protocol core, name.com sandbox client, Foxit live signing, Xano persistence, kimi-based structured proposal, and a lightweight operator UI are implemented and verified end-to-end. Keep the hackathon MVP restricted to one preconfigured name.com sandbox DNS record unless the requirements document is deliberately revised.
