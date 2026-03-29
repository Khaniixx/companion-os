## Summary

Describe the change and why it is needed.

## Testing

- [ ] `apps/desktop`: `npm run lint`
- [ ] `apps/desktop`: `npm run test -- --run`
- [ ] `apps/desktop`: `npm run build`
- [ ] `services/agent-runtime`: `poetry run pytest -q`
- [ ] `services/agent-runtime`: `poetry run python -m compileall app tests`
- [ ] Not applicable

## Docs

- [ ] Documentation updated where behavior or workflow changed
- [ ] Screenshots added for user-facing desktop changes when helpful
- [ ] Not applicable

## Product Checks

- [ ] This preserves one persistent companion identity rather than introducing separate assistant modes
- [ ] If onboarding changed, the flow still reads: Download -> Install OpenClaw -> Configure AI -> Start & Connect
- [ ] Permission boundaries and user-control expectations were preserved

## Notes

Call out known gaps, follow-up work, migrations, or reviewer focus areas.
