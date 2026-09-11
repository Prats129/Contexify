#!/usr/bin/env node

/**
 * Contexify Mobile Deployment Script
 * Automates the cloud build process for Android (APK/AAB) and iOS using EAS Build.
 *
 * Usage:
 *   npm run deploy:mobile          # Builds 100% free standalone Android APK
 *   npm run deploy:mobile:bundle   # Builds Google Play Store App Bundle (.aab)
 *   npm run deploy:mobile:ios      # Builds iOS release (.ipa)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const mobileDir = path.join(rootDir, 'mobile');
const envFile = path.join(mobileDir, '.env');

console.log('\n🚀 Contexify Mobile Deployment Pipeline');
console.log('========================================\n');

// 1. Verify mobile directory
if (!fs.existsSync(mobileDir)) {
  console.error('❌ Error: "mobile" directory not found at', mobileDir);
  process.exit(1);
}

// 2. Check for EXPO_PUBLIC_API_URL in mobile/.env
let apiUrl = process.env.EXPO_PUBLIC_API_URL;
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  const match = content.match(/^EXPO_PUBLIC_API_URL\s*=\s*(.+)$/m);
  if (match) {
    apiUrl = match[1].trim().replace(/^["']|["']$/g, '');
  }
}

if (apiUrl) {
  console.log(`📡 Backend Target URL: \x1b[36m${apiUrl}\x1b[0m`);
} else {
  console.log('⚠️  Warning: EXPO_PUBLIC_API_URL is not set in mobile/.env');
  console.log('   The app will default to the LAN IP configured in api.ts.');
  console.log('   (To set your Render URL, add EXPO_PUBLIC_API_URL=https://your-app.onrender.com to mobile/.env)\n');
}

// 3. Determine Build Target from command arguments
const args = process.argv.slice(2);
let platform = 'android';
let profile = 'preview'; // 'preview' generates a direct-install .apk

if (args.includes('--bundle') || args.includes('bundle') || args.includes('production')) {
  profile = 'production';
  console.log('📦 Target: Android App Bundle (.aab) for Google Play Store');
} else if (args.includes('--ios') || args.includes('ios')) {
  platform = 'ios';
  profile = 'production';
  console.log('🍎 Target: iOS Release (.ipa)');
} else {
  console.log('📱 Target: Free Standalone Android APK (Direct Install)');
}

console.log(`⚙️  Platform: ${platform} | Profile: ${profile}\n`);

// 4. Test EAS CLI availability (global eas or npx eas-cli)
let useNpx = false;
const checkEas = spawnSync('eas', ['--version'], { shell: true, encoding: 'utf8' });
if (checkEas.status !== 0) {
  useNpx = true;
  console.log('ℹ️  Global "eas" command not found. Using "npx eas-cli"...');
}

const easCommand = useNpx ? 'npx' : 'eas';
const easArgs = useNpx
  ? ['eas-cli', 'build', '--platform', platform, '--profile', profile]
  : ['build', '--platform', platform, '--profile', profile];

console.log(`▶ Running: ${easCommand} ${easArgs.join(' ')}\n`);

// 5. Execute EAS Build in mobile directory with full interactive I/O
const result = spawnSync(easCommand, easArgs, {
  cwd: mobileDir,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ...(apiUrl ? { EXPO_PUBLIC_API_URL: apiUrl } : {}),
  },
});

if (result.status === 0) {
  console.log('\n✅ Build completed successfully!');
  console.log('📲 Use the QR code or link displayed above to download your mobile app.\n');
} else {
  console.error('\n❌ Build process exited with code:', result.status);
  process.exit(result.status || 1);
}
