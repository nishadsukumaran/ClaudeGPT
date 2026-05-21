# projects/

One JSON file per registered project. Filename should be `<projectId>.json`.

Schema: see [`docs/08-project-config-schema.md`](../docs/08-project-config-schema.md). Validated at load time by `@claudegpt/project-registry`.

Example skeleton:

```bash
cp ../docs/08-project-config-schema.md.example example-project.json
# Edit, then commit. The orchestrator hot-reloads on SIGHUP or every 60s.
```

The pilot project config (`claudegpt-pilot.json`) goes here when you're ready to register the first test repo.
