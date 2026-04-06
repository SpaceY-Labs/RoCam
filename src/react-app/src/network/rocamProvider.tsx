/**
 * Author: Zifan Si
 * Date: 2025-11-15
 * Purpose: Exposes backend status, logs, and API access through React context.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { addToast } from '@heroui/toast'
import { useLingui } from '@lingui/react/macro'

import { ApiClient, type StatusResponse } from './api'

import { getErrorMessage } from '@/utils'

export type LogEntry = {
  id: number
  timestamp: number
  level: string
  logger: string
  message: string
}

const MAX_LOG_ENTRIES = 1000

interface RocamContextType {
  apiClient: ApiClient | null
  status: StatusResponse | null
  logs: LogEntry[]
}

const RocamContext = createContext<RocamContextType | undefined>(undefined)

interface RocamProviderProps {
  children: ReactNode
}

/**
 * Provides shared backend status, logs, and API access to the app tree.
 *
 * @param children Nested application content that consumes backend state.
 * @returns Context provider that exposes backend status, logs, and API access.
 */
export function RocamProvider({ children }: RocamProviderProps) {
  const { t } = useLingui()
  const [apiClient, setApiClient] = useState<ApiClient | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  // Stable refs support incremental log parsing and duplicate toast suppression.
  const nextLogIdRef = useRef(1)
  const logsErrorMessageRef = useRef<string | null>(null)

  // Initialize API client
  useEffect(() => {
    let isMounted = true

    async function initializeApiClient() {
      try {
        setErrorMessage(null)
        const client = await ApiClient.createAutomatic()

        if (isMounted) {
          setApiClient(client)
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(getErrorMessage(err))
        }
      }
    }

    initializeApiClient()

    return () => {
      isMounted = false
    }
  }, [])

  // Subscribe to status SSE stream (30Hz from backend)
  useEffect(() => {
    if (!apiClient) return

    const url = apiClient.getStatusStreamUrl()
    const es = new EventSource(url)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StatusResponse

        setStatus(data)
        setErrorMessage(null)
      } catch {
        // ignore malformed messages
      }
    }

    es.onerror = () => {
      setErrorMessage('Status stream connection error')
    }

    return () => {
      es.close()
    }
  }, [apiClient])

  useEffect(() => {
    if (!errorMessage) return

    addToast({
      title: t`Failed to poll status`,
      description: errorMessage,
      color: 'danger',
    })
  }, [errorMessage, t])

  // Subscribe to logs SSE stream
  useEffect(() => {
    if (!apiClient) return

    const es = new EventSource(apiClient.getLogsStreamUrl())

    es.onmessage = (event) => {
      const entry = parseLogEvent(event.data, nextLogIdRef.current++)

      if (!entry) return

      logsErrorMessageRef.current = null
      setLogs((prev) => {
        const next = [...prev, entry]

        return next.length <= MAX_LOG_ENTRIES
          ? next
          : next.slice(next.length - MAX_LOG_ENTRIES)
      })
    }

    es.onerror = () => {
      const message = 'Logs stream connection error'

      if (logsErrorMessageRef.current === message) return

      logsErrorMessageRef.current = message
      addToast({
        title: t`Failed to stream logs`,
        description: t`Logs stream connection error`,
        color: 'danger',
      })
    }

    return () => {
      es.close()
    }
  }, [apiClient, t])

  const value: RocamContextType = {
    apiClient,
    status,
    logs,
  }

  return <RocamContext.Provider value={value}>{children}</RocamContext.Provider>
}

/**
 * Returns the backend context consumed throughout the frontend.
 *
 * @returns Backend context containing the API client, latest status, and buffered logs.
 * @throws Error if the hook is used outside `RocamProvider`.
 */
export function useRocam() {
  const context = useContext(RocamContext)

  if (context === undefined) {
    throw new Error('useRocam must be used within a RocamProvider')
  }

  return context
}

/**
 * Converts raw SSE log payloads into normalized log entries for display.
 *
 * @param rawData Raw event payload received from the backend log stream.
 * @param id Stable identifier assigned to the parsed log entry.
 * @returns Parsed log entry, or `null` when the payload is not usable.
 */
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
