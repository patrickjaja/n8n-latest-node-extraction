# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2025-11-26

### Added
- Initial release
- `generate_latest_versioning.js` - Extract latest node versions from n8n source
  - Scans both `nodes-base` and `nodes-langchain` packages
  - Extracts `defaultVersion`, version arrays, and single versions
  - Outputs JSON manifest with node name, version, and package
- `update-workflows.js` - Update n8n workflows via REST API
  - Dry-run mode by default for safe preview
  - `--apply` flag to execute actual updates
  - Automatic JSON backup before each workflow update
  - Paginated API calls for large n8n instances
  - Detailed console output with change summary
  - Support for both `nodes-base` and `nodes-langchain` nodes
- `.env.dist` - Environment template with configuration placeholders
- `.gitignore` - Standard ignores for Node.js projects
- `README.md` - Complete documentation with usage examples
- `example-output.md` - Sample output from the update script
