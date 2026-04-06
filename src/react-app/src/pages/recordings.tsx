/**
 * Author: Zifan Si
 * Date: 2025-11-15
 * Purpose: Renders the recordings management and preview page.
 */
import type { Recording, ApiClient } from '@/network/api'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/button'
import { Spinner } from '@heroui/spinner'
import { Input } from '@heroui/input'
import { addToast } from '@heroui/toast'
import {
  IconCalendarEvent,
  IconClockHour3,
  IconDeviceSdCard,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-react'
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/modal'
import { Trans, useLingui } from '@lingui/react/macro'

import { useRocam } from '@/network/rocamProvider'
import { getErrorMessage } from '@/utils'
import { Navbar } from '@/components/navbar'

/**
 * Displays saved recordings with inline management and preview actions.
 *
 * @returns Recordings page layout, including the list state and preview modal.
 */
export default function RecordingsPage() {
  const { t } = useLingui()
  const { apiClient } = useRocam()

  // Page state keeps the fetched list, loading shell, and active preview modal.
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(
    null
  )

  /**
   * Loads the current recording list once an API client is available.
   *
   * @returns Promise that settles after the recording list has been refreshed.
   */
  async function loadRecordings() {
    if (!apiClient) return

    try {
      const data = await apiClient.listRecordings()

      setRecordings(data.recordings)
    } catch (e) {
      addToast({
        title: t`Failed to load recordings`,
        description: getErrorMessage(e),
        color: 'danger',
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (apiClient) {
      loadRecordings()
    }
  }, [apiClient])

  /**
   * Persists a renamed recording and refreshes local state when required.
   *
   * @param id Identifier of the recording being renamed.
   * @param newName New filename requested by the user.
   * @returns Promise that settles after the rename flow completes.
   */
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
      addToast({
        title: t`Failed to rename recording`,
        description: getErrorMessage(e),
        color: 'danger',
      })
      throw e
    }
  }

  /**
   * Deletes a recording after user confirmation.
   *
   * @param r Recording selected for deletion.
   * @returns Promise that settles after the delete flow completes.
   */
  const handleDelete = async (r: Recording) => {
    if (!apiClient) return
    if (!confirm(t`Delete "${r.name}"? This cannot be undone.`)) return

    try {
      await apiClient.deleteRecording(r.id)
      setRecordings((cur) => cur.filter((x) => x.id !== r.id))
      addToast({
        title: t`Recording deleted`,
        color: 'success',
      })
    } catch (e) {
      addToast({
        title: t`Failed to delete recording`,
        description: getErrorMessage(e),
        color: 'danger',
      })
      throw e
    }
  }

  /**
   * Opens the preview modal for a selected recording.
   *
   * @param r Recording selected for preview.
   * @returns No return value.
   */
  const handlePreview = (r: Recording) => {
    setSelectedRecording(r)
  }

  return (
    <div className="relative">
      <Navbar />
      <div className="divide-y divide-gray-200 px-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner label={t`Loading recordings...`} />
          </div>
        ) : recordings.length === 0 ? (
          <div className="flex justify-center py-12">
            <p className="text-sm text-gray-500">
              <Trans>No recordings yet. Start one from the Control page.</Trans>
            </p>
          </div>
        ) : (
          recordings.map((r) => (
            <RecordingItem
              key={r.id}
              apiClient={apiClient!}
              recording={r}
              onDelete={handleDelete}
              onPreview={handlePreview}
              onRename={handleRename}
            />
          ))
        )}
      </div>

      <PreviewModal
        recording={selectedRecording}
        onClose={() => setSelectedRecording(null)}
      />
    </div>
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
  onPreview: (r: Recording) => void
}

/**
 * Renders a single recording row with rename, preview, download, and delete actions.
 *
 * @param props Recording row props supplied by the parent page.
 * @returns Recording row for the recordings list.
 */
