import { offlineDB } from './database'
import type { OfflineListMember } from './types'

/**
 * List member operations with offline support
 */
export class OfflineListMemberOperations {
  /**
   * Get all members for a list
   */
  static async getMembersByList(listId: string): Promise<OfflineListMember[]> {
    return await offlineDB.listMembers.where('listId').equals(listId).toArray()
  }

  /**
   * Get member by ID
   */
  static async getMember(id: string): Promise<OfflineListMember | undefined> {
    return await offlineDB.listMembers.get(id)
  }

  /**
   * Get member by list and user
   */
  static async getMemberByListAndUser(listId: string, userId: string): Promise<OfflineListMember | undefined> {
    const id = `${listId}_${userId}`
    return await offlineDB.listMembers.get(id)
  }

  /**
   * Save member to offline storage
   */
  static async saveMember(member: OfflineListMember): Promise<void> {
    await offlineDB.listMembers.put(member)
  }

  /**
   * Save multiple members (bulk operation)
   */
  static async saveMembers(members: OfflineListMember[]): Promise<void> {
    await offlineDB.listMembers.bulkPut(members)
  }

  /**
   * Delete member from offline storage
   */
  static async deleteMember(id: string): Promise<void> {
    await offlineDB.listMembers.delete(id)
  }

  /**
   * Delete all members for a list
   */
  static async deleteMembersByList(listId: string): Promise<void> {
    await offlineDB.listMembers.where('listId').equals(listId).delete()
  }

  /**
   * Get pending members (needs sync)
   */
  static async getPendingMembers(): Promise<OfflineListMember[]> {
    return await offlineDB.listMembers.where('syncStatus').equals('pending').toArray()
  }

  /**
   * Clear all members
   */
  static async clearMembers(): Promise<void> {
    await offlineDB.listMembers.clear()
  }
}
