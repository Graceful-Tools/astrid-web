const fs = require('fs');
const path = require('path');

// Create a simple SVG icon for Astrid
const createSVGIcon = (size) => `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1d4ed8;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#grad)"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.4}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="white">A</text>
</svg>`;

// Icon sizes needed for PWA
const iconSizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate SVG icons
iconSizes.forEach(size => {
  const svgContent = createSVGIcon(size);
  const filename = `icon-${size}x${size}.svg`;
  const filepath = path.join(iconsDir, filename);
  
  fs.writeFileSync(filepath, svgContent);
  console.log(`Generated ${filename}`);
});

// Create a simple HTML file to convert SVG to PNG (manual step)
const htmlConverter = `
<!DOCTYPE html>
<html>
<head>
  <title>PWA Icon Converter</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .icon { margin: 10px; display: inline-block; }
    canvas { border: 1px solid #ccc; margin: 5px; }
  </style>
</head>
<body>
  <h1>PWA Icon Converter</h1>
  <p>Right-click on each canvas and "Save image as..." to create PNG files:</p>
  
  ${iconSizes.map(size => `
    <div class="icon">
      <h3>${size}x${size}</h3>
      <canvas id="canvas-${size}" width="${size}" height="${size}"></canvas>
    </div>
  `).join('')}
  
  <script>
    ${iconSizes.map(size => `
      const canvas${size} = document.getElementById('canvas-${size}');
      const ctx${size} = canvas${size}.getContext('2d');
      
      // Create gradient
      const gradient${size} = ctx${size}.createLinearGradient(0, 0, ${size}, ${size});
      gradient${size}.addColorStop(0, '#3b82f6');
      gradient${size}.addColorStop(1, '#1d4ed8');
      
      // Draw background
      ctx${size}.fillStyle = gradient${size};
      ctx${size}.roundRect(0, 0, ${size}, ${size}, ${size * 0.2});
      ctx${size}.fill();
      
      // Draw text
      ctx${size}.fillStyle = 'white';
      ctx${size}.font = 'bold ${size * 0.4}px Arial';
      ctx${size}.textAlign = 'center';
      ctx${size}.textBaseline = 'middle';
      ctx${size}.fillText('A', ${size / 2}, ${size / 2});
    `).join('')}
  </script>
</body>
</html>`;

const converterPath = path.join(__dirname, '..', 'public', 'icon-converter.html');
fs.writeFileSync(converterPath, htmlConverter);
console.log('Generated icon-converter.html - open this file in a browser to convert SVG to PNG');

console.log('\nPWA Icon generation complete!');
console.log('Next steps:');
console.log('1. Open public/icon-converter.html in a browser');
console.log('2. Right-click each canvas and save as PNG with the correct filename');
console.log('3. Or use an online SVG to PNG converter with the generated SVG files');
console.log('4. Place the PNG files in public/icons/ directory');
