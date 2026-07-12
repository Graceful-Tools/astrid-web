'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserPlus, Trash2, Shield } from 'lucide-react'
import { toast } from 'sonner'

interface Admin {
  id: string
  userId: string
  email: string
  name: string | null
  grantedBy: string | null
  createdAt: string
}

export default function AdminManagement() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [adding, setAdding] = useState(false)

  const fetchAdmins = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/analytics/admins')

      if (response.status === 403) {
        setError('You do not have admin access.')
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch admins')
      }

      const data = await response.json()
      setAdmins(data.admins)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push('/auth/signin')
      return
    }
    fetchAdmins()
  }, [session, status, router])

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAdminEmail.trim()) return

    try {
      setAdding(true)
      const response = await fetch('/api/admin/analytics/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newAdminEmail.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'Failed to add admin')
        return
      }

      toast.success(`Added ${newAdminEmail} as admin`)
      setNewAdminEmail('')
      fetchAdmins()
    } catch (err) {
      toast.error('Failed to add admin')
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveAdmin = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} as admin?`)) return

    try {
      const response = await fetch(`/api/admin/analytics/admins/${userId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        toast.error(data.error || 'Failed to remove admin')
        return
      }

      toast.success(`Removed ${email} as admin`)
      fetchAdmins()
    } catch (err) {
      toast.error('Failed to remove admin')
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold">Access Denied</h2>
          <p className="text-red-600">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push('/')}>
            Go Home
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">Admin Management</h1>
          <p className="text-muted-foreground">Manage users with admin access to analytics</p>
        </div>
      </div>

      {/* Add Admin Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Add Admin
          </CardTitle>
          <CardDescription>Grant admin access to a user by their email address</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddAdmin} className="flex gap-2">
            <Input
              type="email"
              placeholder="email@example.com"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              disabled={adding}
              className="flex-1"
            />
            <Button type="submit" disabled={adding || !newAdminEmail.trim()}>
              {adding ? 'Adding...' : 'Add Admin'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Admin List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current Admins
          </CardTitle>
          <CardDescription>{admins.length} user{admins.length !== 1 ? 's' : ''} with admin access</CardDescription>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No admins configured</p>
          ) : (
            <div className="space-y-3">
              {admins.map((admin) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">{admin.name || admin.email}</p>
                    {admin.name && <p className="text-sm text-muted-foreground">{admin.email}</p>}
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(admin.createdAt).toLocaleDateString()}
                      {admin.grantedBy ? '' : ' (initial admin)'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveAdmin(admin.userId, admin.email)}
                    disabled={admin.userId === session?.user?.id}
                    title={admin.userId === session?.user?.id ? 'Cannot remove yourself' : 'Remove admin'}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