function RecordingItem({
  recording: r,
  apiClient,
  onRename,
  onDelete,
  onPreview,
}: RecordingItemProps) {
  /** Local draft state lets the filename be edited inline before persisting. */
  const [filenameDraft, setFilenameDraft] = useState(r.name)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Keep draft in sync if r.filename changes externally
  useEffect(() => {
    setFilenameDraft(r.name)
  }, [r.name])

  /**
   * Persists the current filename draft when it differs from the saved value.
   *
   * @returns Promise that settles after the rename attempt completes.
   */
  const handleSave = async () => {
    const trimmed = filenameDraft.trim()

    if (!trimmed || trimmed === r.name || isSaving) {
      setFilenameDraft(r.name) // Reset if empty or unchanged

      return
    }
    setIsSaving(true)
    try {
      await onRename(r.id, trimmed)
    } catch {
      setFilenameDraft(r.name) // Revert on error
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Runs the delete action for the current recording row.
   *
   * @returns Promise that settles after the delete attempt completes.
   */
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
            disabled={isSaving}
            size="sm"
            value={filenameDraft}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'Escape') {
                setFilenameDraft(r.name)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            onValueChange={setFilenameDraft}
          />

          <div className="flex items-center text-xs text-gray-500 font-medium tabular-nums mt-2">
            <div className="flex items-center gap-1 w-37">
              <IconCalendarEvent size={14} />
              {formatDate(r.start_timestamp_ms)}
            </div>
            <div className="flex items-center gap-1 w-16">
              <IconClockHour3 size={14} />
              {formatDuration(r.duration_ms)}
            </div>
            <div className="flex items-center gap-1">
              <IconDeviceSdCard size={14} />
              {formatBytes(r.size_bytes)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            radius="sm"
            size="sm"
            startContent={<IconPlayerPlay size={20} strokeWidth={1.5} />}
            variant="bordered"
            onPress={() => onPreview(r)}
          >
            <Trans>Preview</Trans>
          </Button>
          <Button
            as={'a'}
            href={apiClient.getDownloadStabilizedUrl(r.id)}
            radius="sm"
            size="sm"
            startContent={<IconDownload size={20} strokeWidth={1.5} />}
            variant="bordered"
          >
            <Trans>Download</Trans>
          </Button>

          <Button
            color="danger"
            isDisabled={isDeleting}
            isLoading={isDeleting}
            radius="sm"
            size="sm"
            startContent={
              isDeleting ? undefined : <IconTrash size={20} strokeWidth={1.5} />
            }
            variant="bordered"
            onPress={handleDelete}
          >
            <Trans>Delete</Trans>
          </Button>
        </div>
      </div>
    </div>
  )
}

interface PreviewModalProps {
  recording: Recording | null
  onClose: () => void
}

/**
 * Plays the stabilized preview for the selected recording inside a modal.
 *
 * @param recording Recording currently selected for preview.
 * @param onClose Callback used to close the preview modal.
 * @returns Modal containing the stabilized video preview when a recording is selected.
 */
function PreviewModal({ recording, onClose }: PreviewModalProps) {
  const { t } = useLingui()
  const { apiClient } = useRocam()
  const videoRef = useRef<HTMLVideoElement>(null)
  // Playback state drives the overlay controls and loading feedback.
  const [currentTime, setCurrentTime] = useState(0)
  const [isWaiting, setIsWaiting] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)

  // Reset states when recording changes
  useEffect(() => {
    if (recording) {
      setCurrentTime(0)
      setIsWaiting(true)
      setIsPlaying(false)
    } else {
      // Cancel video loading when recording is null (modal closed)
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
        videoRef.current.load() // This cancels any ongoing network requests
      }
    }
  }, [recording])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
        videoRef.current.load()
      }
    }
  }, [])

  /**
   * Syncs playback progress from the video element into component state.
   *
   * @param e Video time update event raised by the preview element.
   * @returns No return value.
   */
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setCurrentTime(e.currentTarget.currentTime)
  }

  /**
   * Toggles preview playback for the selected recording.
   *
   * @returns No return value.
   */
  const handlePlayPause = () => {
    if (!videoRef.current) return

    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((error) => {
          setIsPlaying(false)
          addToast({
            title: t`Failed to play preview`,
            description: getErrorMessage(error),
            color: 'danger',
          })
        })
    }
  }

  /**
   * Updates UI state when preview playback starts.
   *
   * @returns No return value.
   */
  const handlePlaying = () => {
    setIsWaiting(false)
    setIsPlaying(true)
  }

  /**
   * Updates UI state when preview playback pauses.
   *
   * @returns No return value.
   */
  const handlePause = () => {
    setIsPlaying(false)
  }

  /**
   * Formats elapsed preview seconds for the playback overlay.
   *
   * @param s Elapsed playback time in seconds.
   * @returns Two-part `MM:SS` string for the preview footer.
   */
  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60)
    const secs = Math.floor(s % 60)

    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <Modal isOpen={!!recording} size="5xl" onClose={onClose}>
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col">
              <Trans>Preview {recording?.name}</Trans>
            </ModalHeader>
            <ModalBody>
              {recording && apiClient && (
                <div className="relative group mb-4">
                  {isWaiting && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <Spinner />
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    autoPlay
                    className="w-full rounded-lg aspect-video bg-white"
                    src={apiClient.getPreviewStabilizedUrl(recording.id)}
                    onError={(e) => {
                      if (e.currentTarget.error?.code === 4) {
                        // empty src error
                        return
                      }
                      addToast({
                        title: t`Failed to play preview`,
                        description: getErrorMessage(e.currentTarget.error),
                        color: 'danger',
                      })
                    }}
                    onPause={handlePause}
                    onPlaying={handlePlaying}
                    onTimeUpdate={handleTimeUpdate}
                    onWaiting={() => setIsWaiting(true)}
                  >
                    <track kind="captions" />
                    <Trans>Your browser does not support the video tag.</Trans>
                  </video>
                  <Button
                    isIconOnly
                    className="absolute bottom-4 left-4 bg-white/75 text-black"
                    radius="sm"
                    onPress={handlePlayPause}
                  >
                    {isPlaying ? (
                      <IconPlayerPause size={24} strokeWidth={1.5} />
                    ) : (
                      <IconPlayerPlay size={24} strokeWidth={1.5} />
                    )}
                  </Button>
                  <div className="absolute bottom-4 right-4 bg-white/75 text-black px-3 py-2 rounded-md text-sm font-mono pointer-events-none">
                    {formatSeconds(currentTime)} /{' '}
                    {formatDuration(recording.duration_ms)}
                  </div>
                </div>
              )}
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

/**
 * UTILS
 */

/**
 * Formats a recording start timestamp for the metadata row.
 *
 * @param timestampMs Recording start timestamp in milliseconds, or `null`.
 * @returns Localized date-time string, or an empty string when unavailable.
 */
function formatDate(timestampMs: number | null): string {
  if (timestampMs === null || !Number.isFinite(timestampMs)) return ''
  const d = new Date(timestampMs)

  if (isNaN(d.getTime())) return ''

  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Formats a recording duration in minutes and seconds for list display.
 *
 * @param durationMs Recording duration in milliseconds, or `null`.
 * @returns `MM:SS` string, or an empty string when the value is unavailable.
 */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0)
    return ''
  const seconds = Math.floor(durationMs / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Converts byte counts into compact human-readable storage units.
 *
 * @param bytes Raw recording size in bytes.
 * @returns Rounded storage string, or `-` when the value is invalid.
 */
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
