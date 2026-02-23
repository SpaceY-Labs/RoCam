import { useEffect, useRef, useState } from 'react'
import { Card, CardBody } from '@heroui/card'
import { addToast } from '@heroui/toast'
import { Trans, useLingui } from '@lingui/react/macro'

import { useRocam } from '@/network/rocamProvider'

type LogEntry = {
  id: number
  timestamp: number
  level: string
  logger: string
  message: string
}

const MAX_LOG_ENTRIES = 200

export function LogsCard() {
  const { t } = useLingui()
  const { apiClient } = useRocam()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const nextIdRef = useRef(1)
  const lastStreamErrorToastRef = useRef<string | null>(null)

  useEffect(() => {
    if (!apiClient) return

    const es = new EventSource(apiClient.getLogsStreamUrl())

    es.onmessage = (event) => {
      const entry = parseLogEvent(event.data, nextIdRef.current++)
      if (!entry) return

      lastStreamErrorToastRef.current = null
      setEntries((prev) => {
        const next = [...prev, entry]
        if (next.length <= MAX_LOG_ENTRIES) return next
        return next.slice(next.length - MAX_LOG_ENTRIES)
      })
    }
    es.onerror = () => {
      const message = 'Logs stream connection error'
      if (lastStreamErrorToastRef.current === message) return
      addToast({
        title: 'Failed to stream logs',
        description: message,
        color: 'danger',
      })
      lastStreamErrorToastRef.current = message
    }

    return () => {
      es.close()
    }
  }, [apiClient])

  return (
    <Card radius="sm">
      <CardBody className="px-6 py-5">
        <p className="text-xs font-semibold uppercase text-gray-800 tracking-widest">
          <Trans>Logs</Trans>
        </p>
        <div className="mt-3 h-40 rounded-md border border-gray-200 bg-gray-50 p-3 overflow-y-auto">
          {entries.length > 0 ? (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="font-mono text-xs leading-5 text-gray-700 break-all"
              >
                [{formatTime(entry.timestamp)}] {entry.level} {entry.logger}:{' '}
                {entry.message}
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-500">{t`Waiting for logs...`}</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

function parseLogEvent(rawData: string, id: number): LogEntry | null {
  try {
    const data = JSON.parse(rawData) as {
      timestamp?: number
      level?: string
      logger?: string
      message?: string
    }
    if (typeof data.message !== 'string') return null
    return {
      id,
      timestamp: Number.isFinite(data.timestamp)
        ? (data.timestamp as number)
        : Date.now(),
      level: typeof data.level === 'string' ? data.level : 'INFO',
      logger: typeof data.logger === 'string' ? data.logger : 'backend',
      message: data.message,
    }
  } catch {
    return null
  }
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
