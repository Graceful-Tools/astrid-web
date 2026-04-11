import fs from 'fs'
import path from 'path'

const placeholderImages = [
  {
    id: 1,
    name: "Home Tasks",
    color1: "#3b82f6",
    color2: "#1d4ed8",
    icon: `
      <rect x="30" y="50" width="60" height="50" rx="5" fill="white" opacity="0.9"/>
      <polygon points="30,50 60,25 90,50" fill="white" opacity="0.9"/>
      <circle cx="42" cy="65" r="3" fill="#3b82f6"/>
      <rect x="52" y="75" width="16" height="20" rx="2" fill="#3b82f6"/>
    `
  },
  {
    id: 2,
    name: "Work Projects",
    color1: "#6366f1",
    color2: "#4338ca",
    icon: `
      <rect x="25" y="35" width="70" height="50" rx="5" fill="white" opacity="0.9"/>
      <rect x="30" y="40" width="60" height="3" rx="1" fill="#6366f1"/>
      <rect x="30" y="48" width="45" height="2" rx="1" fill="#6366f1" opacity="0.7"/>
      <rect x="30" y="54" width="35" height="2" rx="1" fill="#6366f1" opacity="0.7"/>
      <rect x="30" y="60" width="50" height="2" rx="1" fill="#6366f1" opacity="0.7"/>
    `
  },
  {
    id: 3,
    name: "Shopping List",
    color1: "#10b981",
    color2: "#059669",
    icon: `
      <rect x="35" y="30" width="50" height="60" rx="5" fill="white" opacity="0.9"/>
      <rect x="30" y="35" width="15" height="50" rx="3" fill="white" opacity="0.9"/>
      <circle cx="45" cy="45" r="2" fill="#10b981"/>
      <circle cx="45" cy="55" r="2" fill="#10b981"/>
      <circle cx="45" cy="65" r="2" fill="#10b981"/>
      <circle cx="45" cy="75" r="2" fill="#10b981"/>
    `
  },
  {
    id: 4,
    name: "Health & Fitness",
    color1: "#ef4444",
    color2: "#dc2626",
    icon: `
      <path d="M60 35 C50 25, 30 25, 30 45 C30 65, 60 85, 60 85 C60 85, 90 65, 90 45 C90 25, 70 25, 60 35 Z" fill="white" opacity="0.9"/>
      <circle cx="45" cy="60" r="8" fill="none" stroke="#ef4444" stroke-width="3"/>
      <rect x="41" y="56" width="8" height="8" fill="#ef4444"/>
    `
  },
  {
    id: 5,
    name: "Travel Plans",
    color1: "#8b5cf6",
    color2: "#7c3aed",
    icon: `
      <rect x="25" y="40" width="70" height="45" rx="8" fill="white" opacity="0.9"/>
      <rect x="35" y="30" width="50" height="15" rx="3" fill="white" opacity="0.9"/>
      <circle cx="45" cy="55" r="3" fill="#8b5cf6"/>
      <circle cx="60" cy="55" r="3" fill="#8b5cf6"/>
      <circle cx="75" cy="55" r="3" fill="#8b5cf6"/>
      <rect x="40" y="65" width="40" height="3" rx="1" fill="#8b5cf6" opacity="0.7"/>
    `
  },
  {
    id: 6,
    name: "Study Goals",
    color1: "#06b6d4",
    color2: "#0891b2",
    icon: `
      <rect x="30" y="25" width="60" height="70" rx="5" fill="white" opacity="0.9"/>
      <rect x="35" y="35" width="50" height="3" rx="1" fill="#06b6d4"/>
      <rect x="35" y="45" width="40" height="2" rx="1" fill="#06b6d4" opacity="0.7"/>
      <rect x="35" y="52" width="45" height="2" rx="1" fill="#06b6d4" opacity="0.7"/>
      <rect x="35" y="59" width="35" height="2" rx="1" fill="#06b6d4" opacity="0.7"/>
      <circle cx="75" cy="75" r="8" fill="#06b6d4"/>
      <path d="M71 75 L74 78 L79 71" stroke="white" stroke-width="2" fill="none"/>
    `
  },
  {
    id: 7,
    name: "Creative Projects",
    color1: "#ec4899",
    color2: "#db2777",
    icon: `
      <circle cx="60" cy="60" r="25" fill="white" opacity="0.9"/>
      <path d="M45 45 Q60 35, 75 45 Q65 60, 60 75 Q55 60, 45 45 Z" fill="#ec4899"/>
      <circle cx="50" cy="50" r="3" fill="#ec4899"/>
      <circle cx="70" cy="50" r="3" fill="#ec4899"/>
      <circle cx="60" cy="70" r="3" fill="#ec4899"/>
    `
  },
  {
    id: 8,
    name: "Garden Tasks",
    color1: "#84cc16",
    color2: "#65a30d",
    icon: `
      <ellipse cx="60" cy="75" rx="25" ry="15" fill="white" opacity="0.9"/>
      <path d="M60 75 Q50 55, 45 45 Q55 40, 60 50 Q65 40, 75 45 Q70 55, 60 75" fill="#84cc16"/>
      <rect x="58" y="75" width="4" height="15" fill="#84cc16" opacity="0.8"/>
      <circle cx="45" cy="85" r="2" fill="#84cc16"/>
      <circle cx="75" cy="85" r="2" fill="#84cc16"/>
    `
  },
  {
    id: 9,
    name: "Cooking Plans",
    color1: "#f59e0b",
    color2: "#d97706",
    icon: `
      <ellipse cx="60" cy="70" rx="20" ry="15" fill="white" opacity="0.9"/>
      <rect x="55" y="40" width="10" height="30" rx="2" fill="white" opacity="0.9"/>
      <circle cx="60" cy="70" r="15" fill="none" stroke="#f59e0b" stroke-width="3"/>
      <path d="M50 70 Q60 60, 70 70" stroke="#f59e0b" stroke-width="2" fill="none"/>
      <circle cx="60" cy="35" r="3" fill="#f59e0b"/>
    `
  },
  {
    id: 10,
    name: "Party Planning",
    color1: "#f97316",
    color2: "#ea580c",
    icon: `
      <path d="M60 25 L65 45 L85 45 L70 60 L75 80 L60 70 L45 80 L50 60 L35 45 L55 45 Z" fill="white" opacity="0.9"/>
      <circle cx="40" cy="40" r="3" fill="#f97316"/>
      <circle cx="80" cy="40" r="3" fill="#f97316"/>
      <circle cx="60" cy="85" r="3" fill="#f97316"/>
      <rect x="50" y="20" width="20" height="3" rx="1" fill="#f97316"/>
    `
  },
  {
    id: 11,
    name: "Tech Projects",
    color1: "#14b8a6",
    color2: "#0f766e",
    icon: `
      <rect x="25" y="35" width="70" height="50" rx="8" fill="white" opacity="0.9"/>
      <rect x="30" y="40" width="60" height="35" rx="3" fill="#14b8a6" opacity="0.1"/>
      <rect x="35" y="45" width="15" height="2" rx="1" fill="#14b8a6"/>
      <rect x="55" y="45" width="25" height="2" rx="1" fill="#14b8a6"/>
      <rect x="35" y="52" width="20" height="2" rx="1" fill="#14b8a6" opacity="0.7"/>
      <rect x="35" y="59" width="30" height="2" rx="1" fill="#14b8a6" opacity="0.7"/>
      <circle cx="75" cy="55" r="5" fill="#14b8a6"/>
    `
  },
  {
    id: 12,
    name: "Family Time",
    color1: "#a855f7",
    color2: "#9333ea",
    icon: `
      <circle cx="45" cy="45" r="8" fill="white" opacity="0.9"/>
      <circle cx="75" cy="45" r="8" fill="white" opacity="0.9"/>
      <circle cx="35" cy="65" r="6" fill="white" opacity="0.9"/>
      <circle cx="60" cy="70" r="10" fill="white" opacity="0.9"/>
      <circle cx="85" cy="65" r="6" fill="white" opacity="0.9"/>
      <circle cx="47" cy="47" r="2" fill="#a855f7"/>
      <circle cx="73" cy="47" r="2" fill="#a855f7"/>
      <circle cx="37" cy="67" r="2" fill="#a855f7"/>
      <circle cx="62" cy="72" r="2" fill="#a855f7"/>
      <circle cx="83" cy="67" r="2" fill="#a855f7"/>
    `
  }
]

function generateSVG(image: any): string {
  return `<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad${image.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${image.color1};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${image.color2};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="20" fill="url(#grad${image.id})"/>
  ${image.icon}
</svg>`
}

function createPlaceholderImages() {
  const imagesDir = path.join(process.cwd(), 'public', 'images', 'list-defaults')
  
  // Ensure directory exists
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }

  console.log('🎨 Creating 12 placeholder SVG images...')

  placeholderImages.forEach((image) => {
    const svg = generateSVG(image)
    const filename = `default-${image.id}.svg`
    const filepath = path.join(imagesDir, filename)
    
    fs.writeFileSync(filepath, svg)
    console.log(`✅ Created ${filename} - ${image.name}`)
  })

  console.log('🎉 All placeholder images created successfully!')
}

// Run the script if called directly
if (require.main === module) {
  createPlaceholderImages()
}

export { createPlaceholderImages }