# bibtexmcp — BibTeX MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants read and edit `.bib` files directly.

> **IMPORTANT — AI assistants:** Always use these tools to read or modify `.bib` files.
> **Never** use `grep`, `sed`, text editors, file-write tools, or any direct file access on `.bib` files.
> BibTeX is a fragile, whitespace-sensitive format where unmatched braces, duplicate keys, and broken
> encoding silently corrupt files in ways that are hard to detect and may cause data loss. These tools
> parse and serialise through a dedicated BibTeX library, guaranteeing structural integrity on every write.

## Tools

### Read

| Tool | Description |
|---|---|
| `query_entries` | Search entries by key, type, field value substring, or missing field |
| `get_entry` | Get the full contents of an entry by citation key |
| `get_field` | Get the value of a single field from an entry |

#### `query_entries`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | no | Substring to match against citation keys (case-insensitive) |
| `type` | string | no | Entry type to filter by, e.g. `"article"` |
| `field` | string | no | Field name to search within |
| `fieldValue` | string | no | Substring to match in the specified field value |
| `missingField` | string | no | Return only entries that do NOT have this field, e.g. `"doi"` |
| `keysOnly` | boolean | no | Force keys-only (`true`) or full fields (`false`); omit to auto-decide based on result size |
| `limit` | integer | no | Maximum number of entries to return |
| `offset` | integer | no | Number of matching entries to skip (for pagination) |

#### `get_entry`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry |

#### `get_field`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry |
| `field` | string | yes | Field name, e.g. `"author"`, `"year"`, `"title"` |

---

### Write

| Tool | Description |
|---|---|
| `create_entry` | Create a new entry |
| `update_field` | Set or update a single field |
| `update_fields` | Set or update multiple fields across one or more entries at once |
| `delete_field` | Remove a field from an entry |
| `delete_entry` | Delete an entry entirely |
| `replace_entry` | Replace an entry's type and all fields in one operation |
| `rename_key` | Rename a citation key |
| `create_bib` | Create a new empty `.bib` file |

#### `create_entry`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key for the new entry |
| `type` | string | yes | Entry type, e.g. `"article"`, `"inproceedings"`, `"book"` |
| `fields` | object | yes | Field name → value pairs |

#### `update_field`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry to update |
| `field` | string | yes | Field name to set |
| `value` | string | yes | New value (braces added automatically) |

#### `update_fields`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `updates` | object | yes | Map of citation key → `{ fieldName: value }` pairs, e.g. `{ "smith2023": { "doi": "10.1234/x", "year": "2023" } }` |

#### `delete_field`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry |
| `field` | string | yes | Field name to remove |

#### `delete_entry`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry to delete |

#### `replace_entry`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry to replace |
| `type` | string | no | New entry type; if omitted the existing type is kept |
| `fields` | object | yes | Complete set of fields (replaces all existing fields) |

#### `rename_key`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `oldKey` | string | yes | Current citation key |
| `newKey` | string | yes | New citation key |

#### `create_bib`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path for the new `.bib` file |
| `overwrite` | boolean | no | Overwrite if the file already exists (default: `false`) |

---

### Validate

| Tool | Description |
|---|---|
| `validate_entry` | Validate a single entry against BibTeX rules |
| `validate_file` | Validate all entries in a file |
| `convert_entry_type` | Change an entry's type, optionally renaming fields |
| `list_entry_types` | List standard BibTeX types with required/optional fields |

#### `validate_entry`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry to validate |

#### `validate_file`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |

#### `convert_entry_type`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry to convert |
| `newType` | string | yes | Target entry type, e.g. `"inproceedings"` |
| `fieldRenames` | object | no | Field renames to apply, e.g. `{ "journal": "booktitle" }` |

#### `list_entry_types`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string | no | If provided, show schema for this specific type only |

---

### DOI

| Tool | Description |
|---|---|
| `validate_doi` | Cross-check entry fields against Crossref DOI metadata |
| `validate_doi_batch` | Cross-check all DOI-bearing entries in a file against Crossref |
| `lookup_doi_by_metadata` | Search Crossref for a DOI given title / author / year / journal |
| `fix_from_doi` | Overwrite mismatched local fields with Crossref ground truth |
| `fill_missing_dois` | Automatically look up and fill missing DOI fields for entries |

#### `validate_doi`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry (must have a `doi` field) |

#### `validate_doi_batch`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |

#### `lookup_doi_by_metadata`
At least one of `title` or `author` must be supplied.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | no | Title of the work |
| `author` | string | no | Author name(s) |
| `year` | string\|number | no | Publication year |
| `journal` | string | no | Journal or conference name |
| `rows` | integer (1–20) | no | Maximum number of candidates to return (default: 5) |

#### `fix_from_doi`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the entry (must have a `doi` field) |
| `onlySubstantive` | boolean | no | Only fix substantive mismatches (default: `true`); set `false` to also fix cosmetic differences |
| `fields` | string[] | no | If provided, only fix these specific fields, e.g. `["year", "author"]` |

#### `fill_missing_dois`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `type` | string | no | Entry type to filter by, e.g. `"article"` |
| `threshold` | number | no | Minimum Crossref score to auto-fill (default: 80); lower values fill more but risk false matches |
| `dryRun` | boolean | no | Report candidates without writing to file (default: `false`) |
| `limit` | integer | no | Maximum number of entries to process (default: 10) |
| `offset` | integer | no | Skip the first N matching entries (for pagination) |

---

### Patent

| Tool | Description |
|---|---|
| `validate_patent` | Cross-check a `@patent` entry's fields against the US PatentsView database |

#### `validate_patent`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file |
| `key` | string | yes | Citation key of the `@patent` entry (must have a `number` field with a US patent number, e.g. `"US 9,876,543 B2"`) |

---

### Import

| Tool | Description |
|---|---|
| `import_from_orcid` | Import all public works from an ORCID profile into a BibTeX file |

#### `import_from_orcid`
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file` | string | yes | Absolute path to the `.bib` file (created if it does not exist) |
| `orcid` | string | yes | ORCID iD — bare (`"0000-0001-5985-691X"`) or full URL (`"https://orcid.org/0000-0001-5985-691X"`) |
| `use_doi` | boolean | no | Enrich entries via Crossref when a DOI is present (default: `true`) |
| `dry_run` | boolean | no | Preview what would be imported without writing to the file (default: `false`) |

---

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

## Development

```bash
npm test    # run tests with Node's built-in test runner
npm start   # start the MCP server (stdio transport)
```
