# n8n Node Version Updater

A set of Node.js scripts to extract the latest node versions from an n8n source repository and automatically update workflows in your n8n instance to use those versions.

## Overview

This project solves the problem of keeping n8n workflows up-to-date with the latest node versions. When n8n releases new node versions with bug fixes, features, or improvements, existing workflows continue using their original node versions. This toolset allows you to:

1. **Extract** the latest node versions from the n8n source code
2. **Analyze** your n8n workflows to find outdated nodes
3. **Update** workflows to use the latest node versions (with backup)

## Scripts

### `generate_latest_versioning.js`

Scans the n8n source code repository to extract the latest version of each node.

**Usage:**
```bash
node generate_latest_versioning.js [path-to-n8n] > versions.json
```

**Output:** JSON array of node versions:
```json
[
  { "node": "httpRequest", "version": "4.3", "package": "nodes-base" },
  { "node": "agent", "version": "3", "package": "nodes-langchain" }
]
```

### `update-workflows.js`

Connects to your n8n instance via the REST API and updates workflow nodes to their latest versions.

**Usage:**
```bash
# Dry-run (preview changes without modifying)
node update-workflows.js <versions-json-file>

# Apply changes (creates backups first)
node update-workflows.js <versions-json-file> --apply
```

**Features:**
- Dry-run mode by default (safe preview)
- Automatic backup of workflows before updating
- Paginated API calls for large instances
- Detailed console output showing all changes
- Summary statistics

## Setup

### 1. Clone the repository

```bash
git clone <repo-url>
cd n8n-latest-node-extraction
```

### 2. Configure environment

Copy the environment template and add your credentials:

```bash
cp .env.dist .env
```

Edit `.env` with your n8n instance details:
- `N8N_API_KEY`: Your n8n API key (generate in n8n Settings > API)
- `N8N_INSTANCE`: Your n8n instance URL

### 3. Generate version manifest

Clone or download the n8n source repository, then generate the versions file:

```bash
# If you have n8n source locally
node generate_latest_versioning.js /path/to/n8n > latest-versions.json

# Or use default path
node generate_latest_versioning.js > latest-versions.json
```

### 4. Run the update script

```bash
# Preview changes first
node update-workflows.js latest-versions.json

# Apply changes when ready
node update-workflows.js latest-versions.json --apply
```

## Output Example

```
DRY-RUN MODE (use --apply to make changes)

Loading version manifest: latest-versions.json
Loaded 543 node versions

Fetching workflows from n8n...
Found 32 workflows

● "Employee RAG" (RcuuNzarLb6HTg64) - 13 node(s) to update:
  - AI Agent (agent): 1.9 → 3
  - HTTP Request (httpRequest): 4.2 → 4.3
  - Default Data Loader (documentDefaultDataLoader): 1 → 1.1

✓ "Error Handler" (XAUr37GtiMhgmhzz) - all nodes up-to-date

==================================================
SUMMARY
==================================================
Workflows checked:        32
Workflows with changes:   26
Total nodes to update:    120
Errors:                   0

Run with --apply to save changes.
```

## Backups

When running with `--apply`, the script automatically creates JSON backups of each workflow before updating:

```
./backups/
  workflow-abc123-My_Workflow-2025-11-26T19-43-00-000Z.json
  workflow-def456-Another_Flow-2025-11-26T19-43-01-000Z.json
```

## Requirements

- Node.js 18+ (uses native `fetch`)
- n8n instance with API access enabled
- n8n source repository (for version extraction)

## Supported Node Packages

- `nodes-base` - Core n8n nodes
- `nodes-langchain` - AI/LangChain nodes

## License

MIT
