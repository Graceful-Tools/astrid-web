const fs = require('fs');
const path = require('path');

// Create a simple PNG icon using a data URL approach
// This creates a base64 encoded PNG with a blue background and white "A"

const createPNGDataURL = (size) => {
  // This is a simple 1x1 blue pixel PNG in base64
  // For a real implementation, you'd use a proper image library like sharp or canvas
  const bluePixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  
  // For now, let's create a simple approach using a minimal PNG
  // This creates a blue square with a white "A"
  const canvas = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#3b82f6"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${Math.floor(size * 0.4)}" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="white">A</text>
    </svg>
  `;
  
  return canvas;
};

// Icon sizes needed for PWA
const iconSizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create a simple HTML file that can be used to generate PNG files
const htmlGenerator = `<!DOCTYPE html>
<html>
<head>
    <title>PNG Icon Generator</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .icon { margin: 10px; display: inline-block; text-align: center; }
        canvas { border: 1px solid #ccc; margin: 5px; }
        .download-btn { margin: 5px; padding: 5px 10px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .download-btn:hover { background: #1d4ed8; }
    </style>
</head>
<body>
    <h1>Astrid PWA Icon Generator</h1>
    <p>Click "Download" next to each icon to save as PNG:</p>
    
    ${iconSizes.map(size => `
        <div class="icon">
            <h3>${size}×${size}</h3>
            <canvas id="canvas-${size}" width="${size}" height="${size}"></canvas>
            <br>
            <button class="download-btn" onclick="downloadIcon(${size})">Download icon-${size}x${size}.png</button>
        </div>
    `).join('')}
    
    <script>
        function createIcon(canvas, size) {
            const ctx = canvas.getContext('2d');
            
            // Create gradient background
            const gradient = ctx.createLinearGradient(0, 0, size, size);
            gradient.addColorStop(0, '#3b82f6');
            gradient.addColorStop(1, '#1d4ed8');
            
            // Draw rounded rectangle background
            const radius = size * 0.2;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(0, 0, size, size, radius);
            ctx.fill();
            
            // Draw "A" text
            ctx.fillStyle = 'white';
            ctx.font = \`bold \${Math.floor(size * 0.4)}px Arial, sans-serif\`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('A', size / 2, size / 2);
        }
        
        function downloadIcon(size) {
            const canvas = document.getElementById(\`canvas-\${size}\`);
            const link = document.createElement('a');
            link.download = \`icon-\${size}x\${size}.png\`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
        
        // Generate all icons on page load
        ${iconSizes.map(size => `
            const canvas${size} = document.getElementById('canvas-${size}');
            createIcon(canvas${size}, ${size});
        `).join('')}
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, '..', 'public', 'png-icon-generator.html'), htmlGenerator);

console.log('PNG Icon Generator created!');
console.log('');
console.log('To generate the required PNG icons:');
console.log('1. Open public/png-icon-generator.html in your browser');
console.log('2. Click "Download" for each icon size');
console.log('3. Save all files in the public/icons/ directory');
console.log('4. The PWA install prompt should then appear in Chrome');
console.log('');
console.log('Required files:');
iconSizes.forEach(size => {
  console.log(`- icon-${size}x${size}.png`);
});
