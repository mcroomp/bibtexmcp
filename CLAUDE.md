# bibtexmcp — BibTeX MCP Server

## Project overview

An MCP (Model Context Protocol) server that exposes BibTeX file manipulation as tools for AI assistants. Built with Node.js (ESM), uses `@modelcontextprotocol/sdk` for the server and `@retorquere/bibtex-parser` for parsing.

## Key files

- `src/index.js` — MCP server entry point; defines all tools
- `src/bibtex.js` — BibTeX file I/O and pure entry-manipulation helpers
- `src/validator.js` — Entry validation (required fields, field-level format checks)
- `install-mcp.cmd` — One-shot installer for Windows (registers server with Claude Code)

## Available MCP tools

| Tool | Description |
|---|---|
| `query_entries` | Search entries by key, type, or field value substring |
| `get_entry` | Get a full entry by citation key |
| `get_field` | Get a single field value |
| `create_entry` | Create a new entry |
| `update_field` | Set or update a single field |
| `delete_field` | Remove a field |
| `delete_entry` | Delete an entry |
| `validate_entry` | Validate a single entry |
| `validate_file` | Validate all entries in a file |
| `list_entry_types` | List standard BibTeX types with required/optional fields |

## Commands

```bash
# Run the server (stdio transport — used by MCP host)
npm start

# Run tests
npm test

# Install into Claude Code (Windows, run once)
install-mcp.cmd
```

## Architecture notes

- All tools accept an absolute `file` path to the `.bib` file — the server is stateless.
- All entry-manipulation functions in `bibtex.js` are pure (return new objects, never mutate).
- Field names are normalised to lowercase throughout.
- `braceWrap` in `bibtex.js` handles serialisation: bare integers are unquoted, everything else is wrapped in `{…}`.
- Parse errors are non-fatal — the server surfaces them alongside results so partial reads still work.

## Testing

Tests live in `test/` and use Node's built-in test runner (`node --test`). Write real test files there; do not use ad-hoc inline scripts.
