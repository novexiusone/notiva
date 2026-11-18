# Notiva

A local-first Notion alternative for macOS, Windows and Linux. No collaboration, no cloud requirement. Built with Rust and Tauri, data in embedded SurrealDB.

The project is at the very beginning. What gets built, and in which order, is described in the [capability map](docs/en/specs/CAPABILITY-MAP.md). The backlog lives in the [issues](https://github.com/novexlab/notiva/issues).

## Development

Needs Rust, Node with pnpm and [just](https://just.systems) (`brew install just`).

```bash
just            # list all recipes
just install    # install the frontend dependencies
just dev        # run the desktop app with hot reload
just check      # build, lint and run every test, as CI does
```

## License

Notiva is licensed under the [Apache License 2.0](LICENSE).

It embeds [SurrealDB](https://surrealdb.com), which is published under the Business Source License 1.1. Its additional use grant allows any use except offering it as a database service to third parties. It becomes Apache-2.0 on 2030-11-03.

Documentation: [English](docs/en/README.md) · [Deutsch](docs/de/README.md)
