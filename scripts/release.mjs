#!/usr/bin/env node
/**
 * Release script for Chrome Web Store upload.
 * Validates changelog, builds, zips, and opens the output folder.
 */

import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  // Read package.json version
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const version = pkg.version;
  console.log(`📦 Package version: ${version}`);

  // Read changelog and check for matching version
  const changelogPath = join(ROOT, 'src/lib/changelog.ts');
  const changelogContent = readFileSync(changelogPath, 'utf-8');

  // Parse the changelog array to find version entries
  const versionMatches = changelogContent.match(/version:\s*['"]([^'"]+)['"]/g);
  const versions = versionMatches?.map(m => m.match(/['"]([^'"]+)['"]/)?.[1]) ?? [];

  if (!versions.includes(version)) {
    console.error(`\n❌ Changelog missing entry for version ${version}`);
    console.error(`   Found versions: ${versions.join(', ')}`);
    console.error(`\n   Update src/lib/changelog.ts before releasing.\n`);
    process.exit(1);
  }

  console.log(`✅ Changelog entry found for ${version}`);

  // Build
  console.log('\n🔨 Building...');
  run('npm run build');

  // Zip
  console.log('\n📦 Zipping...');
  run('npm run zip');

  // Find the zip file
  const outputDir = join(ROOT, '.output');
  const zipName = `cocoon-wxt-${version}-chrome.zip`;
  const zipPath = join(outputDir, zipName);

  if (!existsSync(zipPath)) {
    console.error(`\n❌ Expected zip not found: ${zipPath}`);
    process.exit(1);
  }

  // Copy to releases folder
  const releasesDir = join(ROOT, 'releases');
  if (!existsSync(releasesDir)) {
    mkdirSync(releasesDir);
  }
  const releasePath = join(releasesDir, zipName);
  copyFileSync(zipPath, releasePath);

  console.log(`\n✅ Created: releases/${zipName}`);

  // Open Finder with the zip selected
  console.log('📂 Opening releases folder...');
  execSync(`open -R "${releasePath}"`);

  console.log('\n🚀 Ready to upload to Chrome Web Store!');
  console.log('   https://chrome.google.com/webstore/devconsole\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
