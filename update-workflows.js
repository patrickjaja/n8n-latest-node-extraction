#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Load .env file manually (no dependencies)
function loadEnv() {
	const envPath = path.join(__dirname, '.env');
	if (!fs.existsSync(envPath)) return;

	const content = fs.readFileSync(envPath, 'utf8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		const key = trimmed.substring(0, eqIndex).trim();
		const value = trimmed.substring(eqIndex + 1).trim();
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

loadEnv();

const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_INSTANCE = process.env.N8N_INSTANCE?.replace(/\/$/, ''); // Remove trailing slash

const BACKUP_DIR = path.join(__dirname, 'backups');

// Parse command line arguments
const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const versionsFile = args.find(arg => !arg.startsWith('--'));

if (!versionsFile) {
	console.error('Usage: node update-workflows.js <versions-json-file> [--apply]');
	console.error('Example: node update-workflows.js latest-node-versions-2025-11-26_1943.json --apply');
	process.exit(1);
}

if (!N8N_API_KEY || !N8N_INSTANCE) {
	console.error('Error: N8N_API_KEY and N8N_INSTANCE must be set in .env file');
	process.exit(1);
}

// Load version manifest and create lookup map
function loadVersions(jsonPath) {
	const content = fs.readFileSync(jsonPath, 'utf8');
	const versions = JSON.parse(content);

	// Create lookup map: { "httpRequest|nodes-base": "4.1", ... }
	const versionMap = new Map();
	for (const entry of versions) {
		const key = `${entry.node}|${entry.package}`;
		versionMap.set(key, parseFloat(entry.version));
	}
	return versionMap;
}

// Extract node name and package from type string
// e.g., "n8n-nodes-base.httpRequest" -> { name: "httpRequest", package: "nodes-base" }
// e.g., "@n8n/n8n-nodes-langchain.agent" -> { name: "agent", package: "nodes-langchain" }
function parseNodeType(type) {
	if (!type) return null;

	const parts = type.split('.');
	if (parts.length < 2) return null;

	const name = parts[parts.length - 1];
	const packagePart = parts.slice(0, -1).join('.');

	let packageName;
	if (packagePart.includes('langchain')) {
		packageName = 'nodes-langchain';
	} else if (packagePart.includes('n8n-nodes-base')) {
		packageName = 'nodes-base';
	} else {
		// Unknown package, skip
		return null;
	}

	return { name, package: packageName };
}

// API helper
async function apiRequest(method, endpoint, body = null) {
	const url = `${N8N_INSTANCE}/api/v1${endpoint}`;
	const options = {
		method,
		headers: {
			'X-N8N-API-KEY': N8N_API_KEY,
			'Accept': 'application/json',
			'Content-Type': 'application/json',
		},
	};

	if (body) {
		options.body = JSON.stringify(body);
	}

	const response = await fetch(url, options);

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`API error ${response.status}: ${text}`);
	}

	return response.json();
}

// Fetch all workflows with pagination
async function fetchAllWorkflows() {
	const workflows = [];
	let cursor = null;

	do {
		const params = new URLSearchParams({ limit: '250' });
		if (cursor) params.set('cursor', cursor);

		const result = await apiRequest('GET', `/workflows?${params}`);
		workflows.push(...result.data);
		cursor = result.nextCursor;
	} while (cursor);

	return workflows;
}

// Fetch single workflow with full details
async function getWorkflow(id) {
	return apiRequest('GET', `/workflows/${id}`);
}

// Update workflow
async function updateWorkflow(id, workflow) {
	return apiRequest('PUT', `/workflows/${id}`, workflow);
}

// Create backup of workflow
function backupWorkflow(workflow) {
	if (!fs.existsSync(BACKUP_DIR)) {
		fs.mkdirSync(BACKUP_DIR, { recursive: true });
	}

	const safeName = workflow.name.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `workflow-${workflow.id}-${safeName}-${timestamp}.json`;
	const filepath = path.join(BACKUP_DIR, filename);

	fs.writeFileSync(filepath, JSON.stringify(workflow, null, 2));
	return filepath;
}

// Process a single workflow
function analyzeWorkflow(workflow, versionMap) {
	const changes = [];

	if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
		return changes;
	}

	for (const node of workflow.nodes) {
		const parsed = parseNodeType(node.type);
		if (!parsed) continue;

		const key = `${parsed.name}|${parsed.package}`;
		const latestVersion = versionMap.get(key);

		if (latestVersion === undefined) {
			// Node not found in version manifest, skip
			continue;
		}

		const currentVersion = node.typeVersion || 1;

		if (currentVersion < latestVersion) {
			changes.push({
				nodeName: node.name,
				nodeType: parsed.name,
				currentVersion,
				latestVersion,
				node, // Reference to update
			});
		}
	}

	return changes;
}

// Apply version updates to workflow
function applyUpdates(workflow, changes) {
	for (const change of changes) {
		change.node.typeVersion = change.latestVersion;
	}
	return workflow;
}

async function main() {
	console.log(applyMode ? 'APPLY MODE - Changes will be saved' : 'DRY-RUN MODE (use --apply to make changes)\n');

	// Load version manifest
	console.log(`Loading version manifest: ${versionsFile}`);
	const versionMap = loadVersions(versionsFile);
	console.log(`Loaded ${versionMap.size} node versions\n`);

	// Fetch all workflows
	console.log('Fetching workflows from n8n...');
	const workflowList = await fetchAllWorkflows();
	console.log(`Found ${workflowList.length} workflows\n`);

	// Statistics
	let workflowsChecked = 0;
	let workflowsWithChanges = 0;
	let totalNodesUpdated = 0;
	let errors = 0;

	// Process each workflow
	for (const wfSummary of workflowList) {
		try {
			// Fetch full workflow details
			const workflow = await getWorkflow(wfSummary.id);
			workflowsChecked++;

			// Analyze for outdated nodes
			const changes = analyzeWorkflow(workflow, versionMap);

			if (changes.length === 0) {
				console.log(`✓ "${workflow.name}" (${workflow.id}) - all nodes up-to-date`);
				continue;
			}

			workflowsWithChanges++;
			totalNodesUpdated += changes.length;

			console.log(`\n● "${workflow.name}" (${workflow.id}) - ${changes.length} node(s) to update:`);
			for (const change of changes) {
				console.log(`  - ${change.nodeName} (${change.nodeType}): ${change.currentVersion} → ${change.latestVersion}`);
			}

			if (applyMode) {
				// Create backup
				const backupPath = backupWorkflow(workflow);
				console.log(`  Backup: ${backupPath}`);

				// Apply updates
				const updatedWorkflow = applyUpdates(workflow, changes);

				// Save to n8n
				await updateWorkflow(workflow.id, updatedWorkflow);
				console.log(`  ✓ Updated successfully`);
			}
		} catch (err) {
			errors++;
			console.error(`✗ Error processing workflow ${wfSummary.id}: ${err.message}`);
		}
	}

	// Summary
	console.log('\n' + '='.repeat(50));
	console.log('SUMMARY');
	console.log('='.repeat(50));
	console.log(`Workflows checked:        ${workflowsChecked}`);
	console.log(`Workflows with changes:   ${workflowsWithChanges}`);
	console.log(`Total nodes to update:    ${totalNodesUpdated}`);
	console.log(`Errors:                   ${errors}`);

	if (!applyMode && workflowsWithChanges > 0) {
		console.log('\nRun with --apply to save changes.');
	}
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
