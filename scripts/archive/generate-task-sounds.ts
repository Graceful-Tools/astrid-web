#!/usr/bin/env tsx
/**
 * Generate task action sound files using Web Audio API
 * Creates WAV files that can be used directly
 */

import { writeFileSync } from 'fs'
import { join } from 'path'

// WAV file header generator
function createWavHeader(dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const header = Buffer.alloc(44)

  // "RIFF" chunk descriptor
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4) // File size - 8
  header.write('WAVE', 8)

  // "fmt " sub-chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28) // ByteRate
  header.writeUInt16LE(numChannels * bitsPerSample / 8, 32) // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34)

  // "data" sub-chunk
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)

  return header
}

// Convert float samples to 16-bit PCM
function floatTo16BitPCM(samples: Float32Array): Buffer {
  const buffer = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
    buffer.writeInt16LE(Math.round(value), i * 2)
  }
  return buffer
}

// Generate task complete sound - satisfying thump/checkmark sound
// Like checking off a physical checkbox with a pen
function generateTaskCompleteSound(sampleRate: number = 44100): Buffer {
  const duration = 0.15 // 150ms - short and punchy
  const numSamples = Math.floor(sampleRate * duration)
  const samples = new Float32Array(numSamples)

  // Low frequency thump (like paper/cardboard sound)
  const baseFreq = 120 // Hz - deep, satisfying thump
  const clickFreq = 2500 // Hz - high frequency "click" component

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate

    // Very fast attack, medium decay for "thump" feel
    const envelope = Math.exp(-t * 25)

    // Low frequency component (the thump)
    const thump = Math.sin(2 * Math.PI * baseFreq * t) * envelope * 0.6

    // High frequency component (the click/snap) - very short
    const clickEnvelope = Math.exp(-t * 80) // Decays very quickly
    const click = Math.sin(2 * Math.PI * clickFreq * t) * clickEnvelope * 0.3

    // Add some noise for texture (like pen on paper)
    const noise = (Math.random() * 2 - 1) * envelope * 0.05

    samples[i] = thump + click + noise
  }

  const pcmData = floatTo16BitPCM(samples)
  const header = createWavHeader(pcmData.length, sampleRate, 1, 16)
  return Buffer.concat([header, pcmData])
}

// Generate task create sound (soft pop)
function generateTaskCreateSound(sampleRate: number = 44100): Buffer {
  const duration = 0.15 // 150ms
  const numSamples = Math.floor(sampleRate * duration)
  const samples = new Float32Array(numSamples)

  const frequency = 800 // Hz

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const envelope = Math.exp(-t * 25) // Fast decay
    samples[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.15
  }

  const pcmData = floatTo16BitPCM(samples)
  const header = createWavHeader(pcmData.length, sampleRate, 1, 16)
  return Buffer.concat([header, pcmData])
}

// Generate task delete sound (descending tone)
function generateTaskDeleteSound(sampleRate: number = 44100): Buffer {
  const duration = 0.2 // 200ms
  const numSamples = Math.floor(sampleRate * duration)
  const samples = new Float32Array(numSamples)

  const startFreq = 600
  const endFreq = 300

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const progress = t / duration
    const freq = startFreq + (endFreq - startFreq) * progress
    const envelope = Math.exp(-t * 10) // Decay
    samples[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.12
  }

  const pcmData = floatTo16BitPCM(samples)
  const header = createWavHeader(pcmData.length, sampleRate, 1, 16)
  return Buffer.concat([header, pcmData])
}

// Main execution
const soundsDir = join(process.cwd(), 'public', 'sounds')

console.log('🎵 Generating task action sounds...\n')

try {
  // Generate task complete sound
  console.log('Generating task-complete.wav...')
  const completeSound = generateTaskCompleteSound()
  writeFileSync(join(soundsDir, 'task-complete.wav'), completeSound)
  console.log(`✅ Created task-complete.wav (${completeSound.length} bytes)`)

  // Generate task create sound
  console.log('Generating task-create.wav...')
  const createSound = generateTaskCreateSound()
  writeFileSync(join(soundsDir, 'task-create.wav'), createSound)
  console.log(`✅ Created task-create.wav (${createSound.length} bytes)`)

  // Generate task delete sound
  console.log('Generating task-delete.wav...')
  const deleteSound = generateTaskDeleteSound()
  writeFileSync(join(soundsDir, 'task-delete.wav'), deleteSound)
  console.log(`✅ Created task-delete.wav (${deleteSound.length} bytes)`)

  console.log('\n✨ All sounds generated successfully!')
  console.log('\n📝 Next steps:')
  console.log('1. Test sounds by opening public/sounds/generate-sounds.html')
  console.log('2. Update useSound.ts to use .wav files instead of .mp3')
  console.log('3. Optional: Convert WAV to MP3 for smaller file sizes')
} catch (error) {
  console.error('❌ Error generating sounds:', error)
  process.exit(1)
}
