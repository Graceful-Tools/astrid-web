/**
 * Test API Key Saving Flow
 * Debug the API key save endpoint
 */

async function testAPISave() {
  console.log('🧪 Testing API Key Save Endpoint...\n')

  // Test the PUT endpoint directly
  try {
    const response = await fetch('http://localhost:3000/api/v1/users/me/ai-credentials', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'next-auth.session-token=your-session-token' // This won't work, but we can test the endpoint structure
      },
      body: JSON.stringify({
        serviceId: 'claude',
        apiKey: 'test-key-sk-ant-api03-test'
      })
    })

    console.log('📊 Response Status:', response.status)
    console.log('📊 Response Headers:', Object.fromEntries(response.headers.entries()))

    const data = await response.text()
    console.log('📊 Response Body:', data)

    if (response.status === 401) {
      console.log('\n✅ Expected: Unauthorized (need valid session)')
      console.log('🔍 Endpoint is responding correctly')
    } else {
      console.log('\n❌ Unexpected response status')
    }

  } catch (error) {
    console.log('❌ Network Error:', error)
  }

  // Test environment variables
  console.log('\n🔍 Environment Check:')
  console.log('ENCRYPTION_KEY set:', process.env.ENCRYPTION_KEY ? 'YES' : 'NO')

  if (process.env.ENCRYPTION_KEY) {
    console.log('Key length:', process.env.ENCRYPTION_KEY.length)
    console.log('Key preview:', process.env.ENCRYPTION_KEY.substring(0, 8) + '...')
  }

  // Test encryption functions
  try {
    const crypto = await import('crypto')
    const testText = 'test-api-key'

    if (process.env.ENCRYPTION_KEY) {
      const algorithm = 'aes-256-cbc'
      const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv(algorithm, key, iv)
      let encrypted = cipher.update(testText, 'utf8', 'hex')
      encrypted += cipher.final('hex')

      console.log('\n✅ Encryption test successful')
      console.log('Test encrypted:', encrypted.substring(0, 20) + '...')

      // Test decryption
      const decipher = crypto.createDecipheriv(algorithm, key, iv)
      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')

      if (decrypted === testText) {
        console.log('✅ Decryption test successful')
      } else {
        console.log('❌ Decryption test failed')
      }
    }

  } catch (error) {
    console.log('❌ Encryption test failed:', error)
  }
}

testAPISave().catch(console.error)