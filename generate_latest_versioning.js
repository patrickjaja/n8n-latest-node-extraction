#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Default n8n directory - can be overridden via command line argument
const N8N_DIR = process.argv[2] || '/home/patrickjaja/development/n8n';

// Node packages to scan
const NODE_PACKAGES = [
	'packages/nodes-base/nodes',
	'packages/@n8n/nodes-langchain/nodes',
];

function findNodeFiles(dir) {
	const results = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...findNodeFiles(fullPath));
			} else if (entry.name.endsWith('.node.ts')) {
				results.push(fullPath);
			}
		}
	} catch (err) {
		console.error(`Warning: Could not read directory ${dir}: ${err.message}`);
	}
	return results;
}

function parseVersion(versionStr) {
	// Convert version string to comparable number (e.g., "2.1" -> 2.1, "3" -> 3)
	return parseFloat(versionStr) || 0;
}

function extractVersionFromContent(content) {
	// Priority 1: defaultVersion (used by VersionedNodeType and array versions with explicit default)
	const defaultMatch = content.match(/defaultVersion:\s*([0-9.]+)/);
	if (defaultMatch) {
		return defaultMatch[1];
	}

	// Priority 2: version array - extract last element
	const arrayMatch = content.match(/version:\s*\[([^\]]+)\]/);
	if (arrayMatch) {
		const versions = arrayMatch[1].split(',').map((v) => v.trim());
		return versions[versions.length - 1];
	}

	// Priority 3: single version number
	const singleMatch = content.match(/version:\s*([0-9.]+)\s*,/);
	if (singleMatch) {
		return singleMatch[1];
	}

	return null;
}

function extractNodeName(content) {
	// Try to extract the 'name' property from the node description
	// Pattern 1: name: 'nodeName' or name: "nodeName"
	const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
	if (nameMatch) {
		return nameMatch[1];
	}
	return null;
}

function findAllTsFiles(dir) {
	const results = [];
	try {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...findAllTsFiles(fullPath));
			} else if (entry.name.endsWith('.ts')) {
				results.push(fullPath);
			}
		}
	} catch {
		// Ignore errors
	}
	return results;
}

function extractVersion(filePath) {
	const content = fs.readFileSync(filePath, 'utf8');
	let version = extractVersionFromContent(content);

	// If no version found, search in same directory and subdirectories
	if (!version) {
		const nodeDir = path.dirname(filePath);
		const tsFiles = findAllTsFiles(nodeDir).filter((f) => f !== filePath);
		for (const tsFile of tsFiles) {
			const tsContent = fs.readFileSync(tsFile, 'utf8');
			version = extractVersionFromContent(tsContent);
			if (version) break;
		}
	}

	// If still no version, check parent's "shared" directory (for factory-based nodes)
	if (!version) {
		const parentDir = path.dirname(path.dirname(filePath));
		const sharedDir = path.join(parentDir, 'shared');
		if (fs.existsSync(sharedDir)) {
			const sharedFiles = findAllTsFiles(sharedDir);
			for (const tsFile of sharedFiles) {
				const tsContent = fs.readFileSync(tsFile, 'utf8');
				version = extractVersionFromContent(tsContent);
				if (version) break;
			}
		}
	}

	return version;
}

function extractNodeInfo(filePath) {
	const content = fs.readFileSync(filePath, 'utf8');

	// Try to get the node name from content first
	let nodeName = extractNodeName(content);

	// If not found in main file, search related files
	if (!nodeName) {
		const nodeDir = path.dirname(filePath);
		const tsFiles = findAllTsFiles(nodeDir).filter((f) => f !== filePath);
		for (const tsFile of tsFiles) {
			const tsContent = fs.readFileSync(tsFile, 'utf8');
			nodeName = extractNodeName(tsContent);
			if (nodeName) break;
		}
	}

	// Fallback to filename-based name
	if (!nodeName) {
		nodeName = path.basename(filePath).replace('.node.ts', '');
	}

	return nodeName;
}

function isMainNodeFile(filePath) {
	const fileName = path.basename(filePath);
	// Skip versioned files like SplitInBatchesV1.node.ts, SplitInBatchesV2.node.ts
	// Main files are like SplitInBatches.node.ts (no version suffix before .node.ts)
	return !fileName.match(/V\d+\.node\.ts$/);
}

function main() {
	// Verify n8n directory exists
	if (!fs.existsSync(N8N_DIR)) {
		console.error(`Error: n8n directory not found at ${N8N_DIR}`);
		console.error('Usage: node generate_latest_versioning.js [path-to-n8n]');
		process.exit(1);
	}

	const allNodeFiles = [];

	// Collect node files from all packages
	for (const pkg of NODE_PACKAGES) {
		const nodesDir = path.join(N8N_DIR, pkg);
		if (fs.existsSync(nodesDir)) {
			const files = findNodeFiles(nodesDir);
			allNodeFiles.push(...files.map(f => ({ path: f, package: pkg })));
		} else {
			console.error(`Warning: Package directory not found: ${nodesDir}`);
		}
	}

	// Group nodes by name and package, keeping only the highest version
	const nodeMap = new Map();

	for (const { path: filePath, package: pkg } of allNodeFiles) {
		// Skip versioned sub-files (V1, V2, etc.) - we want the main file
		if (!isMainNodeFile(filePath)) continue;

		const content = fs.readFileSync(filePath, 'utf8');
		const nodeName = extractNodeName(content) || path.basename(filePath).replace('.node.ts', '');
		const version = extractVersion(filePath) || '1';
		const packageName = pkg.includes('langchain') ? 'nodes-langchain' : 'nodes-base';

		// Create unique key per node name + package
		const key = `${nodeName}|${packageName}`;
		const existing = nodeMap.get(key);

		// Keep the entry with the highest version
		if (!existing || parseVersion(version) > parseVersion(existing.version)) {
			nodeMap.set(key, {
				node: nodeName,
				version: version,
				package: packageName,
			});
		}
	}

	const results = Array.from(nodeMap.values());
	results.sort((a, b) => a.node.localeCompare(b.node));
	console.log(JSON.stringify(results, null, 2));
}

main();
