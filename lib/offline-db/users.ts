import { offlineDB } from './database'
import type { OfflineUser } from './types'

/**
 * User operations with offline support
 */
export class OfflineUserOperations {
  /**
   * Get all users
   */
  static async getUsers(): Promise<OfflineUser[]> {
    return await offlineDB.users.toArray()
  }

  /**
   * Get user by ID
   */
  static async getUser(id: string): Promise<OfflineUser | undefined> {
    return await offlineDB.users.get(id)
  }

  /**
   * Save user to offline storage
   */
  static async saveUser(user: OfflineUser): Promise<void> {
    await offlineDB.users.put(user)
  }

  /**
   * Save multiple users (bulk operation)
   */
  static async saveUsers(users: OfflineUser[]): Promise<void> {
    await offlineDB.users.bulkPut(users)
  }

  /**
   * Clear all users
   */
  static async clearUsers(): Promise<void> {
    await offlineDB.users.clear()
  }
}
