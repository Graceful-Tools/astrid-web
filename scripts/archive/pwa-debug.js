// PWA Debug Script
// Run this in the browser console on your site to debug PWA issues

console.log('🔍 PWA Debug Information');
console.log('========================');

// Check if service worker is supported
console.log('Service Worker Support:', 'serviceWorker' in navigator);

// Check if manifest is linked
const manifestLink = document.querySelector('link[rel="manifest"]');
console.log('Manifest Link:', manifestLink ? manifestLink.href : 'Not found');

// Check if service worker is registered
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    console.log('Service Worker Registrations:', registrations.length);
    registrations.forEach((registration, index) => {
      console.log(`SW ${index + 1}:`, registration.scope);
    });
  });
}

// Check if app is already installed
console.log('Display Mode:', window.matchMedia('(display-mode: standalone)').matches ? 'Standalone' : 'Browser');

// Check manifest content
fetch('/manifest.json')
  .then(response => response.json())
  .then(manifest => {
    console.log('Manifest Content:', manifest);
    
    // Check if all icons exist
    const iconPromises = manifest.icons.map(icon => {
      return fetch(icon.src)
        .then(response => {
          console.log(`✅ Icon ${icon.src}: ${response.status}`);
          return { src: icon.src, status: response.status, exists: response.ok };
        })
        .catch(error => {
          console.log(`❌ Icon ${icon.src}: Failed to load`);
          return { src: icon.src, status: 'error', exists: false };
        });
    });
    
    return Promise.all(iconPromises);
  })
  .then(iconResults => {
    const missingIcons = iconResults.filter(icon => !icon.exists);
    if (missingIcons.length > 0) {
      console.log('❌ Missing Icons:', missingIcons);
    } else {
      console.log('✅ All icons are accessible');
    }
  })
  .catch(error => {
    console.log('❌ Error loading manifest:', error);
  });

// Check PWA criteria
console.log('\n📋 PWA Installation Criteria:');
console.log('1. HTTPS:', location.protocol === 'https:');
console.log('2. Service Worker:', 'serviceWorker' in navigator);
console.log('3. Manifest:', !!manifestLink);
console.log('4. Icons:', 'Check above for icon status');

// Check for beforeinstallprompt event
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  installPrompt = e;
  console.log('✅ Install prompt available');
});

// Check after a delay to see if install prompt appears
setTimeout(() => {
  if (!installPrompt) {
    console.log('❌ Install prompt not available');
    console.log('Possible reasons:');
    console.log('- App already installed');
    console.log('- Missing required icons');
    console.log('- Manifest issues');
    console.log('- Browser not supported');
  }
}, 2000);
