# bibtexmcp — BibTeX MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants read and edit `.bib` files directly.

## Tools

| Tool | Description |
|---|---|
| `query_entries` | Search entries by key, type, or field value substring |
| `get_entry` | Get a full entry by citation key |
| `get_field` | Get a single field value |
| `create_entry` | Create a new entry |
| `update_field` | Set or update a single field |
| `delete_field` | Remove a field |
| `delete_entry` | Delete an entry |
| `validate_entry` | Validate a single entry against BibTeX rules |
| `validate_file` | Validate all entries in a file |
| `list_entry_types` | List standard BibTeX types with required/optional fields |

## Installation

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/mcroomp/latexmcp.git
cd latexmcp
npm install
```

### Register with Claude Code (Windows)

```cmd
install-mcp.cmd
```

### Register manually

```bash
claude mcp add --scope user bibtex -- node /absolute/path/to/src/index.js
```

## Usage

All tools take an absolute path to a `.bib` file. The server is stateless — no file is held open between calls.

```jsonc
// Example: get an entry
{ "tool": "get_entry", "file": "/path/to/refs.bib", "key": "Smith2023" }

// Example: update a field
{ "tool": "update_field", "file": "/path/to/refs.bib", "key": "Smith2023", "field": "year", "value": "2024" }

// Example: validate a file
{ "tool": "validate_file", "file": "/path/to/refs.bib" }
```

## Development

```bash
npm test    # run tests with Node's built-in test runner
npm start   # start the MCP server (stdio transport)
```
