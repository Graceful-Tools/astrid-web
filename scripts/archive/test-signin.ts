import bcrypt from "bcryptjs"

async function testSignin() {
  try {
    console.log("🔐 Testing Sign-in Flow")
    console.log("=====================")
    
    // Test data from our debug - let's use jon@kuoparis.com which has a password
    const testEmail = "jon@kuoparis.com"
    const testPassword = "testpass" // Assuming this was the password used
    
    console.log(`Testing login for: ${testEmail}`)
    
    // Test the signup API directly
    console.log("\n1. Testing signup API with new email...")
    const newEmail = `test-${Date.now()}@example.com`
    
    const signupResponse = await fetch("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: newEmail,
        password: "testpass123",
        name: "Test User"
      }),
    })
    
    console.log(`Signup response status: ${signupResponse.status}`)
    const signupData = await signupResponse.json()
    console.log("Signup response:", signupData)
    
    // Test with existing email
    console.log("\n2. Testing signup API with existing email...")
    const existingSignupResponse = await fetch("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "testpass123",
        name: "Test User"
      }),
    })
    
    console.log(`Existing email signup status: ${existingSignupResponse.status}`)
    const existingSignupData = await existingSignupResponse.json()
    console.log("Existing email signup response:", existingSignupData)
    
    console.log("\n✅ Test complete!")
    
  } catch (error) {
    console.error("❌ Error during test:", error)
  }
}

testSignin().catch(console.error)