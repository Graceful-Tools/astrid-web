// Test the full authentication flow
console.log("🧪 Testing Full Authentication Flow")
console.log("==================================")

// Test the credentials
const testCredentials = {
  email: "pm@kuoparis.com",
  password: "test1234"
}

console.log("Test credentials:", testCredentials)

// This script should be run in the browser console on localhost:3000/auth/signin
if (typeof window !== 'undefined') {
  console.log("✅ Running in browser context")
  
  // Check if NextAuth is available
  if (typeof window.next_auth_url !== 'undefined' || document.querySelector('[data-nextjs-scroll-focus-boundary]')) {
    console.log("✅ NextAuth context detected")
  }
  
  // Check if the form elements are present
  const emailInput = document.querySelector('#email')
  const passwordInput = document.querySelector('#password')
  const submitButton = document.querySelector('button[type="submit"]')
  
  if (emailInput && passwordInput && submitButton) {
    console.log("✅ Form elements found")
    
    // Fill the form
    emailInput.value = testCredentials.email
    passwordInput.value = testCredentials.password
    
    // Dispatch change events
    emailInput.dispatchEvent(new Event('change', { bubbles: true }))
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }))
    
    console.log("📝 Form filled with test credentials")
    console.log("📌 Now click the Sign In button or run: submitButton.click()")
    
    // Auto-submit after 2 seconds
    setTimeout(() => {
      console.log("🚀 Auto-submitting form...")
      submitButton.click()
    }, 2000)
    
  } else {
    console.log("❌ Form elements not found")
    console.log("Email input:", !!emailInput)
    console.log("Password input:", !!passwordInput)  
    console.log("Submit button:", !!submitButton)
  }
  
} else {
  console.log("❌ Not running in browser context")
  console.log("Copy and paste this script in the browser console at localhost:3000/auth/signin")
}