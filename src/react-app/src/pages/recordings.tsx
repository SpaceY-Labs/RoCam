import type { Recording, ApiClient } from '@/network/api'

import { useEffect, useState } from 'react'
import { Button } from '@heroui/button'
import { Link } from '@heroui/link'
import { Spinner } from '@heroui/spinner'
import { Input } from '@heroui/input'
import {
  IconCalendarEvent,
  IconClockHour3,
  IconDeviceSdCard,
  IconDownload,
  IconTrash,
} from '@tabler/icons-react'

import DefaultLayout from '@/layouts/default'
import { useRocam } from '@/network/rocamProvider'

export default function RecordingsPage() {
  const { apiClient } = useRocam()

  const [recordings, setRecordings] = useState<Recording[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function loadRecordings() {
    if (!apiClient) return

    try {
      const data = await apiClient.listRecordings()

      setRecordings(data.recordings)
    } catch (e) {
      console.error('Failed to load recordings:', e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (apiClient) {
      loadRecordings()
    }
  }, [apiClient])

  const handleRename = async (id: string, newName: string) => {
    if (!apiClient) return
    try {
      const res = await apiClient.renameRecording(id, newName)
      const updated = (res as any)?.recording as Recording | undefined

      if (updated) {
        setRecordings((cur) => cur.map((x) => (x.id === id ? updated : x)))
      } else {
        await loadRecordings()
      }
    } catch (e) {
      console.error('Failed to rename recording:', e)
      throw e
    }
  }

  const handleDelete = async (r: Recording) => {
    if (!apiClient) return
    if (!confirm(`Delete "${r.filename}"? This cannot be undone.`)) return

    try {
      await apiClient.deleteRecording(r.id)
      setRecordings((cur) => cur.filter((x) => x.id !== r.id))
    } catch (e) {
      console.error('Failed to delete recording:', e)
      throw e
    }
  }

  return (
    <DefaultLayout>
      <section className="flex flex-col">
        <div className="divide-y divide-gray-200 px-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner label="Loading recordings..." />
            </div>
          ) : recordings.length === 0 ? (
            <div className="flex justify-center py-12">
              <p className="text-sm text-gray-500">
                No recordings yet. Start one from the Control page.
              </p>
            </div>
          ) : (
            recordings.map((r) => (
              <RecordingItem
                key={r.id}
                apiClient={apiClient!}
                recording={r}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))
          )}
        </div>
      </section>
    </DefaultLayout>
  )
}

/**
 * SUB-COMPONENTS
 */

interface RecordingItemProps {
  recording: Recording
  apiClient: ApiClient
  onRename: (id: string, newName: string) => Promise<void>
  onDelete: (r: Recording) => Promise<void>
}

function RecordingItem({
  recording: r,
  apiClient,
  onRename,
  onDelete,
}: RecordingItemProps) {
  const [filenameDraft, setFilenameDraft] = useState(r.filename)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Keep draft in sync if r.filename changes externally
  useEffect(() => {
    setFilenameDraft(r.filename)
  }, [r.filename])

  const handleSave = async () => {
    const trimmed = filenameDraft.trim()
    if (!trimmed || trimmed === r.filename || isSaving) {
      setFilenameDraft(r.filename) // Reset if empty or unchanged
      return
    }
    setIsSaving(true)
    try {
      await onRename(r.id, trimmed)
    } catch {
      setFilenameDraft(r.filename) // Revert on error
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      await onDelete(r)
    } catch {
      // Error handled by parent
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="bg-white py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Input
            className="w-96"
            size="sm"
            disabled={isSaving}
            value={filenameDraft}
            onValueChange={setFilenameDraft}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'Escape') {
                setFilenameDraft(r.filename)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />

          <div className="flex items-center text-xs text-gray-500 mt-2">
            <div className="flex items-center gap-1 w-38">
              <IconCalendarEvent size={14} />
              {formatDate(r.createdAt)}
            </div>
            <div className="flex items-center gap-1 w-16">
              <IconClockHour3 size={14} />
              {formatDuration(r.durationSeconds)}
            </div>
            <div className="flex items-center gap-1">
              <IconDeviceSdCard size={14} />
              {formatBytes(r.sizeBytes)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            as={Link}
            href={apiClient.downloadRecordingUrl(r.id)}
            rel="noreferrer"
            target="_blank"
            radius="sm"
            size="sm"
            variant="bordered"
            startContent={<IconDownload size={20} strokeWidth={1.5} />}
          >
            Download
          </Button>

          <Button
            color="danger"
            startContent={
              isDeleting ? undefined : <IconTrash size={20} strokeWidth={1.5} />
            }
            isDisabled={isDeleting}
            radius="sm"
            size="sm"
            variant="bordered"
            onPress={handleDelete}
            isLoading={isDeleting}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * UTILS
 */

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let b = bytes
  let i = 0
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024
    i++
  }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
