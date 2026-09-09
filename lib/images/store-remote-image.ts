import { randomUUID } from 'node:crypto'
import { deleteObject, putObject } from '@/lib/secure-storage'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { downloadRemoteImage } from '@/lib/security/remote-image'

const log = createLogger('images.store-remote-image')

export interface StoredRemoteImage {
  url: string
  fileId: string
}

export async function storeRemoteImageForUser(
  imageUrl: string,
  userId: string,
): Promise<StoredRemoteImage> {
  const image = await downloadRemoteImage(imageUrl)
  const fileId = randomUUID()
  const filename = `generated-${fileId}.${image.extension}`
  const pathname = `uploads/${userId}/${filename}`
  const blob = await putObject(pathname, Buffer.from(image.bytes), {
    contentType: image.contentType,
  })

  try {
    await prisma.secureFile.create({
      data: {
        id: fileId,
        blobUrl: blob.url,
        originalName: filename,
        mimeType: image.contentType,
        fileSize: image.bytes.byteLength,
        uploadedBy: userId,
        attachTarget: 'list-image',
      },
    })
  } catch (error) {
    await deleteObject(blob.url).catch(cleanupError => {
      log.error({ err: cleanupError, blobUrl: blob.url }, 'Failed to clean up untracked image blob')
    })
    throw error
  }

  return { url: blob.url, fileId }
}
