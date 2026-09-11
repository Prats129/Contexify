#!/usr/bin/env node

/**
 * Contexify Mobile Over-The-Air (OTA) Update Script
 * Pushes instant updates to all installed mobile apps without requiring a new APK download.
 *
 * Usage:
 *   npm run update:mobile
 *   npm run update:mobile -- "Fixed message layout"
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const mobileDir = path.join(rootDir, 'mobile');
const envFile = path.join(mobileDir, '.env');

console.log('\n⚡ Contexify Instant Mobile Update (Over-The-Air)');
console.log('================================================\n');

if (!fs.existsSync(mobileDir)) {
  console.error('❌ Error: "mobile" directory not found at', mobileDir);
  process.exit(1);
}

// Extract optional custom message
const customArgs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const message = customArgs.length > 0 ? customArgs.join(' ') : 'Update ' + new Date().toLocaleTimeString();

// Check for EXPO_PUBLIC_API_URL in mobile/.env
let apiUrl = process.env.EXPO_PUBLIC_API_URL;
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  const match = content.match(/^EXPO_PUBLIC_API_URL\s*=\s*(.+)$/m);
  if (match) {
    apiUrl = match[1].trim().replace(/^["']|["']$/g, '');
  }
}

console.log(`📝 Update Note: "${message}"`);
if (apiUrl) {
  console.log(`📡 Backend Target URL: \x1b[36${apiUrl}\x1b[0m`);
}
console.log('🚀 Publishing new code bundle to channel: preview...\n');

const result = spawnSync('npx', ['eas-cli', 'update', '--channel', 'preview', '--message', message, '--non-interactive'], {
  cwd: mobileDir,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    EAS_SKIP_AUTO_FINGERPRINT: '1',
    ...(apiUrl ? { EXPO_PUBLIC_API_URL: apiUrl } : {}),
  },
});

if (result.status === 0) {
  console.log('\n✨ SUCCESS: Your update has been published over-the-air!');
  console.log('📲 When you open the Contexify app on your phone, it will automatically download and apply the new changes.');
  console.log('   (No new APK download needed!)\n');
} else {
  console.error('\n❌ Update process exited with code:', result.status);
  process.exit(result.status || 1);
}
